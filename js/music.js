// BGM：ZzFXM（MIT, Keith Clark）でオフライン合成したオリジナル・チップチューンを
// AudioBuffer としてループ再生する。曲は本作用の書き下ろし（Dマイナー／138BPM／16分ステップ）。
// 効果音側の AudioContext を sfx.js の initAudio から attach() で共有し、ZZFX の再生先も同じ
// コンテキストへ向ける（コンテキストは1つだけ）。再生開始は必ずユーザー操作の後（main 側で呼ぶ）。
import { zzfxM } from "../vendor/zzfxm/zzfxm.js";
import { ZZFX } from "../vendor/zzfx/zzfx.js";

// ---- 曲データ（ZzFXM 形式：[instruments, patterns, sequence, BPM]） ------------------
// ノート番号は「楽器の基準周波数 × 2^((n-12)/12)」。小数部は減衰（ velocity ）。
// パターンは 64 ステップ＝4小節。チャンネル: 0=ベース 1=キック 2=スネア 3=ハット
// 4=リードアルペジオ 5=パッド(ルート+5度) 6=パッド(3度) 7=プラック旋律
const INSTRUMENTS = [
  [1.1, 0, 73.42, 0.005, 0.09, 0.06, 2, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8], // 0 ベース（D2基準・鋸波）
  [1.9, 0, 160, 0, 0.03, 0.13, 0, 1.2, -7],                                    // 1 キック（正弦・ピッチ降下）
  [1.3, 0, 1700, 0, 0.02, 0.09, 0, 1, 0, 0, 0, 0, 0, 1],                       // 2 スネア（ノイズ）
  [0.6, 0, 6200, 0, 0.004, 0.028, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 900], // 3 ハット（高域ノイズ）
  [0.62, 0, 293.66, 0.005, 0.07, 0.05, 5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7], // 4 リード（D4基準・矩形）
  [0.42, 0, 146.83, 0.5, 2.6, 0.6, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8],      // 5 パッド（D3基準・三角）
  [0.75, 0, 587.33, 0.002, 0.02, 0.25, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6],   // 6 プラック（D5基準）
];

/** 64ステップ分の配置マップ {step: note} からステップ配列を作る */
const steps64 = (map) => {
  const a = new Array(64).fill(0);
  for (const [i, v] of Object.entries(map)) a[+i] = v;
  return a;
};
const chan = (inst, pan, map) => [inst, pan, ...steps64(map)];
/** 小節（16ステップ）単位のモチーフを4小節へ展開する。fn(barIndex) -> {stepInBar: note} */
const bars = (fn) => {
  const m = {};
  for (let b = 0; b < 4; b++) for (const [s, v] of Object.entries(fn(b))) m[b * 16 + +s] = v;
  return m;
};
// コード進行はパターンごとに「2小節×2コード」。ルート音（ベース基準 D2=12）:
const ROOT = { Dm: 12, F: 15, C: 10, Bb: 8, A: 9, Gm: 7 };
// パッド用：ルート+5度 と 3度（パッド基準 D3=12）
const PAD5 = { Dm: [12, 19], F: [15, 22], C: [10, 17], Bb: [8, 15], A: [9, 16], Gm: [7, 14] };
const PAD3 = { Dm: 15, F: 19, C: 14, Bb: 12, A: 13, Gm: 10 };
// リードアルペジオ用コードトーン（リード基準 D4=12、[root, 3rd, 5th, octave]）
const ARP = {
  Dm: [12, 15, 19, 24], F: [15, 19, 22, 27], C: [10, 14, 17, 22], Bb: [8, 12, 15, 20],
  A: [9, 13, 16, 21], Gm: [7, 10, 14, 19],
};
const bassBar = (root, full = true) => {
  const m = { 0: root, 2: root, 4: root, 6: root + 12, 8: root, 10: root, 12: root + 12, 14: root };
  if (!full) for (const k of [2, 6, 10, 14]) delete m[k];
  return m;
};
const kickBar = (four = true) => (four ? { 0: 12, 4: 12, 8: 12, 12: 12 } : { 0: 12, 8: 12 });
const snareBar = { 4: 12, 12: 12 };
const hatBar = { 2: 12.5, 6: 12, 10: 12.5, 14: 12 };
const arpBar = (ch) => {
  const [r, t, f, o] = ARP[ch];
  return { 0: r, 1: f, 2: o, 3: f, 4: t, 5: f, 6: o, 7: f, 8: r, 9: f, 10: o, 11: f, 12: t, 13: f, 14: o, 15: f };
};
const padBar = (ch, third) => (third ? { 0: PAD3[ch] } : { 0: PAD5[ch][0], 8: PAD5[ch][1] });
/** 2コード（前半2小節／後半2小節）からパターンの各チャンネルを組み立てる */
function pattern(c1, c2, opt = {}) {
  const { bass = true, kick = true, snare = true, hat = true, arp = true, pad = true, pluck = null, half = false } = opt;
  const chordAt = (b) => (b < 2 ? c1 : c2);
  return [
    bass ? chan(0, -0.15, bars((b) => bassBar(ROOT[chordAt(b)], !half))) : [0, 0, 0],
    kick ? chan(1, 0, bars(() => kickBar(!half))) : [0, 0, 0],
    snare ? chan(2, 0.1, bars(() => snareBar)) : [0, 0, 0],
    hat ? chan(3, -0.1, bars(() => hatBar)) : [0, 0, 0],
    arp ? chan(4, 0.2, bars((b) => arpBar(chordAt(b)))) : [0, 0, 0],
    pad ? chan(5, -0.25, bars((b) => (b % 2 === 0 ? padBar(chordAt(b), false) : {}))) : [0, 0, 0],
    pad ? chan(5, 0.25, bars((b) => (b % 2 === 0 ? padBar(chordAt(b), true) : {}))) : [0, 0, 0],
    pluck ? chan(6, 0, pluck) : [0, 0, 0],
  ];
}
// プラックのモチーフ（P0 の静かな導入と P3 の橋渡し）
const PLUCK_INTRO = { 0: 24, 12: 22, 24: 19, 36: 22, 48: 24 };
const PLUCK_BRIDGE = {
  0: 24, 4: 22, 8: 19, 12: 22, 16: 24, 20: 22, 24: 19, 28: 15,
  32: 19, 36: 22, 40: 24, 44: 22, 48: 19, 52: 17, 56: 19, 60: 22,
};
const PATTERNS = [
  pattern("Dm", "Dm", { snare: false, hat: false, arp: false, half: true, pluck: PLUCK_INTRO }), // P0 導入
  pattern("Dm", "F", {}),                                                                          // P1
  pattern("Dm", "Bb", {}),                                                                         // P2
  pattern("Gm", "Dm", { hat: false, arp: false, pluck: PLUCK_BRIDGE }),                            // P3 橋
  pattern("C", "A", {}),                                                                           // P4
];
const SEQUENCE = [0, 1, 2, 1, 3, 1, 4, 2, 1]; // 9パターン ≒ 62.6秒
export const SONG = [INSTRUMENTS, PATTERNS, SEQUENCE, 138];
export const SONG_SECONDS = (64 * SEQUENCE.length) * (60 / 138 / 4);

