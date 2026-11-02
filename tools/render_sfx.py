# PixelFX-Survivor 効果音レンダラー（earshot bank 製の豪華なサンプル音源を生成する）
#
# 使い方:
#   python tools/render_sfx.py [--earshot <earshotリポジトリのパス>] [--out assets/sfx]
#
# earshot のサウンドバンク (252 Sound) からレイヤーを重ね合わせてゲーム用の
# WAV サンプルを生成し、assets/sfx/ に manifest.json と一緒に書き出す。
# js/sfx.js がそれを fetch して再生する（無ければ従来のシンセにフォールバック）。

import argparse
import json
import os
import sys
import wave

import numpy as np


def find_earshot(explicit):
    cands = []
    if explicit:
        cands.append(explicit)
    cands.append(os.environ.get("EARSHOT_REPO", ""))
    cands.append(r"C:\Users\mayo1\Documents\Antigravity\game\earshot-soundeffect")
    cands.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "earshot-main"))
    for p in cands:
        if p and os.path.isdir(os.path.join(p, "earshot")):
            return os.path.abspath(p)
    raise SystemExit("earshot パッケージが見つかりません (--earshot で指定してください)")


# ---------------------------------------------------------------- レイヤー合成
SR = 48000


def render_layer(bank, id_, gain, at, knobs, seed=None):
    y, _meta = bank.render(id_, seed=seed, **knobs)
    y = np.asarray(y, dtype=np.float32)
    if y.ndim == 1:
        y = np.stack([y, y], axis=1)
    return y * np.float32(gain), int(round(at * SR))


def trim_edges(y, thr_db=-70.0, head_pad=0.004, tail_pad=0.02, fade=0.015):
    """無音のヘッド/テールを落とし、末尾に短めのフェードを掛けてクリックを防ぐ。"""
    if len(y) == 0:
        return y
    peak = float(np.max(np.abs(y)))
    if peak <= 0:
        return y[: SR // 100]
    lin = 10.0 ** (thr_db / 20.0) * peak
    idx = np.nonzero(np.max(np.abs(y), axis=1) > lin)[0]
    a = max(0, idx[0] - int(head_pad * SR))
    b = min(len(y), idx[-1] + 1 + int(tail_pad * SR))
    y = y[a:b].copy()
    n = min(len(y), int(fade * SR))
    if n > 1:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(np.pi, 0.0, n, dtype=np.float32))
        y[-n:] *= ramp[:, None]
    return y


def normalize_peak(y, db=-1.0):
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak > 0:
        y = y * np.float32((10.0 ** (db / 20.0)) / peak)
    return y


def mix(bank, layers, seed):
    parts = [render_layer(bank, *spec, seed=seed) for spec in layers]
    end = max(at + len(y) for y, at in parts)
    out = np.zeros((end, 2), dtype=np.float32)
    for y, at in parts:
        out[at:at + len(y)] += y
    return trim_edges(normalize_peak(out))


