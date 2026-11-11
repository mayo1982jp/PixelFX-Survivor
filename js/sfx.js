// 豪華な効果音: earshot のサウンドバンクから tools/render_sfx.py で生成した
// サンプル（assets/sfx/*.wav）を WebAudio で再生する。
// サンプルが見つからない場合（未生成・オフライン）は従来の軽量シンセにフォールバックする。
// 一部の専用音（ダッシュ／進化／レリック）は ZzFX（MIT）シンセで作り、BGM は music.js（ZzFXM）。
import { zzfx, ZZFX } from "../vendor/zzfx/zzfx.js";
import { music } from "./music.js";

let ctx = null, master = null, loading = false;
const banks = new Map();   // name -> { buffers: [AudioBuffer], gain, jitter }
const active = new Map();  // name -> 再生中のボイス数
const MAX_VOICES = { shot: 5, hit: 6, kill: 4, zap: 4, def: 4 };
const DIR = "assets/sfx/";

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  ZZFX.volume = 0.5;
  music.attach(ctx); // BGM と ZzFX の再生先をこのコンテキストへ統一
  if (!loading) { loading = true; loadSamples(); }
}

async function loadSamples() {
  try {
    const res = await fetch(DIR + "manifest.json");
    if (!res.ok) return;
    const { sounds } = await res.json();
    await Promise.all(sounds.map(async (s) => {
      const buffers = [];
      for (const f of s.files) {
        try {
          const r = await fetch(DIR + f);
          if (r.ok) buffers.push(await ctx.decodeAudioData(await r.arrayBuffer()));
        } catch (_) { /* 欠損ファイルはそのテールだけ捨ててシンセへ寄せる */ }
      }
      if (buffers.length) banks.set(s.name, { buffers, gain: s.gain, jitter: s.jitter });
    }));
  } catch (_) { /* fetch 不可の環境では丸ごとシンセ運用のまま */ }
}

function play(name, vol, fallback) {
  if (!ctx) return;
  const b = banks.get(name);
  if (!b) { if (fallback) fallback(); return; }
  if ((active.get(name) || 0) >= (MAX_VOICES[name] || MAX_VOICES.def)) return;
  const src = ctx.createBufferSource();
  src.buffer = b.buffers[(Math.random() * b.buffers.length) | 0];
  if (b.jitter) src.playbackRate.value = 0.94 + Math.random() * 0.12; // 連打の機械感を消す
  const g = ctx.createGain();
  g.gain.value = b.gain * vol;
  src.connect(g); g.connect(master);
  active.set(name, (active.get(name) || 0) + 1);
  src.onended = () => active.set(name, (active.get(name) || 1) - 1);
  src.start();
}

// ---- フォールバック用の軽量シンセ（サンプル生成前のリポジトリでも音が鳴る） ----
function tone({ f = 440, f2 = 0, type = "square", dur = 0.08, vol = 0.5, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.5, delay = 0, lp = 1200 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(t0);
}

const synth = {
  shot() { tone({ f: 680, f2: 240, type: "square", dur: 0.06, vol: 0.16 }); },
  hit() { tone({ f: 220, f2: 120, type: "triangle", dur: 0.05, vol: 0.2 }); },
  kill() { noise({ dur: 0.12, vol: 0.3, lp: 900 }); tone({ f: 160, f2: 60, type: "sawtooth", dur: 0.12, vol: 0.18 }); },
  elite() { noise({ dur: 0.3, vol: 0.5, lp: 500 }); tone({ f: 110, f2: 40, type: "sawtooth", dur: 0.3, vol: 0.3 }); },
  hurt() { tone({ f: 130, f2: 55, type: "sawtooth", dur: 0.16, vol: 0.4 }); },
  pickup() { tone({ f: 880, type: "triangle", dur: 0.05, vol: 0.22 }); tone({ f: 1320, type: "triangle", dur: 0.06, vol: 0.18, delay: 0.05 }); },
  coin() { tone({ f: 1174, type: "square", dur: 0.04, vol: 0.14 }); tone({ f: 1568, type: "square", dur: 0.07, vol: 0.14, delay: 0.04 }); },
  heart() { tone({ f: 520, type: "sine", dur: 0.09, vol: 0.3 }); tone({ f: 780, type: "sine", dur: 0.12, vol: 0.3, delay: 0.08 }); },
  zap() { noise({ dur: 0.14, vol: 0.4, lp: 2600 }); tone({ f: 1400, f2: 300, type: "square", dur: 0.1, vol: 0.14 }); },
  thunder() { noise({ dur: 0.5, vol: 0.6, lp: 380 }); tone({ f: 70, f2: 35, type: "sawtooth", dur: 0.45, vol: 0.3 }); },
  smite() { tone({ f: 1000, f2: 200, type: "sine", dur: 0.25, vol: 0.22 }); noise({ dur: 0.25, vol: 0.35, lp: 1500 }); },
  nova() { tone({ f: 340, f2: 880, type: "triangle", dur: 0.2, vol: 0.22 }); },
  star() { tone({ f: 1200, f2: 500, type: "sine", dur: 0.15, vol: 0.16, delay: 0.1 }); noise({ dur: 0.3, vol: 0.3, lp: 1800, delay: 0.4 }); },
  level() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: "square", dur: 0.12, vol: 0.25, delay: i * 0.09 })); },
  select() { tone({ f: 740, f2: 1100, type: "square", dur: 0.08, vol: 0.2 }); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone({ f, type: "triangle", dur: 0.3, vol: 0.3, delay: i * 0.24 })); },
  win() { [523, 523, 523, 659, 784, 1047].forEach((f, i) => tone({ f, type: "square", dur: 0.16, vol: 0.25, delay: i * 0.14 })); },
};

// ---- 公開 API（呼び出し側は以前と同一。サンプルがあれば豪華な再生音に自動切替） ----
export const sfx = Object.fromEntries(
  Object.entries(synth).map(([name, fallback]) => [
    name, (vol = 1) => play(name, vol, fallback),
  ]),
);

// ---- ZzFX 専用音（サンプルバンクに無い音色だけをシンセで作る） -----------------
const zzLast = {};
function zzOnce(name, minGap, fn) {
  if (!ctx) return;
  const now = performance.now();
  if (now - (zzLast[name] || 0) < minGap * 1000) return; // 連打抑制（ボイス上限の代わり）
  zzLast[name] = now;
  try { fn(); } catch { /* 音が出なくてもゲームは止めない */ }
}
/** ダッシュの風切り音（上昇スイープ） */
sfx.dash = () => zzOnce("dash", 0.12, () => zzfx(1.1, 0, 240, 0.03, 0.06, 0.22, 0, 1, 22));
/** 進化ファンファーレ（D-F-A-D の4音アルペジオ、矩形波） */
sfx.evolve = () => zzOnce("evolve", 0.3, () => {
  [587.33, 698.46, 880, 1174.66].forEach((f, i) =>
    setTimeout(() => { try { zzfx(0.65, 0, f, 0, 0.07, 0.16, 5, 0.5); } catch { /* noop */ } }, i * 90));
});
/** ジャスト回避の鋭い上昇音 */
sfx.just = () => zzOnce("just", 0.2, () => zzfx(0.9, 0, 620, 0, 0.04, 0.14, 0, 1, 18));
/** レリック取得のキラキラ音 */
sfx.relic = () => zzOnce("relic", 0.3, () => {
  zzfx(0.55, 0, 1318.5, 0, 0.05, 0.2, 0, 1);
  setTimeout(() => { try { zzfx(0.55, 0, 1567.98, 0, 0.05, 0.26, 0, 1); } catch { /* noop */ } }, 70);
});
