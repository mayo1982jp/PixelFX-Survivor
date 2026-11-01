// レンダラ：世界全部を pixelfx の「フレーム」（color + light の 2 バッファ）に書き込んでから
// composite() で 1 枚の ImageData に合成し、低解像度 canvas へ叩きつける。
// 地面は自作のピクセルノイズ、プレイヤーは pixelfx Stock アスリート（HERO スプライト）、
// 敵・弾・拾い物・武器演出はすべて pixelfx のエフェクト。
import { createFrame, clearFrame, composite, painterFor, createFx, hex, stockActor, HERO, HERO_PAL, WHITE } from "../vendor/pixelfx/core/index.js";
import { FX } from "./fx.js";
import { WITCH, WITCH_PAL } from "./witch.js";
import { VW, VH } from "./game.js";

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

/** 画面全域の地面をフレームへ直接書き込む（8px 斑中心の落ち着いた芝生＋まばらな草花・小石） */
function drawGround(frame) {
  const C = frame.color, ox = frame.ox, oy = frame.oy;
  for (let py = 0; py < VH; py++) {
    const wy = oy + py, row = wy >> 3;
    let i = py * VW;
    for (let px = 0; px < VW; px++) {
      const wx = ox + px, col = wx >> 3;
      const h = hash(col, row);
      let c = GRASS[h % 4];                       // 斑（8px タイル）
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
  // "front" のみ描画: drawBack は画面全域を覆う暗い夜のヘイズ(不透明下地)なので
  // 自前の世界の上に乗せると黒マスクになる。手前の草と近場の蛍だけ重ねる。
  flies.f.draw(frame, "front");

  // 合成 → canvas
  composite(frame, img.data, BG);
  ctx.putImageData(img, 0, 0);
}

/** 環境エフェクトを時間進行（playing/levelup/pause 全状態で main から毎フレーム呼ぶ） */
export function updateAmbient(dt) {
  if (flies.f) flies.f.update(dt);
}

/** 再スタート時に環境をリセット */
export function resetAmbient() {
  flies = { f: null, ax: 0, ay: 0 };
  frame = null; img = null;
}