def write_wav(path, y):
    y = np.clip(y, -1.0, 1.0)
    pcm = np.empty((len(y), 2), dtype="<i2")
    pcm[:, 0] = np.round(y[:, 0] * 32767.0).astype(np.int16)
    pcm[:, 1] = np.round(y[:, 1] * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ------------------------------------------------------------------------- 設計
# 1レイヤー = (bank id, gain, offset 秒, そのレイヤー固有の追加ノブ dict)
# takes>1 は seed を 1 ずつ振ってバリエーション生成（連打/連撃で機械感を減らす）。
# jitter=True は JS 側で ±再生速度の揺れを掛ける（打撃・ノイズ系のみ）。
SOUNDS = {
    # 射撃: キックのアタック + 高域のスウィッシュで「重みのある発砲音」に
    "shot":   {"takes": 3, "gain": 0.20, "jitter": True,  "seed": 11,
               "layers": [("cut_hit/kick", 1.0, 0.00, {}),
                          ("swish/flick", 0.55, 0.00, {})]},
    # 着弾: 硬いプラスチック系のタップ + 低めのポップ
    "hit":    {"takes": 3, "gain": 0.18, "jitter": True,  "seed": 21,
               "layers": [("knock/plastic", 1.0, 0.00, {}),
                          ("ui_pop/boop", 0.50, 0.01, {})]},
    # 撃破: ウェッティなバブル + 低アタックのサブ
    "kill":   {"takes": 2, "gain": 0.30, "jitter": True,  "seed": 31,
               "layers": [("drip/bloop", 0.90, 0.00, {}),
                          ("cut_hit/sub", 0.70, 0.02, {})]},
    # エリート撃破: 短くゲートされた映画的インパクト + グリッチの気配
    "elite":  {"takes": 2, "gain": 0.48, "jitter": True,  "seed": 41,
               "layers": [("pro_impact/short", 1.0, 0.00, {}),
                          ("glitch/mid", 0.30, 0.00, {})]},
    # プレイヤー被弾: パンチ + 下がるトーン（不快感の演出）
    "hurt":   {"takes": 2, "gain": 0.40, "jitter": True,  "seed": 51,
               "layers": [("cut_hit/punch", 1.0, 0.00, {}),
                          ("pro_zip/down_warm", 0.60, 0.01, {})]},
    # アイテム取得: 丸い_mid ティンのチャイム
    "pickup": {"takes": 2, "gain": 0.28, "jitter": False, "seed": 61,
               "layers": [("notify/mid_tine", 1.0, 0.00, {})]},
    # コイン: カリンバの D6→G6（2連符）
    "coin":   {"takes": 1, "gain": 0.22, "jitter": False,
               "layers": [("pluck/kalimba", 0.9, 0.00, {"pitch": "D6", "dur": 0.55}),
                          ("pluck/kalimba_ring", 0.8, 0.06, {"pitch": "G6", "dur": 0.60})]},
    # ハート回復: ソフトカリンバ C5→G5 + 木製のチン
    "heart":  {"takes": 1, "gain": 0.30, "jitter": False,
               "layers": [("pluck/kalimba_soft", 0.9, 0.00, {"pitch": "C5", "dur": 0.50}),
                          ("pluck/kalimba_soft", 0.8, 0.10, {"pitch": "G5", "dur": 0.60}),
                          ("notify/mid_wood", 0.25, 0.00, {})]},
    # ジップ/感電: 高域グリッチの連なり + チープなチャープ
    "zap":    {"takes": 3, "gain": 0.32, "jitter": True,  "seed": 71,
               "layers": [("pro_glitch/fastroll", 1.0, 0.00, {}),
                          ("glitch/chirp", 0.50, 0.00, {})]},
    # 雷: 深いインパクト + ラムブルの余韻
    "thunder": {"takes": 2, "gain": 0.55, "jitter": True,  "seed": 81,
                "layers": [("pro_impact/deep", 1.0, 0.00, {}),
                           ("cut_hit/rumble", 0.85, 0.02, {})]},
    # 天罰: 降りて来るジップ + 短い断頭インパクト
    "smite":  {"takes": 2, "gain": 0.44, "jitter": True,  "seed": 91,
               "layers": [("pro_zip/down", 0.80, 0.00, {}),
                          ("pro_impact/short", 1.0, 0.10, {})]},
    # ノヴァ: 幅広いポップ + リバーススウェルの膨らみ
    "nova":   {"takes": 2, "gain": 0.28, "jitter": True,  "seed": 101,
               "layers": [("ui_pop/wide", 1.0, 0.00, {}),
                          ("reverse_swell/short", 0.55, 0.02, {})]},
    # スター: 4連上行ゴールドベル（mallet/up4 がそのまま映える）
    "star":   {"takes": 1, "gain": 0.30, "jitter": False,
               "layers": [("mallet/up4", 1.0, 0.00, {})]},
    # レベルアップ: カリンバ C5-E5-G5-C6 の分散コード + ダンのアクセント
    "level":  {"takes": 1, "gain": 0.38, "jitter": False,
               "layers": [("pluck/kalimba", 0.85, 0.00, {"pitch": "C5", "dur": 0.45}),
                          ("pluck/kalimba", 0.85, 0.10, {"pitch": "E5", "dur": 0.45}),
                          ("pluck/kalimba", 0.85, 0.20, {"pitch": "G5", "dur": 0.50}),
                          ("pluck/kalimba_ring", 0.90, 0.30, {"pitch": "C6", "dur": 0.80}),
                          ("pro_notify/ding_1930", 0.35, 0.30, {})]},
    # 選択: 丸いステップ + 高域ティンクのアクセント
    "select": {"takes": 1, "gain": 0.24, "jitter": False,
               "layers": [("ui_pop/step", 1.0, 0.00, {}),
                          ("pro_click/tink", 0.45, 0.01, {})]},
    # ゲームオーバー: 沈み込むサブドロップ + テープダウンリフター
    "over":   {"takes": 1, "gain": 0.42, "jitter": False,
               "layers": [("pro_sub_drop/soft", 0.90, 0.00, {"dur": 1.50}),
                          ("downlifter/tape", 0.70, 0.00, {"dur": 1.60})]},
    # ビクトリー: シマー + グロック C6-E6-G6 の上昇
    "win":    {"takes": 1, "gain": 0.45, "jitter": False,
               "layers": [("pro_shimmer/m1", 0.60, 0.00, {}),
                          ("mallet/glock", 0.90, 0.00, {"pitch": "C6", "dur": 0.50}),
                          ("mallet/glock", 0.90, 0.14, {"pitch": "E6", "dur": 0.55}),
                          ("mallet/glock", 1.00, 0.28, {"pitch": "G6", "dur": 0.90})]},
}


def main():
    ap = argparse.ArgumentParser(description="earshot bank からゲーム用 sfx WAV をレンダリング")
    ap.add_argument("--earshot", help="earshot リポジトリのパス（既定: 環境変数 EARSHOT_REPO / 既知の場所）")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sfx"))
    ap.add_argument("--only", nargs="*", help="生成するサウンド名を絞る（既定: 全部）")
    args = ap.parse_args()

    repo = find_earshot(args.earshot)
    sys.path.insert(0, repo)
    from earshot.forge import bank  # noqa: E402

    print(f"earshot: {repo} (bank {bank.VERSION})")
    os.makedirs(args.out, exist_ok=True)
    mpath = os.path.join(args.out, "manifest.json")
    old = {}
    if os.path.exists(mpath):  # --only のときに既存エントリを維持する
        with open(mpath, encoding="utf-8") as f:
            old = {s["name"]: s for s in json.load(f)["sounds"]}

    manifest = []
    total = 0
    for name, spec in SOUNDS.items():
        if args.only and name not in args.only:
            continue
        takes = []
        base = spec.get("seed", 7)
        for k in range(spec["takes"]):
            seed = base + k if spec["takes"] > 1 else None  # None = 納品された final と同一
            y = mix(bank, spec["layers"], seed)
            fname = f"{name}_{k + 1}.wav"
            write_wav(os.path.join(args.out, fname), y)
            takes.append(fname)
            total += os.path.getsize(os.path.join(args.out, fname))
            print(f"  {fname:16s} {len(y) / SR:5.2f}s")
        manifest.append({"name": name, "takes": len(takes), "gain": spec["gain"],
                         "jitter": bool(spec.get("jitter")), "files": takes})
    for name, s in old.items():  # 今回の --only 対象外だった既存サウンドを引き継ぐ
        if s["name"] not in {m["name"] for m in manifest}:
            manifest.append(s)

    with open(mpath, "w", encoding="utf-8") as f:
        json.dump({"sr": SR, "sounds": manifest}, f, ensure_ascii=False, indent=1)
    print(f"合計 {total / 1e6:.2f} MB, {len(manifest)} sounds -> {args.out}")


if __name__ == "__main__":
    main()
