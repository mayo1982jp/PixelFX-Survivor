// 軽量WebAudioシンセ。pixelfxは映像効果のみなので、効果音はこの小さな合成音で補う。
let ctx = null, master = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
}

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

export const sfx = {
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
