// レンダラ：世界全部を pixelfx の「フレーム」（color + light の 2 バッファ）に書き込んでから
// composite() で 1 枚の ImageData に合成し、低解像度 canvas へ叩きつける。
// 地面は自作のピクセルノイズ、プレイヤーは pixelfx Stock アスリート（HERO スプライト）、
// 敵・弾・拾い物・武器演出はすべて pixelfx のエフェクト。
import { createFrame, clearFrame, composite, painterFor, createFx, hex, stockActor, HERO, HERO_PAL, WHITE } from "../vendor/pixelfx/core/index.js";
import { FX } from "./fx.js";
import { WITCH, WITCH_PAL } from "./witch.js";
import { VW, VH, TUNE } from "./game.js";
import { noise } from "../vendor/noisejs/noise.js";

const BG = hex("#0a0f14");

// ---- 地面用ピクセルノイズ ------------------------------------------------------
const GRASS = ["#0b1512", "#0d1a14", "#0f1e18", "#0c1c16", "#10231b", "#0a120e"].map(hex);
const FLOWER = [hex("#2c4a30"), hex("#3a5a34"), hex("#48684a")];
const PEBBLE = [hex("#1d2830"), hex("#25313a")];
const GLOW_WARM = hex("#ffd8a0"), ICE = hex("#62c8f4");

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return (n ^ (n >> 16)) >>> 0;
}

// ---- noisejs 地面タイル ----------------------------------------------------------
// Perlin ノイズ（noisejs, ISC）の多重オクターブで 256x256 のモットリングを事前に生成し、
// 描画時はピクセルコピーだけ（毎フレームのノイズ計算はしない）。水平・垂直とも
// ミラー反転で繰り返すので継ぎ目は原理的に見えない。シードはランごとに変わる。
const TILE = 256;
let groundSeed = 1337;
let groundTile = null;

/** タイルを生成する純粋関数（テストから直接呼べる）。戻り値は TILE*TILE の色配列 */
export function buildGroundTile(seed) {
  noise.seed(seed);
  const colors = new Uint32Array(TILE * TILE);
  const F1 = 1 / 52, F2 = 1 / 13; // 大きな斑ら＋細部
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = noise.perlin2(x * F1, y * F1) * 0.72 + noise.perlin2(x * F2 + 40.2, y * F2 + 9.1) * 0.28;
      const t = Math.max(0, Math.min(1, v * 0.5 + 0.5 + (hash(x, y) % 997) / 997 * 0.05 - 0.025));
      colors[y * TILE + x] = GRASS[Math.min(5, (t * 6) | 0)];
    }
  }
  return colors;
}
/** ミラー繰り返しのタイル座標（負座標でも正しく折り返す） */
export function mirrorTileCoord(w) {
  const m = w & (TILE * 2 - 1);
  return m < TILE ? m : TILE * 2 - 1 - m;
}

/** 画面全域の地面をフレームへ直接書き込む（ノイズタイル＋まばらな草花・小石） */
function drawGround(frame) {
  if (!groundTile) groundTile = buildGroundTile(groundSeed);
  const C = frame.color, ox = frame.ox, oy = frame.oy;
  for (let py = 0; py < VH; py++) {
    const wy = oy + py, row = wy >> 3;
    const tileRow = mirrorTileCoord(wy) * TILE;
    let i = py * VW;
    for (let px = 0; px < VW; px++) {
      const wx = ox + px, col = wx >> 3;
      let c = groundTile[tileRow + mirrorTileCoord(wx)]; // ノイズの斑ら
      const h = hash(col, row);
      const f = hash(wx >> 1, wy >> 1);
      if (f % 97 === 0) c = FLOWER[f % 3];        // まれに草花
      else if (f % 89 === 0) c = PEBBLE[f % 2];   // まれに小石
      C[i++] = c | 0xff000000;
    }
  }
  // 16px グリッドのまばらな草の葉
  const p = painterFor(frame);
  const gx0 = Math.floor(ox / 16) * 16, gy0 = Math.floor(oy / 16) * 16;
  for (let wy = gy0; wy < oy + VH + 16; wy += 16)
    for (let wx = gx0; wx < ox + VW + 16; wx += 16) {
      const h = hash(wx >> 4, wy >> 4);
      if (h % 9 !== 0) continue;
      p.place(wx + (h % 13), wy + (h % 7));
      const c = FLOWER[(h >> 3) % 3];
      p.px(0, -2, c); p.px(0, -1, c); p.px(h & 1 ? 1 : -1, 0, c);
    }
}