// ---- プレイヤー ---------------------------------------------------------------
const KEY = "pixelSurvivor.bgm.v1";
let actx = null, musicGain = null, srcNode = null;
let rendered = null; // AudioBuffer（レンダリング済み）
let renderMs = -1;
let enabled = (() => {
  try { const v = localStorage.getItem(KEY); return v === null ? true : v === "1"; }
  catch { return true; }
})();

function ensureRendered() {
  if (rendered || !actx) return rendered;
  const t0 = performance.now();
  const [l, r] = zzfxM(...SONG);
  renderMs = performance.now() - t0;
  const n = Math.max(l.length, r.length);
  let peak = 0;
  for (let i = 0; i < n; i += 3) peak = Math.max(peak, Math.abs(l[i] || 0), Math.abs(r[i] || 0));
  const scale = peak > 0.85 ? 0.85 / peak : 1;
  rendered = actx.createBuffer(2, n, ZZFX.sampleRate);
  const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
  for (let i = 0; i < n; i++) { L[i] = (l[i] || 0) * scale; R[i] = (r[i] || 0) * scale; }
  return rendered;
}

export const music = {
  get enabled() { return enabled; },
  get playing() { return !!srcNode; },
  get renderedSeconds() { return rendered ? rendered.duration : 0; },
  get renderMs() { return renderMs; },
  /** sfx.js の initAudio から共有 AudioContext を受け取る（ZZFX の再生先もここへ統一） */
  attach(ctx) {
    if (actx || !ctx) return;
    actx = ctx;
    ZZFX.audioContext = ctx;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.32; // 効果音（master 0.45）より控えめに敷く
    musicGain.connect(ctx.destination);
  },
  start() {
    if (!enabled || !actx || srcNode) return;
    if (actx.state === "suspended") actx.resume();
    const buf = ensureRendered();
    if (!buf) return;
    srcNode = actx.createBufferSource();
    srcNode.buffer = buf;
    srcNode.loop = true;
    srcNode.connect(musicGain);
    srcNode.start();
  },
  stop() {
    if (!srcNode) return;
    try { srcNode.stop(); } catch { /* already stopped */ }
    srcNode = null;
  },
  /** ♪ トグルの状態変更。localStorage に保存し、切替後の enabled を返す */
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* 保存不可でも続行 */ }
    if (!enabled) this.stop();
    return enabled;
  },
  /** テスト／診断用スナップショット */
  state() {
    return { enabled, playing: !!srcNode, attached: !!actx, renderedSeconds: this.renderedSeconds, renderMs };
  },
};
