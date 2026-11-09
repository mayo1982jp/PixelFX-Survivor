// レベルデザイン調整パネル：js/game.js の TUNE をスライダーでリアルタイムに変更。
// 表示は F1 / T キー、または常時表示の「TUNE」ボタンでオンオフ（localStorage に保存）。
import { TUNE, DEFAULT_TUNE, applyTuneSideEffects, saveTune, resetTune } from "./game.js";

const VIS_KEY = "pixelSurvivor.debugVisible";

// グループ名とパラメーター定義（label は日本語、key は game.js の TUNE 対応）
const GROUPS = [
  { title: "ゲーム進行", params: [
    { key: "winTime", label: "クリア生存時間", min: 60, max: 600, step: 10, fmt: (v) => `${v}秒`, note: "到達で勝利" },
    { key: "xpBase", label: "必要XP 基礎", min: 1, max: 30, step: 1, fmt: (v) => `${v}` },
    { key: "xpLinear", label: "必要XP 直線係数", min: 0, max: 20, step: 0.5, fmt: (v) => `${v}` },
    { key: "xpQuad", label: "必要XP 二次係数", min: 0, max: 4, step: 0.1, fmt: (v) => `${v}` },
  ] },
  { title: "敵湧き", params: [
    { key: "maxEnemies", label: "敵の同時上限", min: 10, max: 250, step: 10, fmt: (v) => `${v}体` },
    { key: "spawnBase", label: "通常湧き間隔（初期）", min: 0.3, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}秒` },
    { key: "spawnDecay", label: "湧き短縮係数", min: 0, max: 0.008, step: 0.0002, fmt: (v) => `${v.toFixed(4)}` },
    { key: "spawnMin", label: "湧き間隔 下限", min: 0.05, max: 0.8, step: 0.02, fmt: (v) => `${v.toFixed(2)}秒` },
    { key: "eliteTime", label: "精鋭解禁時間", min: 0, max: 180, step: 5, fmt: (v) => `${v}秒` },
    { key: "eliteRate", label: "精鋭出現率", min: 0, max: 0.3, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { title: "群れ・ボス", params: [
    { key: "swarmFirst", label: "群れ初回", min: 5, max: 60, step: 1, fmt: (v) => `${v}秒` },
    { key: "swarmInterval", label: "群れ間隔", min: 10, max: 90, step: 1, fmt: (v) => `${v}秒` },
    { key: "swarmBase", label: "群れ人数（基礎）", min: 0, max: 30, step: 1, fmt: (v) => `${v}体` },
    { key: "swarmDiv", label: "群れ人数 増加除数", min: 5, max: 60, step: 1, fmt: (v) => `${v}` },
    { key: "bossFirst", label: "ボス初回", min: 10, max: 120, step: 5, fmt: (v) => `${v}秒` },
    { key: "bossInterval", label: "ボス間隔", min: 20, max: 120, step: 5, fmt: (v) => `${v}秒` },
  ] },
  { title: "敵スケーリング", params: [
    { key: "hpDiv", label: "敵HP 時間スケール除数", min: 40, max: 300, step: 5, fmt: (v) => `${v}` },
    { key: "hpK", label: "敵HP 時間スケール係数", min: 0, max: 3, step: 0.1, fmt: (v) => `${v}×` },
    { key: "dmgDiv", label: "敵ダメージ スケール除数", min: 80, max: 600, step: 10, fmt: (v) => `${v}` },
    { key: "eliteHpMult", label: "精鋭 HP倍率", min: 1, max: 10, step: 0.5, fmt: (v) => `${v}×` },
    { key: "eliteDmgMult", label: "精鋭 ダメージ倍率", min: 1, max: 2.5, step: 0.1, fmt: (v) => `${v}×` },
    { key: "eliteSpdMult", label: "精鋭 速度倍率", min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${v}×` },
    { key: "spdVar", label: "敵速度ばらつき ±", min: 0, max: 0.5, step: 0.01, fmt: (v) => `±${Math.round(v * 100)}%` },
    { key: "enemyHpMult", label: "全敵 HP倍率", min: 0.2, max: 5, step: 0.1, fmt: (v) => `${v}×` },
    { key: "enemySpdMult", label: "全敵 速度倍率", min: 0.5, max: 2, step: 0.05, fmt: (v) => `${v}×` },
    { key: "enemyDmgMult", label: "全敵 ダメージ倍率", min: 0.2, max: 3, step: 0.1, fmt: (v) => `${v}×` },
    { key: "enemyXpMult", label: "全敵 XP倍率", min: 0.2, max: 5, step: 0.1, fmt: (v) => `${v}×` },
  ] },
  { title: "プレイヤー", params: [
    { key: "playerSpeed", label: "移動速度", min: 20, max: 120, step: 1, fmt: (v) => `${v}` },
    { key: "playerMaxHp", label: "最大HP（基礎）", min: 50, max: 300, step: 10, fmt: (v) => `${v}` },
    { key: "playerCrit", label: "クリティカル率", min: 0, max: 0.5, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "playerMagnet", label: "拾得範囲（基礎）", min: 10, max: 100, step: 1, fmt: (v) => `${v}` },
    { key: "playerIframes", label: "被弾後無敵時間", min: 0, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}秒` },
    { key: "accel", label: "加速イージング", min: 1, max: 30, step: 0.5, fmt: (v) => `${v}` },
    { key: "decel", label: "減速イージング", min: 1, max: 30, step: 0.5, fmt: (v) => `${v}` },
    { key: "dmgMultExtra", label: "与えるダメージ倍率", min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v}×` },
    { key: "cdMultExtra", label: "攻撃間隔倍率", min: 0.3, max: 2, step: 0.05, fmt: (v) => `${v}×`, note: "1=初期" },
  ] },
  { title: "経済・回復", params: [
    { key: "heartHeal", label: "ハート回復量", min: 1, max: 50, step: 1, fmt: (v) => `${v}` },
    { key: "heartRate", label: "ハート落ち率（通常）", min: 0, max: 0.2, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: "heartRateElite", label: "ハート落ち率（精鋭）", min: 0, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "coinMultExtra", label: "コイン取得倍率", min: 0.1, max: 5, step: 0.1, fmt: (v) => `${v}×` },
  ] },
  { title: "ダッシュ・イベント", params: [
    { key: "dashCd", label: "ダッシュ クールダウン", min: 0.5, max: 6, step: 0.1, fmt: (v) => `${v.toFixed(1)}秒` },
    { key: "dashTime", label: "ダッシュ 持続時間", min: 0.05, max: 0.5, step: 0.01, fmt: (v) => `${v.toFixed(2)}秒` },
    { key: "dashSpeed", label: "ダッシュ 速度倍率", min: 1.5, max: 6, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
    { key: "eventFirst", label: "イベント初回", min: 5, max: 180, step: 5, fmt: (v) => `${v}秒`, note: "次ランから" },
    { key: "eventInterval", label: "イベント間隔（中心）", min: 20, max: 180, step: 5, fmt: (v) => `${v}秒`, note: "±7秒で抽選。既定68→61〜75秒" },
  ] },
  { title: "演出", params: [
    { key: "hitStopScale", label: "ヒットストップ倍率", min: 0, max: 2, step: 0.05, fmt: (v) => `${v}×` },
    { key: "shakeScale", label: "画面シェイク倍率", min: 0, max: 2, step: 0.05, fmt: (v) => `${v}×` },
  ] },
];

