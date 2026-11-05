// 武器とアップグレードの定義。発射ロジックは game (g) が持つ primitives
// （addProjectile / damageArea / delayed / fxレイヤー / nearestEnemy …）の上で組み立てる。
import { FX, PAL } from "./fx.js";
import { sfx } from "./sfx.js";

export const MAX_LEVEL = 8;

// ---- 武器本体 ----------------------------------------------------------------

export const WEAPONS = {
  // ① プラズマワンド ─ 最近の敵へ弾を撃つ（弾自体が pixelfx の plasma-shot）
  wand: {
    name: "プラズマワンド",
    tag: "弾",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "最も近い敵へプラズマ弾を自動発射。" : `発射間隔短縮・ダメージ増加（Lv${lv}→${lv + 1}）`,
    cd: (lv) => 1.15 * Math.pow(0.9, lv - 1),
    dmg: (lv) => 6 + 3 * lv,
    count: (lv) => 1 + Math.floor(lv / 3),
    fire(g, lv) {
      const p = g.player;
      const src = g.nearestEnemy(p.x, p.y, 150) || { x: p.x + (p.flip ? -80 : 80), y: p.y - 20 };
      const base = Math.atan2(src.y - (p.y - 10), src.x - p.x);
      const n = this.count(lv), spread = 0.22;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * spread;
        g.addProjectile(p.x, p.y - 12, a, 110, 1.7, this.dmg(lv), Math.floor(lv / 4));
      }
      sfx.shot();
    },
  },

  // ② フロストノヴァ ─ 周囲の敵に氷の爆発＋減速（snowflake-burst）
  nova: {
    name: "フロストノヴァ",
    tag: "氷",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "周囲に吹雪を炸裂させ、敵を減速させる。" : `半径・ダメージ・減速時間増加（Lv${lv}→${lv + 1}）`,
    cd: (lv) => 5.2 * Math.pow(0.93, lv),
    dmg: (lv) => 5 + 3.5 * lv,
    radius: (lv) => 38 + 4 * lv,
    fire(g, lv) {
      const p = g.player;
      g.fxWorld.spawn(FX.snowflakeBurst, p.x, p.y, { seed: g.rseed(), count: 6 + lv });
      g.damageArea(p.x, p.y - 8, this.radius(lv), this.dmg(lv), { slow: 1.2 + 0.15 * lv, sfx: sfx.nova });
    },
  },

  // ③ サンダーコール ─ ランダムな敵に落雷（lightning-strike、着弾ディレイ付き）
  thunder: {
    name: "サンダーコール",
    tag: "雷",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "画面内の敵に落雷。着弾まで少し間がある。" : `雷の本数・ダメージ増加（Lv${lv}→${lv + 1}）`,
    cd: (lv) => 4.6 * Math.pow(0.94, lv),
    dmg: (lv) => 18 + 9 * lv,
    bolts: (lv) => (lv >= 6 ? 3 : lv >= 3 ? 2 : 1),
    fire(g, lv) {
      const bolts = this.bolts(lv);
      let any = false;
      for (let b = 0; b < bolts; b++) {
        const e = g.randomEnemy(120);
        if (!e) continue;
        any = true;
        g.fxTop.spawn(FX.lightningStrike, e.x, e.y, { seed: g.rseed() });
        g.delayed.push({ t: 0.76, x: e.x, y: e.y, r: 22 + lv, dmg: this.dmg(lv), kind: "bolt" });
      }
      if (any) sfx.zap();
    },
  },

  // ④ ホーリー smite ─ 最寄りの敵へ聖光の杭（smite、範囲着弾）
  smite: {
    name: "ホーリースマイト",
    tag: "光",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "敵の上に聖光が落ち、範囲ダメージを与える。" : `範囲・ダメージ増加（Lv${lv}→${lv + 1}）`,
    cd: (lv) => 6.2 * Math.pow(0.93, lv),
    dmg: (lv) => 26 + 14 * lv,
    fire(g, lv) {
      const p = g.player;
      const e = g.nearestEnemy(p.x, p.y, 130) || g.randomEnemy(130);
      if (!e) return;
      g.fxTop.spawn(FX.smite, e.x, e.y, { seed: g.rseed() });
      g.delayed.push({ t: 0.54, x: e.x, y: e.y, r: 20 + 2 * lv, dmg: this.dmg(lv), kind: "smite" });
      sfx.smite();
    },
  },

  // ⑤ スターコール ─ 敵群的中心へ星の雨（star-fall、多段着弾）
  stars: {
    name: "スターコール",
    tag: "星",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "敵の群れの上へ星の雨。複数回叩きつける。" : `命中率・ダメージ増加（Lv${lv}→${lv + 1}）`,
    cd: (lv) => 8.4 * Math.pow(0.93, lv),
    hits: (lv) => 2 + Math.floor(lv / 2),
    dmg: (lv) => 12 + 6 * lv,
    fire(g, lv) {
      const c = g.busiestPoint(90);
      if (!c) return;
      g.fxTop.spawn(FX.starFall, c.x, c.y, { seed: g.rseed() });
      for (let i = 0; i < this.hits(lv); i++)
        g.delayed.push({ t: 0.6 + i * 0.5, x: c.x + (Math.random() - 0.5) * 40, y: c.y + (Math.random() - 0.5) * 24, r: 30 + 2 * lv, dmg: this.dmg(lv), kind: "star" });
      sfx.star();
    },
  },

  // ⑥ バーンスピリット ─ 周囲の敵に炎を宿し継続ダメージ（spirit-flame を暖色で再配色）
  flame: {
    name: "バーンスピリット",
    tag: "炎",
    max: MAX_LEVEL,
    desc: (lv) => lv === 0 ? "周囲の敵に炎の依代を憑け、燃やし続ける。" : `炎半径・燃焼ダメージ増加（Lv${lv}→${lv + 1}）`,
    cd: () => 1.6,
    radius: (lv) => 36 + 4 * lv,
    dps: (lv) => 2 + 1.6 * lv,
    fire(g, lv) {
      const p = g.player;
      g.forEachEnemy((e) => {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= this.radius(lv)) e.burn = Math.max(e.burn, 2.6);
      });
      g.burnDps = this.dps(lv);
    },
  },
};

