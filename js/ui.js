// DOM による HUD・オーバーレイ管理（canvas の中身は全部 pixelfx、外側は HTML/CSS）
import { WEAPONS, totalDps, fmtVal } from "./weapons.js";
import { TUNE } from "./game.js";
import { META_UPGRADES, META_ORDER, getLevel, getBank, canBuy, CURSES, CURSE_ORDER, hasCurse, curseCoinMult, getBest } from "./meta.js";

const $ = (id) => document.getElementById(id);
const el = {
  hud: $("hud"), xpfill: $("xpfill"), lvl: $("lvl"), clock: $("clock"), kills: $("killcount"),
  coins: $("coincount"), hpfill: $("hpfill"), hptext: $("hptext"), weapons: $("weapons"), dps: $("dps"), dmg: $("dmgflash"),
  title: $("title"), levelup: $("levelup"), cards: $("cards"), pause: $("pause"),
  ending: $("ending"), endTitle: $("endTitle"), endStats: $("endStats"),
  shopList: $("shopList"), shopBank: $("shopBank"),
  bossWrap: $("bossWrap"), bossFill: $("bossFill"), banner: $("banner"),
  dashBtn: $("dashBtn"), dashFill: $("dashFill"), shrineInfo: $("shrineInfo"),
  curseList: $("curseList"), bestLine: $("bestLine"), continueBtn: $("continueBtn"),
};

const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

let lastKey = "";

/** 毎フレーム呼ぶ HUD 更新（変化のときだけ DOM に書く） */
export function updateHUD(g) {
  const p = g.player;
  el.xpfill.style.width = `${Math.min(100, (g.xp / g.xpNeed) * 100)}%`;
  el.lvl.textContent = `Lv ${g.level}`;
  el.clock.textContent = fmt(g.time);
  el.kills.textContent = `${g.kills} KILLS`;
  el.hpfill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
  el.hptext.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
  el.coins.textContent = `${g.coins} C`;
  const dpsText = `DPS ${fmtVal(totalDps(p.stats, g.weapons))}`;
  if (el.dps.textContent !== dpsText) el.dps.textContent = dpsText;
  const key = g.weapons.map((w) => w.id + w.lv).join();
  if (key !== lastKey) {
    lastKey = key;
    el.weapons.innerHTML = g.weapons
      .map((w) => `<span>${WEAPONS[w.id].tag} Lv${w.lv}</span>`)
      .join("");
  }
  // ボスHPバー
  const boss = g.getBoss ? g.getBoss() : null;
  if (el.bossWrap) {
    el.bossWrap.classList.toggle("hidden", !boss);
    if (boss) el.bossFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
  }
  // ダッシュのクールダウン表示（ボタン内のフィル＋使用可否）
  if (el.dashBtn) {
    const frac = g.dashCdT > 0 ? 1 - Math.max(0, g.dashCdT) / TUNE.dashCd : 1;
    el.dashBtn.classList.toggle("ready", frac >= 1);
    if (el.dashFill) el.dashFill.style.height = `${Math.round(frac * 100)}%`;
  }
  // 神殿の進行度
  if (el.shrineInfo) {
    if (g.shrine && !g.shrine.done) {
      el.shrineInfo.classList.remove("hidden");
      el.shrineInfo.textContent = `神殿 ${Math.floor(g.shrine.progress)} / ${g.shrine.need} 秒`;
    } else el.shrineInfo.classList.add("hidden");
  }
}

let bannerTimer = 0;
/** イベント／ボス出現などのバナー表示（数秒で消える） */
export function showBanner(text) {
  if (!el.banner) return;
  el.banner.textContent = text;
  el.banner.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.banner.classList.remove("on"), 2800);
}

export function flashDamage() {
  el.dmg.classList.add("on");
  setTimeout(() => el.dmg.classList.remove("on"), 140);
}

export function showHud(on) { el.hud.classList.toggle("hidden", !on); }
export function showTitle(on) { el.title.classList.toggle("hidden", !on); }
export function showPause(on) { el.pause.classList.toggle("hidden", !on); }

/** レベルアップの 3 択カード。onPick(i) が呼ばれたら裏で選択確定 */
export function showCards(choices, onPick) {
  el.cards.innerHTML = "";
  const entries = [];
  choices.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "card" + (c.kind === "evolve" ? " evolve" : "") + (c.kind === "relic" ? " relic" : "");
    const cv = document.createElement("canvas");
    cv.className = "fxpv";
    d.innerHTML =
      `<div class="no">${i + 1}</div>` +
      `<div class="name ${c.kind === "new" || c.kind === "weapon" || c.kind === "evolve" ? "weapon" : ""}">${c.title}</div>` +
      `<div class="desc">${c.desc}</div>` +
      (c.now ? `<div class="lvnow">${c.now}</div>` : "") +
      (c.atk ? `<div class="stat atk">${c.atk}</div>` : "") +
      (c.dps ? `<div class="stat dpsline">${c.dps}</div>` : "") +
      (c.hint ? `<div class="hint">${c.hint}</div>` : "");
    // 名前の下に見本エフェクトを差し込む
    d.insertBefore(cv, d.querySelector(".desc"));
    d.onclick = () => onPick(i);
    el.cards.appendChild(d);
    entries.push({ canvas: cv, choice: c });
  });
  el.levelup.classList.remove("hidden");
  return entries;
}
export function hideCards() { el.levelup.classList.add("hidden"); }