let gRef = null;
let visible = true;
const rowByKey = new Map();

function fmtVal(p, v) { return p.fmt ? p.fmt(v) : String(v); }

function buildPanel() {
  const panel = document.getElementById("debugPanel");
  const body = document.getElementById("debugBody");
  const toggle = document.getElementById("debugToggle");
  if (!panel || !body || !toggle) return null;

  for (const grp of GROUPS) {
    const sec = document.createElement("details");
    sec.className = "dbgGroup";
    sec.open = true;
    const sum = document.createElement("summary");
    sum.textContent = grp.title;
    sec.appendChild(sum);
    const list = document.createElement("div");
    list.className = "dbgRows";

    for (const p of grp.params) {
      if (!(p.key in DEFAULT_TUNE)) continue;
      const row = document.createElement("div");
      row.className = "dbgRow";
      row.dataset.key = p.key;

      const head = document.createElement("div");
      head.className = "dbgHead";
      const lab = document.createElement("span");
      lab.className = "dbgLabel";
      lab.textContent = p.label + (p.note ? `（${p.note}）` : "");
      const val = document.createElement("span");
      val.className = "dbgVal";
      val.textContent = fmtVal(p, TUNE[p.key]);
      head.appendChild(lab);
      head.appendChild(val);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = String(p.step);
      input.value = String(TUNE[p.key]);
      input.setAttribute("aria-label", p.label);
      input.dataset.key = p.key;

      input.addEventListener("input", () => {
        const next = Number(input.value);
        if (!Number.isFinite(next)) return;
        const prev = TUNE[p.key];
        if (prev === next) { val.textContent = fmtVal(p, next); return; }
        TUNE[p.key] = next;
        applyTuneSideEffects(gRef, p.key, prev, next);
        val.textContent = fmtVal(p, next);
        saveTune();
      });

      row.appendChild(head);
      row.appendChild(input);
      list.appendChild(row);
      rowByKey.set(p.key, { input, val, param: p });
    }
    sec.appendChild(list);
    body.appendChild(sec);
  }
  return { panel, toggle };
}

