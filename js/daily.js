// js/daily.js - デイリーチャレンジ生成・集計・ベスト記録管理モジュール

const DAILY_STORAGE_KEY = "pixelSurvivor.daily.v1";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateSeed(dateStr) {
  const s = String(dateStr);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const DAILY_MODIFIERS = [
  {
    id: "enemyDuo",
    name: "二種限定",
    desc: "敵はカエルと蛇だけ",
    enemyTypes: ["frog", "snake"],
  },
  {
    id: "enemyAir",
    name: "空の脅威",
    desc: "敵は飛行タイプだけ",
    enemyTypes: ["bat", "bird", "jelly", "wisp", "butterfly"],
  },
  {
    id: "relicGlass",
    name: "硝子の試練",
    desc: "最初からレリック『ガラスの大砲』所持",
    startRelic: "glass",
  },
  {
    id: "relicMagnet",
    name: "磁心の加護",
    desc: "最初からレリック『磁心』所持",
    startRelic: "magnetCore",
  },
  {
    id: "weaponsDuo",
    name: "武器限定",
    desc: "新しい武器はノヴァとサンダーだけ",
    weaponsOnly: ["nova", "thunder"],
  },
  {
    id: "swift",
    name: "疾風",
    desc: "移動速度 +15%",
    spdMult: 1.15,
  },
  {
    id: "eliteFest",
    name: "精鋭祭り",
    desc: "精鋭出現率 2倍",
    eliteMult: 2,
  },
  {
    id: "xpBoost",
    name: "経験値ブースト",
    desc: "獲得XP +30%",
    xpMult: 1.3,
  },
  {
    id: "dashHalf",
    name: "疾駆",
    desc: "ダッシュのクールダウン半分",
    dashCdMult: 0.5,
  },
];

export function todayStr(d = new Date()) {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getDailyConfig(dateStr = todayStr()) {
  const seed = dateSeed(dateStr);
  const rng = mulberry32(seed);
  const count = rng() < 0.5 ? 2 : 3;
  const pool = DAILY_MODIFIERS.slice();
  const modifiers = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    modifiers.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return {
    date: dateStr,
    seed,
    modifiers,
  };
}

export function summarizeDaily(cfg) {
  const summary = {
    enemyTypes: null,
    startRelics: [],
    weaponsOnly: null,
    spdMult: 1,
    eliteMult: 1,
    xpMult: 1,
    dashCdMult: 1,
  };

  const mods = cfg && Array.isArray(cfg.modifiers) ? cfg.modifiers : [];
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (!m) continue;

    if (Array.isArray(m.enemyTypes)) {
      if (summary.enemyTypes === null) {
        summary.enemyTypes = m.enemyTypes.slice();
      } else {
        for (let j = 0; j < m.enemyTypes.length; j++) {
          const et = m.enemyTypes[j];
          if (!summary.enemyTypes.includes(et)) {
            summary.enemyTypes.push(et);
          }
        }
      }
    }

    if (typeof m.startRelic === "string" && !summary.startRelics.includes(m.startRelic)) {
      summary.startRelics.push(m.startRelic);
    }

    if (Array.isArray(m.weaponsOnly)) {
      summary.weaponsOnly = m.weaponsOnly.slice();
    }

    if (typeof m.spdMult === "number") {
      summary.spdMult *= m.spdMult;
    }

    if (typeof m.eliteMult === "number") {
      summary.eliteMult *= m.eliteMult;
    }

    if (typeof m.xpMult === "number") {
      summary.xpMult *= m.xpMult;
    }

    if (typeof m.dashCdMult === "number") {
      summary.dashCdMult *= m.dashCdMult;
    }
  }

  return summary;
}

function loadAllDailyBests() {
  try {
    const raw = localStorage.getItem(DAILY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function getDailyBest(dateStr) {
  try {
    const all = loadAllDailyBests();
    const rec = all[dateStr];
    if (!rec || typeof rec !== "object") return null;
    return {
      clear: Boolean(rec.clear),
      time: Number(rec.time) || 0,
      level: Number(rec.level) || 1,
      kills: Number(rec.kills) || 0,
    };
  } catch (e) {
    return null;
  }
}

export function recordDailyBest(dateStr, res) {
  const candidate = {
    clear: Boolean(res && res.clear),
    time: Number(res && res.time) || 0,
    level: Number(res && res.level) || 1,
    kills: Number(res && res.kills) || 0,
  };

  try {
    const all = loadAllDailyBests();
    const prev = all[dateStr] && typeof all[dateStr] === "object"
      ? {
          clear: Boolean(all[dateStr].clear),
          time: Number(all[dateStr].time) || 0,
          level: Number(all[dateStr].level) || 1,
          kills: Number(all[dateStr].kills) || 0,
        }
      : null;

    const isBetter =
      !prev ||
      (candidate.clear && !prev.clear) ||
      (candidate.clear === prev.clear && candidate.time > prev.time);

    if (isBetter) {
      all[dateStr] = candidate;
      localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(all));
      return candidate;
    }
    return prev;
  } catch (e) {
    return candidate;
  }
}
