// レベルアップカード用のエフェクト・プレビュー。
// 各カードに小さな canvas を用意し、対応する pixelfx エフェクトを
// ループ（一発ものは再生し直し）で描画して「どんな効果か」を一目で伝える。
import { createFrame, clearFrame, composite, createFx, hex } from "../vendor/pixelfx/core/index.js";
import { FX, PAL } from "./fx.js";

const BG = hex("#0b1220");
// 再生（ヒーリング）用の緑ランプ。他は PAL を流用。
const GREEN = ["#04140a", "#0c3a1c", "#1c6a34", "#38a85a", "#68d88a", "#a6f0c0", "#e0fff0", "#ffffff"];

/** 選択肢 c を構成するエフェクトモジュールとオプションを返す（無ければ null） */
function previewFor(c) {
  if (c.kind === "weapon" || c.kind === "new") {
    switch (c.id) {
      case "wand": return { mod: FX.plasmaShot };
      case "nova": return { mod: FX.snowflakeBurst };
      case "thunder": return { mod: FX.lightningStrike };
      case "smite": return { mod: FX.smite };
      case "stars": return { mod: FX.starFall };
      case "flame": return { mod: FX.spiritFlame, opts: { palette: PAL.fire } };
    }
  } else if (c.kind === "passive") {
    switch (c.id) {
      case "might": return { mod: FX.manaBurst };
      case "swift": return { mod: FX.zapHit };
      case "haste": return { mod: FX.hitSpark };
      case "vital": return { mod: FX.heartPickup };
      case "heal": return { mod: FX.heartPickup };
      case "regen": return { mod: FX.spiritFlame, opts: { palette: GREEN } };
      case "magnet": return { mod: FX.gemSpin, opts: { palette: PAL.xpBlue } };
      case "luck": return { mod: FX.confetti };
    }
  } else if (c.kind === "heal") {
    return { mod: FX.heartPickup };
  }
  return null;
}

const items = []; // { ctx, frame, img, spec, opts, fx }

/** entries = [{ canvas, choice }] を受け取り、各 canvas でプレビュー再生を開始 */
export function start(entries) {
  stop();
  for (const { canvas, choice } of entries) {
    const spec = previewFor(choice);
    if (!spec) continue;
    const meta = spec.mod.meta;
    const [w, h] = meta.size;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const opts = { x: meta.origin[0], y: meta.origin[1], ...(spec.opts || {}) };
    items.push({
      ctx,
      frame: createFrame(w, h, 0, 0),
      img: new ImageData(w, h),
      spec,
      opts,
      fx: createFx(spec.mod, opts),
    });
  }
}

/** 毎フレーム呼ぶ（state === "levelup" の間だけ）。一発ものは終わったら再生し直す */
export function update(dt) {
  for (const it of items) {
    it.fx.update(dt);
    if (it.fx.done()) it.fx = createFx(it.spec.mod, it.opts);
    clearFrame(it.frame);
    it.fx.draw(it.frame);
    composite(it.frame, it.img.data, BG);
    it.ctx.putImageData(it.img, 0, 0);
  }
}

/** プレビューを停止して canvas とインスタンスを解放 */
export function stop() {
  items.length = 0;
}
