// 永続強化（メタ）システム：ゲームオーバー／勝利で得たコインを localStorage に貯め、
// 次のラン以降に効く恒久ボーナスへ変換する。保存は { bank, buys: { id: lv } } のみ。
const KEY = "pixelSurvivor.meta.v1";

// 強化一覧。cost(lv) は「現在のレベル lv を次のレベルにする値段」。
export const META_UPGRADES = {
  vitality: { name: "活力", desc: "開始時の最大HP +20", max: 5, cost: (lv) => 25 + lv * 35 },
  might: { name: "剛力", desc: "すべてのダメージ +6%", max: 5, cost: (lv) => 30 + lv * 40 },
  swift: { name: "疾風", desc: "移動速度 +4%", max: 5, cost: (lv) => 30 + lv * 40 },
  greed: { name: "強欲", desc: "コインの取得量 +20%", max: 5, cost: (lv) => 25 + lv * 35 },
  magnet: { name: "求心", desc: "拾得範囲 +15%", max: 5, cost: (lv) => 20 + lv * 30 },
  regen: { name: "回生", desc: "HP自然回復 +0.3/秒", max: 5, cost: (lv) => 35 + lv * 45 },
};
export const META_ORDER = Object.keys(META_UPGRADES);

function loadRaw() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === "object") return { bank: Math.max(0, s.bank | 0), buys: (s.buys && typeof s.buys === "object") ? s.buys : {} };
  } catch { /* 破損時は初期状態からやり直し */ }
  return { bank: 0, buys: {} };
}
const save = loadRaw();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* 保存不可でもゲームは続行 */ } };

export function getLevel(id) { return save.buys[id] | 0; }
export function getBank() { return save.bank; }
export function addBank(n) { save.bank += Math.max(0, Math.round(n)); persist(); }

/** 現在のコインで買えるかどうか（レベル上限も含めて判定） */
export function canBuy(id) {
  const lv = getLevel(id);
  return lv < META_UPGRADES[id].max && save.bank >= META_UPGRADES[id].cost(lv);
}

// ---- 呪い（カース）：ラン開始前に選ぶ自己縛り。1つごとにコイン倍率 ×1.5 ----
const CURSE_KEY = "pixelSurvivor.curse.v1";
export const CURSES = {
  curseHp: { name: "強靭の呪い", desc: "敵HP +50% ／ コイン ×1.5" },
  curseSpd: { name: "疾風の呪い", desc: "敵速度 +20% ／ コイン ×1.5" },
  curseElite: { name: "精鋭の呪い", desc: "精鋭出現率 2倍 ／ コイン ×1.5" },
};
export const CURSE_ORDER = Object.keys(CURSES);
function loadCurses() {
  try {
    const s = JSON.parse(localStorage.getItem(CURSE_KEY));
    if (Array.isArray(s)) return s.filter((id) => id in CURSES);
  } catch { /* 破損時は呪いなし */ }
  return [];
}
let curseSel = loadCurses();
export function getCurses() { return [...curseSel]; }
export function hasCurse(id) { return curseSel.includes(id); }
export function toggleCurse(id) {
  curseSel = hasCurse(id) ? curseSel.filter((c) => c !== id) : [...curseSel, id];
  try { localStorage.setItem(CURSE_KEY, JSON.stringify(curseSel)); } catch { /* ignore */ }
  return getCurses();
}
/** 呪いによるコイン倍率（1つごとに ×1.5 の累乗） */
export function curseCoinMult() { return Math.pow(1.5, curseSel.length); }

// ---- 自己ベスト記録（生存時間・レベル・撃破数） ----
const BEST_KEY = "pixelSurvivor.best.v1";
function loadBest() {
  try {
    const s = JSON.parse(localStorage.getItem(BEST_KEY));
    if (s && typeof s === "object") return { time: +s.time || 0, level: +s.level || 0, kills: +s.kills || 0 };
  } catch { /* 破損時は記録なし */ }
  return { time: 0, level: 0, kills: 0 };
}
let best = loadBest();
export function getBest() { return { ...best }; }
/** ラン結果を記録。返り値は { best, isNew: {time,level,kills} }（今回更新された項目が true） */
export function recordBest(res) {
  const isNew = {
    time: res.time > best.time, level: res.level > best.level, kills: res.kills > best.kills,
  };
  if (isNew.time) best.time = Math.floor(res.time);
  if (isNew.level) best.level = res.level | 0;
  if (isNew.kills) best.kills = res.kills | 0;
  if (isNew.time || isNew.level || isNew.kills) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* ignore */ }
  }
  return { best: { ...best }, isNew };
}

/** 購入成功なら true。コインを減らしてレベルを 1 上げる */
export function buy(id) {
  if (!canBuy(id)) return false;
  save.bank -= META_UPGRADES[id].cost(getLevel(id));
  save.buys[id] = getLevel(id) + 1;
  persist();
  return true;
}

// ---- 実績・図鑑システム ----
const ACH_KEY = "pixelSurvivor.ach.v1";

