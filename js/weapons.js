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

// ---- 進化武器（Lv8＋対応パッシブLv2 で進化カードが出現。lv は 8 のまま使う） ----
export const EVOLUTIONS = {
  wand: { passive: "haste", evoId: "wandEvo" },
  nova: { passive: "swift", evoId: "novaEvo" },
  thunder: { passive: "luck", evoId: "thunderEvo" },
  smite: { passive: "might", evoId: "smiteEvo" },
  stars: { passive: "magnet", evoId: "starsEvo" },
  flame: { passive: "regen", evoId: "flameEvo" },
};

WEAPONS.wandEvo = {
  name: "ハイパーワンド", tag: "弾・進化", max: MAX_LEVEL, evo: true, base: "wand",
  desc: () => "進化：超連射＋発射数増＋貫通。最も近い敵へプラズマ弾を乱射。",
  cd: (lv) => WEAPONS.wand.cd(lv) * 0.5, dmg: (lv) => WEAPONS.wand.dmg(lv) + 5,
  count: (lv) => WEAPONS.wand.count(lv) + 2,
  fire(g, lv) {
    const p = g.player;
    const src = g.nearestEnemy(p.x, p.y, 160) || { x: p.x + (p.flip ? -80 : 80), y: p.y - 20 };
    const base = Math.atan2(src.y - (p.y - 10), src.x - p.x);
    const n = this.count(lv), spread = 0.18;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * spread;
      g.addProjectile(p.x, p.y - 12, a, 125, 1.8, this.dmg(lv), Math.floor(lv / 4) + 1);
    }
    sfx.shot();
  },
};
WEAPONS.novaEvo = {
  name: "ブリザードノヴァ", tag: "氷・進化", max: MAX_LEVEL, evo: true, base: "nova",
  desc: () => "進化：大半径の吹雪＋長時間減速＋0.5秒後に2発目の余波。",
  cd: (lv) => WEAPONS.nova.cd(lv), dmg: (lv) => Math.round(WEAPONS.nova.dmg(lv) * 1.6),
  radius: (lv) => WEAPONS.nova.radius(lv) + 18,
  fire(g, lv) {
    const p = g.player;
    g.fxWorld.spawn(FX.snowflakeBurst, p.x, p.y, { seed: g.rseed(), count: 10 + lv });
    g.damageArea(p.x, p.y - 8, this.radius(lv), this.dmg(lv), { slow: 3.0, sfx: sfx.nova });
    g.delayed.push({ t: 0.5, x: p.x, y: p.y, r: this.radius(lv) * 0.8, dmg: Math.round(this.dmg(lv) * 0.6), kind: "nova2", slow: 2.0 });
  },
};
WEAPONS.thunderEvo = {
  name: "チェインサンダー", tag: "雷・進化", max: MAX_LEVEL, evo: true, base: "thunder",
  desc: () => "進化：落雷が近くの敵へ60%ダメージで連鎖する。",
  cd: (lv) => WEAPONS.thunder.cd(lv) * 0.9, dmg: (lv) => WEAPONS.thunder.dmg(lv) + 8,
  bolts: (lv) => WEAPONS.thunder.bolts(lv) + 1,
  fire(g, lv) {
    const bolts = this.bolts(lv);
    let any = false;
    for (let b = 0; b < bolts; b++) {
      const e = g.randomEnemy(130);
      if (!e) continue;
      any = true;
      g.fxTop.spawn(FX.lightningStrike, e.x, e.y, { seed: g.rseed() });
      g.delayed.push({ t: 0.76, x: e.x, y: e.y, r: 24 + lv, dmg: this.dmg(lv), kind: "boltChain" });
    }
    if (any) sfx.zap();
  },
};
WEAPONS.smiteEvo = {
  name: "ジャッジメント", tag: "光・進化", max: MAX_LEVEL, evo: true, base: "smite",
  desc: () => "進化：聖光の範囲とダメージが大幅増、強いノックバック。",
  cd: (lv) => WEAPONS.smite.cd(lv) * 0.9, dmg: (lv) => Math.round(WEAPONS.smite.dmg(lv) * 1.7),
  fire(g, lv) {
    const p = g.player;
    const e = g.nearestEnemy(p.x, p.y, 140) || g.randomEnemy(140);
    if (!e) return;
    g.fxTop.spawn(FX.smite, e.x, e.y, { seed: g.rseed() });
    g.fxTop.spawn(FX.manaBurst, e.x, e.y - 10, { seed: g.rseed() });
    g.delayed.push({ t: 0.54, x: e.x, y: e.y, r: 36 + 2 * lv, dmg: this.dmg(lv), kind: "smite" });
    sfx.smite();
  },
};
WEAPONS.starsEvo = {
  name: "メテオレイン", tag: "星・進化", max: MAX_LEVEL, evo: true, base: "stars",
  desc: () => "進化：星の雨の回数・範囲・ダメージが大幅増。",
  cd: (lv) => WEAPONS.stars.cd(lv) * 0.9, hits: (lv) => WEAPONS.stars.hits(lv) + 3,
  dmg: (lv) => Math.round(WEAPONS.stars.dmg(lv) * 1.3),
  fire(g, lv) {
    const c = g.busiestPoint(100);
    if (!c) return;
    g.fxTop.spawn(FX.starFall, c.x, c.y, { seed: g.rseed() });
    for (let i = 0; i < this.hits(lv); i++)
      g.delayed.push({ t: 0.6 + i * 0.45, x: c.x + (Math.random() - 0.5) * 60, y: c.y + (Math.random() - 0.5) * 36, r: 36 + 2 * lv, dmg: this.dmg(lv), kind: "star" });
    sfx.star();
  },
};
WEAPONS.flameEvo = {
  name: "ヘルフレイム", tag: "炎・進化", max: MAX_LEVEL, evo: true, base: "flame",
  desc: () => "進化：燃焼ダメージ大幅増＋燃焼時間が延び、燃えた敵が倒れると近くの敵へ燃え移る。",
  cd: () => 1.6, radius: (lv) => WEAPONS.flame.radius(lv) + 14,
  dps: (lv) => +(WEAPONS.flame.dps(lv) * 1.9).toFixed(1),
  fire(g, lv) {
    const p = g.player;
    g.forEachEnemy((e) => {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= this.radius(lv)) e.burn = Math.max(e.burn, 4.0);
    });
    g.burnDps = this.dps(lv);
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
  wandEvo: (lv) => WEAPONS.wandEvo.count(lv),
  novaEvo: () => 1,
  thunderEvo: (lv) => WEAPONS.thunderEvo.bolts(lv),
  smiteEvo: () => 1,
  starsEvo: (lv) => WEAPONS.starsEvo.hits(lv),
  flameEvo: () => 1,
};

