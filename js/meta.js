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

/** 購入成功なら true。コインを減らしてレベルを 1 上げる */
export function buy(id) {
  if (!canBuy(id)) return false;
  save.bank -= META_UPGRADES[id].cost(getLevel(id));
  save.buys[id] = getLevel(id) + 1;
  persist();
  return true;
}
