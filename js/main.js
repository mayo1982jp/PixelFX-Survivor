// エントリポイント：canvas・入力・状態機械・rAF ループの接続。
// 世界（canvas 内）はすべて pixelfx のフレームバッファ経由で描画される。
import { createGame, setViewport } from "./game.js";
import { render, updateAmbient, resetAmbient, resetFrame } from "./render.js";
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
const input = { left: false, right: false, up: false, down: false, ax: 0, ay: 0 };
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
addEventListener("blur", () => { keys.clear(); clearStick(); });

function readInput() {
  input.left = keys.has("ArrowLeft") || keys.has("KeyA") || stickDir.left || padDir.left;
  input.right = keys.has("ArrowRight") || keys.has("KeyD") || stickDir.right || padDir.right;
  input.up = keys.has("ArrowUp") || keys.has("KeyW") || stickDir.up || padDir.up;
  input.down = keys.has("ArrowDown") || keys.has("KeyS") || stickDir.down || padDir.down;
  // Switch コントローラーの左スティックは入力量（倒し込み）を保ったままアナログで渡す
  input.ax = pad.connected ? pad.ax : 0;
  input.ay = pad.connected ? pad.ay : 0;
}

// ---- タッチ：フローティング仮想スティック（移動のみ／攻撃はオート） ---------------
const stickLayer = document.getElementById("stickLayer");
const stickBase = document.getElementById("stickBase");
const stickKnob = document.getElementById("stickKnob");
const stickDir = { left: false, right: false, up: false, down: false };
const stick = { id: null, ox: 0, oy: 0 };
const STICK_MAX = 52;   // つまみ可動半径(px)
const STICK_DEAD = 16;  // デッドゾーン(px)

// 初期判定：coarse pointer / touch API のある端末だけスティックを有効化。
// (ハイブリッド機でも、実際のタッチを検知した瞬間に .touch を付与して表示する)
if (matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window)) {
  document.body.classList.add("touch");
}

function zeroStick() { stickDir.left = stickDir.right = stickDir.up = stickDir.down = false; }
function setKnob(dx, dy) { stickKnob.style.transform = `translate(${dx}px, ${dy}px)`; }
function clearStick() { zeroStick(); stick.id = null; stickLayer.classList.remove("on"); setKnob(0, 0); }

function stickDown(ev) {
  if (state !== "playing") return;              // メニュー/カード表示中は移動を受け付けない
  if (ev.pointerType === "mouse") return;        // デスクトップのマウスは無視（キーボードで操作）
  if (ev.target && ev.target.closest && ev.target.closest("#pauseBtn")) return; // ポーズボタンは優先
  if (stick.id !== null) return;                 // 既に1本操作中
  document.body.classList.add("touch");
  stick.id = ev.pointerId; stick.ox = ev.clientX; stick.oy = ev.clientY;
  stickBase.style.left = ev.clientX + "px";
  stickBase.style.top = ev.clientY + "px";
  setKnob(0, 0);
  stickLayer.classList.add("on");
  zeroStick();
  ev.preventDefault();
}
function stickMove(ev) {
  if (ev.pointerId !== stick.id) return;
  const dx = ev.clientX - stick.ox, dy = ev.clientY - stick.oy;
  const len = Math.hypot(dx, dy);
  if (len > 0) { const k = Math.min(STICK_MAX, len) / len; setKnob(dx * k, dy * k); }
  else setKnob(0, 0);
  if (len > STICK_DEAD) {
    const nx = dx / len, ny = dy / len;         // 正規化ベクトルを 8 方向に変換（ゲーム側で再正規化されるため十分）
    stickDir.left = nx < -0.38; stickDir.right = nx > 0.38;
    stickDir.up = ny < -0.38; stickDir.down = ny > 0.38;
  } else zeroStick();
  ev.preventDefault();
}
function stickUp(ev) { if (ev.pointerId === stick.id) clearStick(); }