// ---- メイン描画 ------------------------------------------------------------------
let frame = null, img = null, hero = null;
let flies = { f: null, ax: 0, ay: 0 };

/** ビューポート変更時にフレーム／ImageData を再確保させ下次 render() で作り直す */
export function resetFrame() { frame = null; img = null; }

export function render(g, ctx) {
  if (!frame) { frame = createFrame(VW, VH, 0, 0); img = new ImageData(VW, VH); hero = stockActor(1); }

  // カメラ（シェイク込み）をフレームの原点に
  const sh = g.shake;
  frame.ox = Math.round(g.cam.x + (sh > 0.05 ? (Math.random() * 2 - 1) * sh : 0));
  frame.oy = Math.round(g.cam.y + (sh > 0.05 ? (Math.random() * 2 - 1) * sh * 0.6 : 0));
  clearFrame(frame);
  drawGround(frame);

  // プレイヤーを照らす弱い灯火（light バッファなので後から描くもの全部をほんのり熱する）
  const p = painterFor(frame);
  p.place(g.player.x, g.player.y - 10);
  p.glow(0, 0, 52, GLOW_WARM, 0.055);

  // ① 地面系Spell（fxWorld）はエンティティの後ろ
  g.fxWorld.draw(frame);

  // ゾーン（クラゲの鈍足の泡・炎の軌跡）とXP神殿サークルを地面に描く
  {
    const pz = painterFor(frame);
    for (const z of g.zones || []) {
      pz.place(z.x, z.y);
      if (z.kind === "slow") pz.glow(0, 0, z.r, ICE, 0.16);
      else if (z.kind === "burn") pz.glow(0, 0, z.r, GLOW_WARM, 0.22);
    }
    if (g.shrine && !g.shrine.done) {
      const sh = g.shrine;
      pz.place(sh.x, sh.y);
      pz.glow(0, 0, sh.r, hex("#ffde5e"), 0.10 + 0.10 * (sh.progress / sh.need));
      pz.glow(0, 0, 6, hex("#ffde5e"), 0.35);
    }
  }

  // ② エンティティ（敵本体クリッター／拾い物／プレイヤー）を y 順に
  const items = [];
  for (const e of g.enemies) items.push({ y: e.y, e });
  for (const it of g.pickups) items.push({ y: it.y, it });
  items.push({ y: g.player.y, pl: true });
  items.sort((a, b) => a.y - b.y);

  for (const n of items) {
    if (n.pl) {
      const pl = g.player;
      // iframes 中は明滅
      if (pl.iframes <= 0 || Math.floor(g.time * 18) % 2 === 0) {
        const p2 = painterFor(frame);
        p2.place(pl.x, pl.y, pl.flip);
        const bob = pl.moving ? -(Math.floor(pl.bob) % 2) : 0;
        // 魔女スプライト（18x24）を足元原点で描画。左端に杖があるので箱の中心≈列8を x=-8 で当てる
        p2.sprite(WITCH, WITCH_PAL, -8, -23 + bob, { a: 1 });
      }
    } else if (n.e) {
      const e = n.e;
      e.f.draw(frame);
      if (e.burn > 0 && e.flame) e.flame.draw(frame);
      const p2 = painterFor(frame);
      if (e.flash > 0) { p2.place(e.x, e.y - 8); p2.glow(0, 0, 10, WHITE, 0.5 * Math.min(1, e.flash / 0.12)); }
      if (e.slow > 0) { p2.place(e.x, e.y - 8); p2.glow(0, 0, 9, ICE, 0.3); }
      if (e.telegraph) { p2.place(e.x, e.y - 8); p2.glow(0, 0, 16, hex("#ff4030"), 0.45); } // チャージ予告
      if (e.chestElite) { p2.place(e.x, e.y - 8); p2.glow(0, 0, 15, hex("#ffce4a"), 0.4); } // 宝箱の精鋭は金色
      if (e.boss) { p2.place(e.x, e.y - 10); p2.glow(0, 0, 20, hex("#b060ff"), 0.25); }
      if (e.elite) { // 精鋭には HP バー
        const w = 22, hp = Math.max(0, e.hp / e.maxHp), by = e.y - (e.fly ? 46 : 32);
        p2.place(0, 0);
        p2.rect(e.x - w / 2, by, w, 3, hex("#120a14"), 1);
        p2.rect(e.x - w / 2 + 1, by + 1, Math.round((w - 2) * hp), 1, hex(hp > 0.4 ? "#e0401c" : "#ffde5e"), 1);
      }
    } else {
      n.it.f.draw(frame);
    }
  }

  // ③ 弾は常に前（視認性優先）
  for (const b of g.projectiles) b.f.draw(frame);
  for (const b of g.enemyShots || []) b.f.draw(frame);

  // ④ 衝撃・爆発・着雷などの foreground 演出 → ⑤ ダメージ数字（最前面）
  g.fxTop.draw(frame);
  g.fxText.draw(frame);

  // ⑥ 蛍の環境演出：プレイヤーが視界の端から離れたら群れの位置を移し替える
  const wantX = g.cam.x + VW / 2, wantY = g.cam.y + VH - 10;
  if (!flies.f || Math.abs(flies.ax - wantX) > VW * 0.85 || Math.abs(flies.ay - wantY) > VH * 0.85) {
    flies.ax = wantX; flies.ay = wantY;
    flies.f = createFx(FX.fireflies, {
      x: wantX, y: wantY, light: 0.3,
      // 暗めの差し替えパレットで「夜の草原」の密度を下げる（本家の ramp 長へ再サンプルされる）
      palette: ["#10160a", "#1c280e", "#2c4014", "#42581e", "#5c7428", "#7a9440", "#9ab868"],
      grass: ["#060a07", "#08110b", "#0b170f", "#0f1f14", "#142818", "#19321e"],
      seed: ((Math.round(wantX) * 31 + Math.round(wantY) * 7) & 250) + 2,
    });
  }
  // 蛍の群れ自体もノイズでゆるやかに漂わせる（毎フレーム数回だけの安い計算）
  flies.f.options.x = flies.ax + noise.perlin2(g.time * 0.045, 11.1) * 14;
  flies.f.options.y = flies.ay + noise.perlin2(5.7, g.time * 0.045) * 8;
  // "front" のみ描画: drawBack は画面全域を覆う暗い夜のヘイズ(不透明下地)なので
  // 自前の世界の上に乗せると黒マスクになる。手前の草と近場の蛍だけ重ねる。
  flies.f.draw(frame, "front");

  // ⑦ 天候レイヤ（pixelfx weather）：60秒ごとに 嵐→雨→雪→桜→落葉→神光 を巡回。
  // 原点は各エフェクトの中央下（画面中心＝プレイヤー付近）に合わせ、ノイズで漂わせる。
  // draw は "front" のみ（理由は蛍と同じ）。TUNE.ambientFx=0 で無効化できる。
  if (TUNE.ambientFx > 0 && g.player) {
    const idx = Math.floor(Math.max(0, ambientT) / 60) % WEATHERS.length;
    if (idx !== weatherIdx || !weather.f) {
      if (weather.f) weather.f.stop();
      weatherIdx = idx;
      weather.f = createFx(WEATHERS[idx], { seed: 7 + idx * 13, light: 0.35 });
    }
    weather.f.options.x = g.player.x + noise.perlin2(ambientT * 0.03, 23.7) * 26;
    weather.f.options.y = g.player.y + 14 + noise.perlin2(9.2, ambientT * 0.03) * 10;
    weather.f.draw(frame, "front");
  } else if (weather.f) {
    weather.f.stop();
    weather.f = null;
    weatherIdx = -1;
  }

  // 合成 → canvas
  composite(frame, img.data, BG);
  ctx.putImageData(img, 0, 0);
}

// 天候の巡回順（軽いもの中心。fog/aurora/clouds/blizzard は全面被覆や負荷のため不採用）
const WEATHERS = [FX.storm, FX.rain, FX.snow, FX.cherryBlossoms, FX.fallingLeaves, FX.godRays];
let weather = { f: null };
let weatherIdx = -1;
let ambientT = 0;

/** 環境エフェクトを時間進行（playing/levelup/pause 全状態で main から毎フレーム呼ぶ） */
export function updateAmbient(dt) {
  ambientT += dt;
  if (flies.f) flies.f.update(dt);
  if (weather.f) weather.f.update(dt);
}

/** 再スタート時に環境をリセット（地面タイルのシードも引き直す） */
export function resetAmbient() {
  flies = { f: null, ax: 0, ay: 0 };
  if (weather.f) weather.f.stop();
  weather = { f: null };
  weatherIdx = -1;
  ambientT = 0;
  groundSeed = (Math.random() * 65536) | 0;
  groundTile = null;
  frame = null; img = null;
}