function applyVisibility() {
  const panel = document.getElementById("debugPanel");
  const toggle = document.getElementById("debugToggle");
  if (!panel || !toggle) return;
  panel.classList.toggle("hidden", !visible);
  toggle.setAttribute("aria-expanded", String(visible));
  toggle.textContent = visible ? "✕ TUNE OFF" : "⚙ TUNE";
  try { localStorage.setItem(VIS_KEY, visible ? "1" : "0"); } catch { /* ignore */ }
}

export function toggleDebug(force) {
  visible = typeof force === "boolean" ? force : !visible;
  applyVisibility();
}

export function initDebug(game) {
  gRef = game;
  let saved = null;
  try { saved = localStorage.getItem(VIS_KEY); } catch { /* ignore */ }
  visible = saved !== "0"; // 初期表示あり。以前 OFF なら OFF を維持

  const built = buildPanel();
  if (!built) return;
  const { toggle } = built;

  toggle.addEventListener("click", () => toggleDebug());
  document.getElementById("debugClose")?.addEventListener("click", () => toggleDebug(false));
  document.getElementById("debugReset")?.addEventListener("click", () => {
    // スライダーをすべてデフォルトに戻す（現在の g へ即反映、保存も上書き）
    for (const [key, entry] of rowByKey) {
      const prev = TUNE[key];
      const next = DEFAULT_TUNE[key];
      if (prev !== next) {
        TUNE[key] = next;
        applyTuneSideEffects(gRef, key, prev, next);
      }
      entry.input.value = String(next);
      entry.val.textContent = fmtVal(entry.param, next);
    }
    resetTune();
  });

  applyVisibility();

  // キーでオンオフ（F1 と T に対応）。main 側でも同じキーを拾う前提だが、ここでも処理して UI を反映。
  // イベントの二重発火を避けるため main 側には任せず、ここでのみ処理する。
  addEventListener("keydown", (ev) => {
    if (ev.code === "F1") {
      ev.preventDefault();
      toggleDebug();
    } else if (ev.code === "KeyT" && !ev.repeat) {
      // スライダー入力中（フォーカス）の T はキーボード操作を邪魔しないよう無視
      const t = ev.target;
      if (t && t.closest && t.closest("#debugPanel")) return;
      toggleDebug();
    }
  }, { passive: false });
}