export const WEAPON_ORDER = ["wand", "nova", "thunder", "smite", "stars", "flame"];

// ---- 攻撃力・DPS の算出（カード表示と HUD 右下の共通ロジック） ---------------

/** 1回命中あたりの攻撃力（flame だけ dmg を持たないので燃焼ダメージ/秒を使う） */
export function attackPower(id, lv) {
  const w = WEAPONS[id];
  return w.dmg ? w.dmg(lv) : w.dps(lv);
}

// クリティカルは 2.5 倍なので期待値での寄与は `1 + 1.5 × crit率`。
const critFactor = (stats) => 1 + 1.5 * stats.crit;

/** 1 クルリ（1 発射）で同じ敵に入る命中回数。範囲アタックは「単体に当たった」として数える */
const VOLLEY = {
  wand: (lv) => WEAPONS.wand.count(lv),
  nova: () => 1,
  thunder: (lv) => WEAPONS.thunder.bolts(lv),
  smite: () => 1,
  stars: (lv) => WEAPONS.stars.hits(lv),
  flame: () => 1,
};

/** 武器1本の期待 DPS（単体想定。dmgMult / cdMult / crit を反映） */
export function weaponDps(stats, id, lv) {
  const w = WEAPONS[id];
  if (id === "flame") return w.dps(lv) * stats.dmgMult; // 燃焼 DoT はクリティカルせず毎秒継続
  const perCast = w.dmg(lv) * VOLLEY[id](lv) * stats.dmgMult * critFactor(stats);
  return perCast / (w.cd(lv) * stats.cdMult);
}

/** 所持武器の合算 DPS（HUD 右下表示用） */
export function totalDps(stats, weapons) {
  let sum = 0;
  for (const w of weapons) sum += weaponDps(stats, w.id, w.lv);
  return sum;
}

/** 数値表示の整形（桁が増えたら小数を落とす） */
export const fmtVal = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

// DPS に効くパッシブは、選択後の合算 DPS を予測して載せる
const PASSIVE_PATCH = {
  might: (s) => ({ dmgMult: s.dmgMult * 1.12 }),
  haste: (s) => ({ cdMult: s.cdMult * 0.93 }),
  luck: (s) => ({ crit: s.crit + 0.06 }),
};

// ---- パッシブ ----------------------------------------------------------------