export const ACHIEVEMENTS = {
  firstClear: { name: "初クリア", desc: "初めて夜明けを迎えた", bonus: 50 },
  firstEvo: { name: "初進化", desc: "初めて武器を進化させた", bonus: 50 },
  finalBossDown: { name: "ラスボス撃破", desc: "夜明けの守護者を倒した", bonus: 50 },
  noDashClear: { name: "ノーダッシュクリア", desc: "ダッシュを使わずクリア", bonus: 50 },
  curseClear: { name: "呪いクリア", desc: "呪いを1つ以上付けてクリア", bonus: 50 },
  allCurseClear: { name: "全呪いクリア", desc: "呪い3種全て付けてクリア", bonus: 50 },
  kills1000: { name: "累計1000キル", desc: "累計で敵を1000体倒した", bonus: 50 },
  kills100run: { name: "1ラン100キル", desc: "1回のランで敵を100体倒した", bonus: 50 },
  kills500run: { name: "1ラン500キル", desc: "1回のランで敵を500体倒した", bonus: 50 },
  butterfly15: { name: "蝶ハンター", desc: "1ランで蝶を15匹倒した", bonus: 50 },
  endless400: { name: "エンドレス400秒", desc: "エンドレスで400秒生存した", bonus: 50 },
  level20: { name: "レベル20到達", desc: "1回のランでレベル20に到達した", bonus: 50 },
  relic5: { name: "レリック5個", desc: "1ランでレリックを5個集めた", bonus: 50 },
  dailyClear: { name: "デイリークリア", desc: "デイリーチャレンジをクリア", bonus: 50 },
};

export const ENEMY_INFO = [
  { id: "slime", name: "スライム", hint: "まっすぐ近づいてくる基本の敵" },
  { id: "frog", name: "カエル", hint: "溜めてから大きく跳ぶ" },
  { id: "ghost", name: "幽霊", hint: "ゆらゆら蛇行しながら接近" },
  { id: "snake", name: "蛇", hint: "速い。周期的にダッシュする" },
  { id: "bat", name: "コウモリ", hint: "飛行。波打つように飛ぶ" },
  { id: "bird", name: "鳥", hint: "最速クラス。加速と減速を繰り返す" },
  { id: "eyeball", name: "眼球", hint: "赤く光ったらチャージの合図" },
  { id: "fish", name: "魚群", hint: "群れの流れに乗ってうねる" },
  { id: "jelly", name: "クラゲ", hint: "倒すと鈍足の泡を残す" },
  { id: "wisp", name: "鬼火", hint: "渦を巻いて近づく" },
  { id: "butterfly", name: "蝶", hint: "近づくと逃げる。高XP" },
  { id: "skull", name: "飛翔髑髏", hint: "ボスとして現れる強敵" },
];

function loadAch() {
  try {
    const s = JSON.parse(localStorage.getItem(ACH_KEY));
    if (s && typeof s === "object") {
      return {
        unlocked: Array.isArray(s.unlocked) ? s.unlocked.filter((id) => id in ACHIEVEMENTS) : [],
        enemyKills: (s.enemyKills && typeof s.enemyKills === "object") ? { ...s.enemyKills } : {},
        evoSeen: Array.isArray(s.evoSeen) ? [...s.evoSeen] : [],
        totalKills: Math.max(0, s.totalKills | 0),
      };
    }
  } catch { /* 破損時は初期状態からやり直し */ }
  return { unlocked: [], enemyKills: {}, evoSeen: [], totalKills: 0 };
}

const achSave = loadAch();
const persistAch = () => { try { localStorage.setItem(ACH_KEY, JSON.stringify(achSave)); } catch { /* ignore */ } };

export function getAch() {
  return {
    unlocked: [...achSave.unlocked],
    enemyKills: { ...achSave.enemyKills },
    evoSeen: [...achSave.evoSeen],
    totalKills: achSave.totalKills,
  };
}

export function isAchUnlocked(id) {
  return achSave.unlocked.includes(id);
}

export function unlockAch(id) {
  if (!(id in ACHIEVEMENTS) || isAchUnlocked(id)) return 0;
  achSave.unlocked.push(id);
  persistAch();
  return ACHIEVEMENTS[id].bonus; // 入金は呼び出し側（game の achPending → bankRun で一括）
}

let lastAchWrite = 0;
export function flushAch() { lastAchWrite = Date.now(); persistAch(); }
export function addEnemyKill(typeId) {
  if (typeId) {
    achSave.enemyKills[typeId] = (achSave.enemyKills[typeId] | 0) + 1;
  }
  achSave.totalKills += 1;
  const now = Date.now(); // 毎キルの localStorage 書き込みは避け、最大1秒に1回だけ保存
  if (now - lastAchWrite > 1000) { lastAchWrite = now; persistAch(); }
}

export function addEvoSeen(evoId) {
  if (evoId && !achSave.evoSeen.includes(evoId)) {
    achSave.evoSeen.push(evoId);
    persistAch();
  }
}
