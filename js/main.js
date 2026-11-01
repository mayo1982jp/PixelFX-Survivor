// エントリポイント：canvas・入力・状態機械・rAF ループの接続。
// 世界（canvas 内）はすべて pixelfx のフレームバッファ経由で描画される。
import { createGame } from "./game.js";
import { render, updateAmbient, resetAmbient } from "./render.js";
import { makeChoices, applyChoice } from "./weapons.js";
import { FX } from "./fx.js";
import { initAudio, sfx } from "./sfx.js";
import * as meta from "./meta.js";
import * as preview from "./preview.js";
import * as ui from "./ui.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const game = createGame();
window.game = game; // デバッグ用フック（コンソールから状態を覗ける）
let state = "title"; // title | playing | levelup | pause | end
let choices = [];

// ---- 入力 ----------------------------------------------------------------
const keys = new Set();
const input = { left: false, right: false, up: false, down: false };
const KEYMAP = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
};
addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  if (KEYMAP[ev.code]) { keys.add(ev.code); ev.preventDefault(); }
  if (ev.code === "KeyP" || ev.code === "Escape") togglePause();
  if (state === "levelup" && ["Digit1", "Digit2", "Digit3"].includes(ev.code)) choose(parseInt(ev.code.slice(-1)) - 1);
  if (state === "title" && (ev.code === "Enter" || ev.code === "Space")) start();
  if (state === "end" && (ev.code === "Enter" || ev.code === "Space")) start();
});
addEventListener("keyup", (ev) => { if (KEYMAP[ev.code]) keys.delete(ev.code); });
addEventListener("blur", () => keys.clear());

function readInput() {
  input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  input.right = keys.has("ArrowRight") || keys.has("KeyD");
  input.up = keys.has("ArrowUp") || keys.has("KeyW");
  input.down = keys.has("ArrowDown") || keys.has("KeyS");
}

// ---- ゲームイベント配線 ------------------------------------------------------
game.onHurt = () => ui.flashDamage();
game.onLevelUp = () => {
  if (state !== "playing") return;
  state = "levelup";
  sfx.level();
  game.fxTop.spawn(FX.confetti, game.player.x, game.player.y - 20, { seed: game.rseed() });
  openCards();
};
game.onEnd = (win) => { state = "end"; ui.showEnd(win, game); };

function openCards() {
  choices = makeChoices(game);
  const entries = ui.showCards(choices, choose);
  preview.start(entries); // カード内で見本エフェクトをループ再生
}

function choose(i) {
  if (state !== "levelup" || !choices[i]) return;
  applyChoice(game, choices[i]);
  game.pendingLevels--;
  sfx.select();
  if (game.pendingLevels > 0) openCards(); // 連続レベルアップは次の 3 択へ
  else { ui.hideCards(); preview.stop(); state = "playing"; }
}

function togglePause() {
  if (state === "playing") { state = "pause"; ui.showPause(true); }
  else if (state === "pause") { ui.showPause(false); state = "playing"; }
}

// ---- 永続強化ショップ（タイトル画面に常設。画面遷移なしでクリック購入できる） ------
function buyMeta(id) {
  if (meta.buy(id)) { sfx.select(); ui.renderShop(buyMeta); } // 再構築して購入可否とレベルを反映
  else sfx.hurt();
}
function backToTitle() {
  ui.hideEnd();
  state = "title";
  ui.showTitle(true);
  ui.renderShop(buyMeta); // ラン終了後の貯金増加を反映
}

function start() {
  initAudio();
  game.reset(); // meta.js の購入レベルが初期ステータスへ反映される
  resetAmbient();
  preview.stop();
  ui.hideCards(); ui.hideEnd(); ui.showPause(false); ui.showTitle(false); ui.showHud(true);
  state = "playing";
}

document.getElementById("startBtn").onclick = start;
document.getElementById("retryBtn").onclick = start;
document.getElementById("toTitleBtn").onclick = backToTitle;

// ---- メインループ -------------------------------------------------------------
let last = performance.now(), acc = 0;
const STEP = 1 / 60;

function loop(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state === "playing") {
    acc += real;
    while (acc >= STEP) { // 固定ステップ（60Hz）でシミュレーション
      acc -= STEP;
      readInput();
      game.update(STEP, input);
      if (state !== "playing") break; // レベルアップ／死亡で抜けたら残りステップを捨てる
    }
    if (acc > STEP) acc = 0;
  }

  // エフェクトの時間進行と描画は全状態で続ける（メニューの裏でも世界が呼吸する）
  if (state !== "pause") { game.updateVisuals(real); updateAmbient(real); }
  if (state === "levelup") preview.update(real); // カード内の見本エフェクトを進める
  render(game, ctx);
  ui.updateHUD(game);
  requestAnimationFrame(loop);
}

// タイトル背景用に一度だけリセット（プレイヤーが草原に立っている絵を作る）
game.reset();
ui.renderShop(buyMeta); // タイトル常設のショップを初期描画
requestAnimationFrame(loop);
