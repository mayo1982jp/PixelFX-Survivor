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