export const PASSIVES = {
  might: { name: "怪力", max: 4, desc: "すべてのダメージ +12%", apply: (g) => { g.player.stats.dmgMult *= 1.12; } },
  swift: { name: "俊足", max: 4, desc: "移動速度 +8%", apply: (g) => { g.player.stats.spdMult *= 1.08; } },
  vital: { name: "耐久", max: 4, desc: "最大HP +20 かつ 20 回復", apply: (g) => { g.player.maxHp += 20; g.player.hp = Math.min(g.player.maxHp, g.player.hp + 20); } },
  regen: { name: "再生", max: 4, desc: "HP自然回復 +0.5/秒", apply: (g) => { g.player.stats.regen += 0.5; } },
  magnet: { name: "磁石", max: 4, desc: "拾得範囲 +35%", apply: (g) => { g.player.stats.magnet *= 1.35; } },
  haste: { name: "素早さ", max: 4, desc: "攻撃間隔 -7%", apply: (g) => { g.player.stats.cdMult *= 0.93; } },
  luck: { name: "幸運", max: 4, desc: "クリティカル率 +6%", apply: (g) => { g.player.stats.crit += 0.06; } },
};

const PASSIVE_ORDER = Object.keys(PASSIVES);

// ---- レベルアップ時の 3 択 ----------------------------------------------------

/** 現在選択可能なアップグレードから 3 つのカードを作る */
export function makeChoices(g) {
  const owned = g.weapons; // [{id, lv}]
  const stats = g.player.stats;
  const dpsNow = totalDps(stats, owned);
  const dpsAfter = (patch) => totalDps({ ...stats, ...patch }, owned);
  const unit = (id) => (id === "flame" ? "/秒" : "");
  const pool = [];
  for (const w of owned) {
    const def = WEAPONS[w.id];
    if (w.lv < def.max) {
      const u = unit(w.id);
      pool.push({
        kind: "weapon", id: w.id, title: def.name, desc: def.desc(w.lv), now: `Lv ${w.lv} → ${w.lv + 1}`,
        atk: `攻撃力 ${fmtVal(attackPower(w.id, w.lv) * stats.dmgMult)}${u} → ${fmtVal(attackPower(w.id, w.lv + 1) * stats.dmgMult)}${u}`,
        dps: `DPS ${fmtVal(weaponDps(stats, w.id, w.lv))} → ${fmtVal(weaponDps(stats, w.id, w.lv + 1))}`,
      });
    }
  }
  for (const id of WEAPON_ORDER)
    if (!owned.some((w) => w.id === id) && owned.length < WEAPON_ORDER.length)
      pool.push({
        kind: "new", id, title: WEAPONS[id].name, desc: WEAPONS[id].desc(0), now: "新武器",
        atk: `攻撃力 ${fmtVal(attackPower(id, 1) * stats.dmgMult)}${unit(id)}`,
        dps: `DPS ${fmtVal(weaponDps(stats, id, 1))}`,
      });
  for (const id of PASSIVE_ORDER) {
    const lv = g.passives[id] || 0;
    if (lv < PASSIVES[id].max && g.passiveCount() < 5) {
      const mk = PASSIVE_PATCH[id];
      pool.push({
        kind: "passive", id, title: PASSIVES[id].name, desc: PASSIVES[id].desc, now: `Lv ${lv} → ${lv + 1}`,
        atk: id === "might" ? "攻撃力 +12%（全武器共通）" : "",
        dps: mk ? `DPS ${fmtVal(dpsNow)} → ${fmtVal(dpsAfter(mk(stats)))}` : "",
      });
    }
  }
  // shuffle → 先頭3つ（新武器と武器強化を優遇しつつ混ぜる）
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = pool.slice(0, 3);
  return picks.length ? picks : [{ kind: "heal", id: "heal", title: "英霊の息吹", desc: "HPを全回復する", now: "" }];
}

/** カード選択を game に反映する */
export function applyChoice(g, c) {
  if (c.kind === "weapon") g.weapons.find((w) => w.id === c.id).lv++;
  else if (c.kind === "new") g.weapons.push({ id: c.id, lv: 1, t: 0.3 });
  else if (c.kind === "passive") { g.passives[c.id] = (g.passives[c.id] || 0) + 1; PASSIVES[c.id].apply(g); }
  else if (c.kind === "heal") g.player.hp = g.player.maxHp;
}