/** コントローラー選択用のカーソル。-1 で非表示（キーボード・タッチ運用） */
export function setCardCursor(i) {
  [...el.cards.children].forEach((c, k) => c.classList.toggle("sel", k === i));
}

export function pickCardByIndex(i, choices, onPick) {
  if (i < 0 || i >= choices.length) return;
  onPick(i);
}

/** 終了画面（win=true で夜明けの勝利）。コインは finish() で既に貯金へ入金済み */
export function showEnd(win, g) {
  el.ending.classList.toggle("win", win);
  el.endTitle.textContent = win ? "DAWN BREAKS ― 夜明け" : "YOU DIED";
  const lb = g.lastBest;
  const nr = (flag) => (flag ? ' <span class="newrec">NEW RECORD!</span>' : "");
  const bankLine = g.banked
    ? `獲得コイン <b>${g.coins}</b>（累計貯金 <b>${getBank()}</b>）<br>`
    : `獲得コイン <b>${g.coins}</b>（エンドレス終了時／タイトルに戻ると貯金されます）<br>`;
  el.endStats.innerHTML =
    `生存時間 <b>${fmt(g.time)}</b>${lb ? nr(lb.isNew.time) : ""}<br>` +
    `撃破数 <b>${g.kills}</b>${lb ? nr(lb.isNew.kills) : ""}<br>` +
    `レベル <b>${g.level}</b>${lb ? nr(lb.isNew.level) : ""}<br>` +
    bankLine +
    (g.relics && g.relics.length ? `レリック <b>${g.relics.length}個</b><br>` : "") +
    `武器 <b>${g.weapons.map((w) => WEAPONS[w.id].name).join(" / ")}</b>`;
  // 勝利時のみ「エンドレスで続ける」を出す（既にエンドレス中の死亡では出さない）
  if (el.continueBtn) el.continueBtn.classList.toggle("hidden", !(win && g.wonOnce && !g.endless));
  el.ending.classList.remove("hidden");
  syncBank();
}

/** タイトルの自己ベスト表示を更新 */
export function renderBest() {
  if (!el.bestLine) return;
  const b = getBest();
  el.bestLine.textContent = b.time > 0
    ? `BEST 生存 ${fmt(b.time)} ／ Lv ${b.level} ／ ${b.kills} KILLS`
    : "BEST 記録なし";
}

/** タイトルの呪い選択UIを再構築。onToggle(id) を配線する */
export function renderCurses(onToggle) {
  if (!el.curseList) return;
  el.curseList.innerHTML = "";
  for (const id of CURSE_ORDER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "curseBtn" + (hasCurse(id) ? " on" : "");
    btn.innerHTML = `${CURSES[id].name}<span>${CURSES[id].desc}</span>`;
    btn.onclick = () => onToggle(id);
    el.curseList.appendChild(btn);
  }
  const mult = document.createElement("div");
  mult.className = "curseMult";
  mult.textContent = `現在のコイン倍率 ×${curseCoinMult().toFixed(2).replace(/\.?0+$/, "")}`;
  el.curseList.appendChild(mult);
}
export function hideEnd() { el.ending.classList.add("hidden"); }

/** タイトル常設ショップの保有コイン表示を最新化 */
export function syncBank() { el.shopBank.textContent = getBank(); }

/** タイトル画面のショップ一覧を再構築。onBuy(id) をクリック可能な行に配線する */
export function renderShop(onBuy) {
  el.shopBank.textContent = getBank();
  el.shopList.innerHTML = "";
  for (const id of META_ORDER) {
    const u = META_UPGRADES[id];
    const lv = getLevel(id);
    const maxed = lv >= u.max;
    const row = document.createElement("div");
    row.className = "shopItem" + (maxed ? " maxed" : "");
    const pips = Array.from({ length: u.max }, (_, i) => (i < lv ? "●" : "○")).join("");
    row.innerHTML =
      `<div class="sname" data-pips="${pips}">${u.name}</div>` +
      `<div class="sdesc">${u.desc}</div>`;
    const btn = document.createElement("button");
    btn.className = "sbuy";
    if (maxed) { btn.textContent = "MAX"; btn.disabled = true; }
    else {
      btn.textContent = `${u.cost(lv)} C`;
      btn.disabled = !canBuy(id);
      btn.onclick = () => onBuy(id);
    }
    row.appendChild(btn);
    el.shopList.appendChild(row);
  }
}
