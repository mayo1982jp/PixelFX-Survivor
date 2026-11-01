// DOM による HUD・オーバーレイ管理（canvas の中身は全部 pixelfx、外側は HTML/CSS）
import { WEAPONS } from "./weapons.js";
import { META_UPGRADES, META_ORDER, getLevel, getBank, canBuy } from "./meta.js";

const $ = (id) => document.getElementById(id);
const el = {
  hud: $("hud"), xpfill: $("xpfill"), lvl: $("lvl"), clock: $("clock"), kills: $("killcount"),
  coins: $("coincount"), hpfill: $("hpfill"), hptext: $("hptext"), weapons: $("weapons"), dmg: $("dmgflash"),
  title: $("title"), levelup: $("levelup"), cards: $("cards"), pause: $("pause"),
  ending: $("ending"), endTitle: $("endTitle"), endStats: $("endStats"),
  shopList: $("shopList"), shopBank: $("shopBank"),
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
  const key = g.weapons.map((w) => w.id + w.lv).join();
  if (key !== lastKey) {
    lastKey = key;
    el.weapons.innerHTML = g.weapons
      .map((w) => `<span>${WEAPONS[w.id].tag} Lv${w.lv}</span>`)
      .join("");
  }
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
    d.className = "card";
    const cv = document.createElement("canvas");
    cv.className = "fxpv";
    d.innerHTML =
      `<div class="no">${i + 1}</div>` +
      `<div class="name ${c.kind === "new" || c.kind === "weapon" ? "weapon" : ""}">${c.title}</div>` +
      `<div class="desc">${c.desc}</div>` +
      (c.now ? `<div class="lvnow">${c.now}</div>` : "");
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

export function pickCardByIndex(i, choices, onPick) {
  if (i < 0 || i >= choices.length) return;
  onPick(i);
}

/** 終了画面（win=true で夜明けの勝利）。コインは finish() で既に貯金へ入金済み */
export function showEnd(win, g) {
  el.ending.classList.toggle("win", win);
  el.endTitle.textContent = win ? "DAWN BREAKS ― 夜明け" : "YOU DIED";
  el.endStats.innerHTML =
    `生存時間 <b>${fmt(g.time)}</b><br>` +
    `撃破数 <b>${g.kills}</b><br>` +
    `レベル <b>${g.level}</b><br>` +
    `獲得コイン <b>${g.coins}</b>（累計貯金 <b>${getBank()}</b>）<br>` +
    `武器 <b>${g.weapons.map((w) => WEAPONS[w.id].name).join(" / ")}</b>`;
  el.ending.classList.remove("hidden");
  syncBank();
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