addEventListener("pointerdown", stickDown, { passive: false });
addEventListener("pointermove", stickMove, { passive: false });
addEventListener("pointerup", stickUp);
addEventListener("pointercancel", stickUp);

// ---- Switch コントローラー（Gamepad API） -------------------------------------
// 標準マッピング前提：0=下のフェイスボタン（Switch の A）／1=右（B）／9=＋（Start）／
// 12〜15=十字キー／axes[0..1]=左スティック。接続直後はボタン入力を一度受けないと
// enumerate されないブラウザがあるため、毎フレーム getGamepads() を張り直す。
const PAD_BTN = { a: 0, b: 1, x: 2, y: 3, l: 4, r: 5, zl: 6, zr: 7, minus: 8, plus: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };
const PAD_DEAD = 0.24;      // スティックのデッドゾーン
const padDir = { left: false, right: false, up: false, down: false };
const pad = { index: -1, connected: false, ax: 0, ay: 0, edge: new Set(), cursor: 0, held: false };
const padPrev = new Set();  // 前回フレームに押されていたボタン index（立ち上がりエッジ検出用）

function pollPad() {
  pad.edge.clear();
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  const gp = list.find((p) => p && p.index === pad.index) || list.find((p) => p);
  if (!gp) { // 未接続・抜かれた：入力は全部殺す
    if (pad.connected) { pad.connected = false; pad.index = -1; padPrev.clear(); }
    pad.ax = pad.ay = 0;
    padDir.left = padDir.right = padDir.up = padDir.down = false;
    return;
  }
  pad.connected = true;
  pad.index = gp.index;
  const down = (i) => { const b = gp.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };

  // --- 移動：左スティック＋十字キー
  let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  if (Math.abs(ax) < PAD_DEAD) ax = 0;
  if (Math.abs(ay) < PAD_DEAD) ay = 0;
  if (down(PAD_BTN.left)) ax = -1;
  if (down(PAD_BTN.right)) ax = 1;
  if (down(PAD_BTN.up)) ay = -1;
  if (down(PAD_BTN.down)) ay = 1;
  pad.ax = ax; pad.ay = ay;
  padDir.left = ax < -0.38; padDir.right = ax > 0.38;
  padDir.up = ay < -0.38; padDir.down = ay > 0.38;

  // --- ボタンは押した瞬間だけ有効（長押し連打を防ぐ）
  for (const name in PAD_BTN) {
    const i = PAD_BTN[name];
    const on = down(i);
    if (on && !padPrev.has(i)) pad.edge.add(name);
    if (on) padPrev.add(i); else padPrev.delete(i);
  }
  handlePad();
}

