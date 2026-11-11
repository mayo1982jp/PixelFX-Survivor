// 魔女プレイヤーのスプライト。png は使わず、画像のドット絵を
// pixelfx の sprite(rows, pal) 形式（文字列グリッド + パレット）でコード再現する。
// HERO と同じく「左上 (0,0) / 足元中心」で描く前提。flip 対応のため各行は同一幅 (18)。
//
// 凡例:
//   .  透明
//   k  アウトライン（ほぼ黒の濃紫）
//   D  帽子・陰 / p  帽子・中間 / P  帽子・明
//   g  金（帽子の輪・ベルト・星の縁）
//   h  髪 / H  髪のハイライト
//   s  肌 / S  肌の影
//   e  瞳（紫）
//   r  法衣・明 / R  法衣・陰
//   b  杖の wood
//   o  オーブ（青） / O  オーブの発光
//   d  靴

export const WITCH_PAL = {
  k: "#1a1030",
  D: "#3a2270",
  p: "#5a35a8",
  P: "#7a4fd0",
  g: "#f2c230",
  h: "#6e4a55",
  H: "#8a6172",
  s: "#f6d3bd",
  S: "#e3ac90",
  e: "#5a2fa5",
  r: "#6a3fb8",
  R: "#4a2a86",
  b: "#6b3f22",
  o: "#3f9fe0",
  O: "#bfeaff",
  d: "#3a2418",
};

// 18 x 24。左端に杖（オーブ＋軸）、中央に体、上部に大きな帽子。
export const WITCH = [
  "........kk........",
  ".......kppk.......",
  "......kppppk......",
  ".....kpggggpk.....",
  ".oO.kkPPPPPPkk....",
  "ObOkkPPPPPPPPkk...",
  ".b.kkkkkkkkkkk....",
  ".b..khhhhhhhhk....",
  ".b..khssssssshk...",
  ".b..khessessshk...",
  ".b..khssssssshk...",
  ".b..khhsssshhk....",
  ".b.krrrrgrrrrk....",
  ".b.krrRRRRRRrk....",
  ".bsskrrRRRrrk.....",
  ".b.krrrRRRrrrk....",
  ".b.krrRRRRRRrrk...",
  ".b.kRggRRggRrrk...",
  ".bkrrRRRRRRRRrrk..",
  ".bkgRggRRggRgRrk..",
  "..krrrrRRrrrrrk...",
  "..kdrrkkkrrdk.....",
  "..kddkkkkkddk.....",
  "...ddd...ddd......",
];

// 足元を原点 (painter.place の位置) に合わせるための左上オフセット。
// sprite は左上基準なので、x は中心基準の左端、y は足元から高さ分だけ上。
export const WITCH_SIZE = { w: 18, h: 24 };

// ---- スタイル（衣装）バリエーション：パレット差し替え＋初期武器＋特性 ----
// ==== スタイル（js/witch.js への追加） ====

export const WITCH_PALS = {
  violet: {
    k: "#1a1030",
    D: "#3a2270",
    p: "#5a35a8",
    P: "#7a4fd0",
    g: "#f2c230",
    h: "#6e4a55",
    H: "#8a6172",
    s: "#f6d3bd",
    S: "#e3ac90",
    e: "#5a2fa5",
    r: "#6a3fb8",
    R: "#4a2a86",
    b: "#6b3f22",
    o: "#3f9fe0",
    O: "#bfeaff",
    d: "#3a2418",
  },
  crimson: {
    k: "#2a0e14",
    D: "#6e1b28",
    p: "#a82b3b",
    P: "#d44252",
    g: "#f2c230",
    h: "#4a2e2e",
    H: "#6b4343",
    s: "#f6d3bd",
    S: "#e3ac90",
    e: "#b82436",
    r: "#b83242",
    R: "#801e2b",
    b: "#542a1a",
    o: "#f05a28",
    O: "#ffd29e",
    d: "#331818",
  },
  azure: {
    k: "#0e1a2f",
    D: "#1e3d6e",
    p: "#2c62a8",
    P: "#4888d6",
    g: "#e6d875",
    h: "#9ab0c7",
    H: "#bfd4eb",
    s: "#f6d3bd",
    S: "#e3ac90",
    e: "#2466b8",
    r: "#3570b8",
    R: "#214b82",
    b: "#4f3a2c",
    o: "#5ce1e6",
    O: "#e0ffff",
    d: "#1d283a",
  },
  amber: {
    k: "#291c0c",
    D: "#6e4b16",
    p: "#a67521",
    P: "#d49b35",
    g: "#fff078",
    h: "#7a5330",
    H: "#9e6e42",
    s: "#f6d3bd",
    S: "#e3ac90",
    e: "#b57414",
    r: "#c28729",
    R: "#875a16",
    b: "#5c3818",
    o: "#f5c722",
    O: "#ffffc2",
    d: "#382412",
  },
  verdant: {
    k: "#0e2618",
    D: "#1e5934",
    p: "#2d874d",
    P: "#45b36b",
    g: "#f2c230",
    h: "#5c4a38",
    H: "#7d664f",
    s: "#f6d3bd",
    S: "#e3ac90",
    e: "#238044",
    r: "#349657",
    R: "#20663a",
    b: "#5c3d22",
    o: "#70e050",
    O: "#d8ffc8",
    d: "#291e14",
  },
};

export const STYLES = [
  {
    id: "violet",
    name: "紫苑",
    pal: WITCH_PALS.violet,
    startWeapon: "wand",
    traitDesc: "バランス型",
    trait: {},
  },
  {
    id: "crimson",
    name: "紅蓮",
    pal: WITCH_PALS.crimson,
    startWeapon: "flame",
    traitDesc: "燃焼ダメージ+20% / 最大HP-15",
    trait: { burnMult: 1.2, hpAdd: -15 },
  },
  {
    id: "azure",
    name: "蒼氷",
    pal: WITCH_PALS.azure,
    startWeapon: "nova",
    traitDesc: "移動速度+10%",
    trait: { spdMult: 1.10 },
  },
  {
    id: "amber",
    name: "琥珀",
    pal: WITCH_PALS.amber,
    startWeapon: "thunder",
    traitDesc: "クリティカル率+8%",
    trait: { critAdd: 0.08 },
  },
  {
    id: "verdant",
    name: "翠風",
    pal: WITCH_PALS.verdant,
    startWeapon: "smite",
    traitDesc: "HP自然回復+0.4/秒",
    trait: { regenAdd: 0.4 },
  },
];

export function stylePal(styleId) {
  const found = STYLES.find((s) => s.id === styleId);
  return found ? found.pal : WITCH_PAL;
}

export const STYLE_KEY = "pixelSurvivor.style.v1";

export function loadStyleId() {
  try {
    const id = localStorage.getItem(STYLE_KEY);
    if (id && STYLES.some((s) => s.id === id)) return id;
  } catch (_e) {
    // ignore storage errors
  }
  return STYLES[0].id;
}

export function saveStyleId(id) {
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch (_e) {
    // ignore storage errors
  }
}