/** 武器1本の期待 DPS（単体想定。dmgMult / cdMult / crit を反映） */
export function weaponDps(stats, id, lv) {
  const w = WEAPONS[id];
  if (id === "flame" || id === "flameEvo") return w.dps(lv) * stats.dmgMult; // 燃焼 DoT はクリティカルせず毎秒継続
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
  const unit = (id) => (id === "flame" || id === "flameEvo" ? "/秒" : "");
  // 進化条件を満たした武器は最優先カードとして必ず出す
  const evoPicks = [];
  for (const w of owned) {
    const ev = EVOLUTIONS[w.id];
    if (!ev || w.lv < MAX_LEVEL || (g.passives[ev.passive] || 0) < 2) continue;
    const ed = WEAPONS[ev.evoId];
    evoPicks.push({
      kind: "evolve", id: w.id, evoId: ev.evoId, title: `進化！ ${ed.name}`,
      desc: ed.desc(0), now: `${WEAPONS[w.id].name} Lv8 ＋ ${PASSIVES[ev.passive].name}Lv2`,
      atk: `攻撃力 ${fmtVal(attackPower(ev.evoId, MAX_LEVEL) * stats.dmgMult)}${unit(ev.evoId)}`,
      dps: `DPS ${fmtVal(weaponDps(stats, w.id, w.lv))} → ${fmtVal(weaponDps(stats, ev.evoId, MAX_LEVEL))}`,
      hint: "進化可能！",
    });
  }
  const pool = [];
  for (const w of owned) {
    const def = WEAPONS[w.id];
    if (def.evo) continue; // 進化済みは最大レベル扱い
    if (w.lv < def.max) {
      const u = unit(w.id);
      const ev = EVOLUTIONS[w.id];
      let hint = "";
      if (ev && w.lv >= 6) {
        const plv = g.passives[ev.passive] || 0;
        hint = (w.lv >= MAX_LEVEL && plv >= 2) ? "進化可能！"
          : `進化条件：${def.name}Lv8 ＋ ${PASSIVES[ev.passive].name}Lv2（現在 パッシブLv${plv}）`;
      }
      pool.push({
        kind: "weapon", id: w.id, title: def.name, desc: def.desc(w.lv), now: `Lv ${w.lv} → ${w.lv + 1}`,
        atk: `攻撃力 ${fmtVal(attackPower(w.id, w.lv) * stats.dmgMult)}${u} → ${fmtVal(attackPower(w.id, w.lv + 1) * stats.dmgMult)}${u}`,
        dps: `DPS ${fmtVal(weaponDps(stats, w.id, w.lv))} → ${fmtVal(weaponDps(stats, w.id, w.lv + 1))}`,
        hint,
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
  // shuffle → 先頭3つ（進化カードは必ず含める）
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = [...evoPicks, ...pool].slice(0, 3);
  return picks.length ? picks : [{ kind: "heal", id: "heal", title: "英霊の息吹", desc: "HPを全回復する", now: "" }];
}

/** カード選択を game に反映する */
export function applyChoice(g, c) {
  if (c.kind === "weapon") g.weapons.find((w) => w.id === c.id).lv++;
  else if (c.kind === "evolve") {
    const w = g.weapons.find((x) => x.id === c.id);
    if (w) { w.id = c.evoId; w.t = 0.3; }
  }
  else if (c.kind === "new") g.weapons.push({ id: c.id, lv: 1, t: 0.3 });
  else if (c.kind === "passive") { g.passives[c.id] = (g.passives[c.id] || 0) + 1; PASSIVES[c.id].apply(g); }
  else if (c.kind === "heal") g.player.hp = g.player.maxHp;
}

// ---- レリック（宝箱から得るラン内限定の固有効果。1ランに同じ物は出ない） ----
export const RELICS = {
  thorns: { name: "荊棘の冠", desc: "被弾時、周囲の敵に反射ダメージ（18範囲・10）を与える", apply() {} },
  echo: { name: "残響の鈴", desc: "10キルごとにランダムな敵へ落雷が落ちる", apply() {} },
  fireTrail: { name: "炎の軌跡", desc: "ダッシュした場所に燃焼ゾーン（1.2秒）を残す", apply() {} },
  magnetCore: { name: "磁心", desc: "拾得範囲 +80%。20秒ごとに全ジェム・コインを吸い寄せる", apply(g) { g.player.stats.magnet *= 1.8; } },
  vampire: { name: "吸血の牙", desc: "50キルごとにHPが5回復する", apply() {} },
  glass: { name: "ガラスの大砲", desc: "全ダメージ +25%、最大HP -20", apply(g) { g.player.stats.dmgMult *= 1.25; g.player.maxHp = Math.max(10, g.player.maxHp - 20); g.player.hp = Math.min(g.player.hp, g.player.maxHp); } },
  gemBomb: { name: "爆裂ジェム", desc: "XPジェムを拾うと小爆発（20範囲・6ダメージ）が起きる", apply() {} },
};
export const RELIC_ORDER = Object.keys(RELICS);

/** 宝箱の3択（未所持レリックから最大3つ） */
export function makeRelicChoices(g) {
  const pool = RELIC_ORDER.filter((id) => !(g.relics || []).includes(id));
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = pool.slice(0, 3).map((id) => ({
    kind: "relic", id, title: RELICS[id].name, desc: RELICS[id].desc, now: "レリック（このラン限り）", atk: "", dps: "", hint: "",
  }));
  return picks.length ? picks : [{ kind: "heal", id: "heal", title: "英霊の息吹", desc: "HPを全回復する", now: "" }];
}
export function applyRelicChoice(g, c) {
  if (c.kind === "relic") {
    if (!g.relics) g.relics = [];
    if (!g.relics.includes(c.id)) { g.relics.push(c.id); RELICS[c.id].apply(g); }
  } else if (c.kind === "heal") g.player.hp = g.player.maxHp;
}
export const hasRelic = (g, id) => !!(g.relics && g.relics.includes(id));