function handlePad() {
  const hit = (n) => pad.edge.has(n);
  if (state === "title") {
    // 決定は A（index 0）。Firefox 系は Switch Pro の面ボタン配列が非標準で 0/1 が入れ替わって
    // 見えることがあるため、キャンセル操作の無いタイトル画面だけ両者受けする。
    if (hit("a") || hit("b")) start();
    return;
  }
  if (hit("plus") || hit("l3")) { // ＋／スタート：playing⇔pause をトグル
    if (state === "playing" || state === "pause") togglePause();
    return;
  }
  if (state === "end") {
    if (hit("a")) start();
    else if (hit("b")) backToTitle();
    return;
  }
  if (state === "pause") { if (hit("a")) togglePause(); return; }
  if (state === "levelup" && choices.length) {
    const n = choices.length;
    const step = (padDir.right || hit("right") || hit("r") || hit("zr")) ? 1
      : (padDir.left || hit("left") || hit("l") || hit("zl")) ? -1 : 0;
    if (step && !pad.held) { // スティック押しっぱなしでカーソルが走り過ぎないよう 1 回だけ
      pad.cursor = (pad.cursor + step + n) % n;
      pad.held = true;
      ui.setCardCursor(pad.cursor);
    } else if (!step) pad.held = false;
    if (hit("a")) choose(pad.cursor);
  }
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
game.onEnd = (win) => { clearStick(); state = "end"; ui.showEnd(win, game); };

function openCards() {
  clearStick(); // レベルアップ中は移動停止
  choices = makeChoices(game);
  const entries = ui.showCards(choices, choose);
  pad.cursor = 0; pad.held = false;
  ui.setCardCursor(pad.connected ? 0 : -1); // コントローラーを使っているときだけカーソルを出す
  preview.start(entries); // カード内で見本エフェクトをループ再生
}

function choose(i) {
  if (state !== "levelup" || !choices[i]) return;
  ui.setCardCursor(-1);
  applyChoice(game, choices[i]);
  game.pendingLevels--;
  sfx.select();
  if (game.pendingLevels > 0) openCards(); // 連続レベルアップは次の 3 択へ
  else { ui.hideCards(); preview.stop(); state = "playing"; }
}

function togglePause() {
  if (state === "playing") { clearStick(); state = "pause"; ui.showPause(true); }
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
  clearStick();
  game.reset(); // meta.js の購入レベルが初期ステータスへ反映される
  resetAmbient();
  preview.stop();
  ui.hideCards(); ui.hideEnd(); ui.showPause(false); ui.showTitle(false); ui.showHud(true);
  state = "playing";
}

document.getElementById("startBtn").onclick = start;
document.getElementById("retryBtn").onclick = start;
document.getElementById("toTitleBtn").onclick = backToTitle;
document.getElementById("pauseBtn").onclick = () => togglePause();
document.getElementById("resumeBtn").onclick = () => togglePause();

// ---- ビューポート：キャンバスを画面全面に広げ、アスペクトに合わせた解像度にする ------
const SHORT = 180; // 基準となる短辺の論理ピクセル数（デスクトップ 320×180 と同スケール）
function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const aspect = w / h;
  let vw, vh;
  if (aspect >= 1) { vh = SHORT; vw = Math.round(SHORT * aspect); } // 横長: 高さを基準
  else { vw = SHORT; vh = Math.round(SHORT / aspect); }            // 縦長: 幅を基準
  setViewport(vw, vh);
  canvas.width = vw; canvas.height = vh; // 内部解像度＝論理サイズ（CSS で画面全面に拡大）
  ctx.imageSmoothingEnabled = false;
  resetFrame();
}
addEventListener("resize", resize);
addEventListener("orientationchange", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---- メインループ -------------------------------------------------------------
let last = performance.now(), acc = 0;
const STEP = 1 / 60;

function loop(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  pollPad(); // コントローラーは全状態で張る（メニュー操作にも使う）

  let frozen = false; // ヒットストップ中は世界も演出も一切進めない＝画面が止まる
  if (state === "playing") {
    if (game.hitStop > 0) {
      // 実時間だけで凍結を解く。acc は足さないため、止まった分だけ世界が遅れる（＝ヒットストップ）
      game.hitStop = Math.max(0, game.hitStop - real);
      game.stopCool = Math.max(0, game.stopCool - real);
      frozen = true;
    } else {
      acc += real;
      while (acc >= STEP) { // 固定ステップ（60Hz）でシミュレーション
        acc -= STEP;
        readInput();
        game.update(STEP, input);
        if (state !== "playing") break; // レベルアップ／死亡で抜けたら残りステップを捨てる
      }
      if (acc > STEP) acc = 0;
    }
  } else {
    game.hitStop = 0; // メニュー系へ遷移したら凍結は解消
  }

  // エフェクトの時間進行と描画は全状態で続ける（メニューの裏でも世界が呼吸する）
  if (state !== "pause" && !frozen) { game.updateVisuals(real); updateAmbient(real); }
  if (state === "levelup") preview.update(real); // カード内の見本エフェクトを進める
  render(game, ctx);
  ui.updateHUD(game);
  requestAnimationFrame(loop);
}

// タイトル背景用に一度だけリセット（プレイヤーが草原に立っている絵を作る）
resize(); // 画面サイズから論理解像度を確定（この後の reset / render に反映）
game.reset();
ui.renderShop(buyMeta); // タイトル常設のショップを初期描画
requestAnimationFrame(loop);
