// Gemini改善10件（スロット/リロール/バニッシュ、スタイル、ダメージ内訳、ジャスト回避、
// シナジー拡張、ラスボス、天候効果、実績/図鑑、props/即時アイテム、デイリー）の
// ヘッドレス直接トリガーテスト。`node tools/check_gemini2.mjs` で実行。
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { createGame, setViewport, TUNE } = await import("../js/game.js");
const { FX } = await import("../js/fx.js");
const W = await import("../js/weapons.js");
const meta = await import("../js/meta.js");
const witch = await import("../js/witch.js");
const daily = await import("../js/daily.js");

setViewport(320, 180);
const DT = 1 / 60;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const T = (id, extra = {}) => ({ id, mod: FX[id === "fish" ? "fishSchool" : id === "skull" ? "flyingSkull" : id === "jelly" ? "jellyfish" : id], hp: 1000, spd: 30, r: 12, dmg: 6, xp: 3, at: 0, w: 1, ...extra });
function fresh() {
  const g = createGame();
  g.reset();
  g.weapons = [];
  g.spawnT = 1e9; g.swarmT = 1e9; g.bossT = 1e9; g.eventT = 1e9;
  g.player.stats.crit = 0;
  return g;
}
const step = (g, n, input = {}) => { for (let i = 0; i < n; i++) g.update(DT, input); };
const approx = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;

console.log("=== 1. スロット上限／リロール／バニッシュ ===");
{
  const g = fresh();
  g.weapons = ["wand", "nova", "thunder", "smite"].map((id) => ({ id, lv: 1, t: 0 }));
  let hasNew = false;
  for (let i = 0; i < 12; i++) for (const c of W.makeChoices(g)) if (c.kind === "new") hasNew = true;
  ok("武器4枠が満杯だと新規武器カードが出ない", !hasNew);
  g.passives = { might: 1, swift: 1, vital: 1, guard: 1 };
  let hasNewPassive = false;
  for (let i = 0; i < 12; i++) for (const c of W.makeChoices(g)) if (c.kind === "passive" && !(c.id in g.passives)) hasNewPassive = true;
  ok("パッシブ4種が満杯だと新規パッシブカードが出ない", !hasNewPassive);
}
{
  const g = fresh();
  g.weapons = [{ id: "wand", lv: 1, t: 0 }];
  ok("リロール初期回数は2", g.rerolls === 2);
  const c1 = W.rerollChoices(g);
  ok("リロールで選択肢が引き直され回数が減る", Array.isArray(c1) && c1.length >= 1 && g.rerolls === 1, `rerolls=${g.rerolls}`);
  g.rerolls = 0;
  ok("リロール残り0では null（消費しない）", W.rerollChoices(g) === null && g.rerolls === 0);
  const pool = W.banishChoices(g);
  ok("バニッシュ候補（未所持プール）が出る", pool.length >= 5, `n=${pool.length}`);
  const flame = pool.find((c) => c.id === "flame");
  W.applyBanish(g, flame);
  ok("バニッシュで回数が減り除外リストに入る", g.banishes === 1 && g.banished.includes("flame"));
  let offered = false;
  for (let i = 0; i < 20; i++) for (const c of W.makeChoices(g)) if (c.id === "flame") offered = true;
  ok("バニッシュした武器はカードに出ない", !offered);
}

console.log("=== 2. スタイル（衣装） ===");
{
  const styled = (sid) => { witch.saveStyleId(sid); const g = createGame(); g.reset(); return g; };
  const cases = [
    ["violet", "wand"], ["crimson", "flame"], ["azure", "nova"], ["amber", "thunder"], ["verdant", "smite"],
  ];
  for (const [sid, w] of cases) {
    const g = styled(sid);
    ok(`スタイル ${sid} の初期武器は ${w}`, g.weapons[0] && g.weapons[0].id === w, `got=${g.weapons[0] && g.weapons[0].id}`);
    ok(`スタイル ${sid} が g.styleId に反映`, g.styleId === sid);
  }
  const gc = styled("crimson");
  ok("紅：燃焼ダメージ +20%（burnMult 1.2）", approx(gc.burnMult, 1.2, 0.001), `burnMult=${gc.burnMult}`);
  ok("紅：最大HP -15", gc.player.maxHp === TUNE.playerMaxHp - 15, `maxHp=${gc.player.maxHp}`);
  const ga = styled("azure");
  ok("蒼：移動速度 +10%", approx(ga.player.stats.spdMult, 1.1, 0.001), `spdMult=${ga.player.stats.spdMult}`);
  const gy = styled("amber");
  ok("黄：クリティカル率 +8%", approx(gy.player.stats.crit, TUNE.playerCrit + 0.08, 0.001), `crit=${gy.player.stats.crit}`);
  const gv = styled("verdant");
  ok("緑：HP自然回復 +0.4/秒", approx(gv.player.stats.regen, 0.4, 0.001), `regen=${gv.player.stats.regen}`);
  ok("スタイル選択は localStorage に保存される", witch.loadStyleId() === "verdant");
  witch.saveStyleId("violet");
}

console.log("=== 3. ダメージ内訳の集計 ===");
{
  const g = fresh();
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 60, 0, false);
  e.hp = 100000; e.maxHp = 100000;
  const hp0 = e.hp;
  g.damageEnemy(e, 100, { src: "wand" });
  g.damageEnemy(e, 50, { src: "nova", kind: "ice" });
  g.damageEnemy(e, 30, { src: "thorns" });
  const lost = hp0 - e.hp;
  const sum = Object.values(g.dmgStats).reduce((s, r) => s + r.dmg, 0);
  ok("ソース別ダメージの合計 ≒ 実際に減ったHP", approx(sum, lost, 0.01), `sum=${sum} lost=${lost}`);
  ok("ソース別に記録される（wand/nova/thorns）", g.dmgStats.wand.dmg === 100 && g.dmgStats.nova.dmg === 50 && g.dmgStats.thorns.dmg === 30);
  // 燃焼DoTの帰属
  g.burnDps = 20; e.burn = 1.0;
  step(g, 40);
  ok("燃焼DoTが flame ソースに集計される", (g.dmgStats.flame || { dmg: 0 }).dmg > 0, `flame=${JSON.stringify(g.dmgStats.flame)}`);
  // キル帰属
  const e2 = g.spawnEnemy(T("slime", { spd: 0 }), 30, 0, false);
  e2.hp = 5;
  g.damageEnemy(e2, 10, { src: "wand" });
  ok("キルが最終ヒットのソースに帰属する", g.dmgStats.wand.kills >= 1, `kills=${g.dmgStats.wand.kills}`);
}

console.log("=== 4. ジャスト回避 ===");
{
  const g = fresh();
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 8, 0, false);
  step(g, 1, { dash: true, right: true });
  ok("ダッシュですり抜けるとジャスト回避が発動", g.justCount === 1, `just=${g.justCount}`);
  ok("ダッシュCDが50%返還される", g.dashCdT < TUNE.dashCd * 0.6, `dashCdT=${g.dashCdT}`);
  ok("攻撃間隔バフが有効（justBuffT>0）", g.justBuffT > 0);
  const xpGain = g.xp > 0 || g.pickups.some((it) => it.kind === "xp");
  ok("XPジェムが放出される", xpGain);
  step(g, 200);
  ok("バフは3秒で切れる（重ね掛け・複利なし）", g.justBuffT === 0, `justBuffT=${g.justBuffT}`);
  ok("プレイヤー本体 stats.cdMult は書き換わらない", g.player.stats.cdMult === TUNE.cdMultExtra ?? true);
}
{
  const g = fresh();
  const e = g.spawnEnemy(T("slime", { spd: 0, dmg: 6 }), 8, 0, false);
  const hp0 = g.player.hp;
  step(g, 2, {});
  ok("ダッシュしていない接触ではジャスト回避は発動せず被弾する", g.justCount === 0 && g.player.hp < hp0, `hp=${g.player.hp}`);
}

console.log("=== 5. シナジー拡張（融解／誘爆／感電） ===");
{
  const g = fresh();
  g.burnDps = 10;
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 40, 0, false);
  e.hp = 100000; e.maxHp = 100000; e.burn = 2.0;
  g.damageEnemy(e, 5, { kind: "ice", src: "nova" });
  ok("融解：燃焼が消費される", e.burn === 0, `burn=${e.burn}`);
  ok("融解：残り燃焼ぶんが melt ダメージとして精算される", approx((g.dmgStats.melt || { dmg: 0 }).dmg, 20, 0.01), `melt=${JSON.stringify(g.dmgStats.melt)}`);
}
{
  const g = fresh();
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 40, 0, false);
  g.damageEnemy(e, 1, { electrify: 3, src: "smite" });
  ok("感電：スマイト着弾で elect デバフが付く", (e.elect || 0) > 2.9, `elect=${e.elect}`);
  let crits = 0;
  for (let i = 0; i < 200; i++) {
    const t = g.spawnEnemy(T("slime", { spd: 0 }), 200 + i, 200, false);
    t.hp = 100000; t.maxHp = 100000; t.elect = 3;
    const before = t.hp;
    g.damageEnemy(t, 100, { src: "wand" });
    if (before - t.hp > 200) crits++; // 2.5倍 = クリティカル
    g.enemies.splice(g.enemies.indexOf(t), 1);
  }
  ok("感電：その敵へのクリティカル率が上がる（200回中5回以上）", crits >= 5, `crits=${crits}`);
}
{
  const g = fresh();
  const victim = g.spawnEnemy(T("slime", { spd: 0 }), 30, 0, false);
  victim.hp = 5; victim.burn = 2;
  const bystander = g.spawnEnemy(T("slime", { spd: 0 }), 48, 4, false);
  bystander.hp = 100000; bystander.maxHp = 100000;
  g.addProjectile(0, 0, 0, 110, 1.7, 50, 0, undefined, "wand");
  step(g, 30);
  ok("誘爆：燃焼中の敵を弾で倒すと周囲に burst ダメージ", (g.dmgStats.burst || { dmg: 0 }).dmg > 0, `burst=${JSON.stringify(g.dmgStats.burst)}`);
}

console.log("=== 6. ラスボス（300秒） ===");
{
  const g = fresh();
  g.weapons = [{ id: "wand", lv: 8, t: 9999 }];
  g.time = TUNE.winTime - 0.01;
  step(g, 3);
  ok("300秒で即勝利せずラスボスが出現する", !!g.finalBoss && !g.over && !g.won);
  const expectHp = Math.min(200000, Math.max(1500, Math.round(W.totalDps(g.player.stats, g.weapons) * 30)));
  ok("ラスボスHPは総DPS×30（クランプ内）", g.finalBoss.e.maxHp === expectHp, `hp=${g.finalBoss.e.maxHp} expect=${expectHp}`);
  ok("ラスボスは精鋭髑髏の巨大版（r=30）", g.finalBoss.e.r === 30 && g.finalBoss.e.finalBoss === true);
  // アリーナクランプ
  const fb = g.finalBoss;
  g.player.x = fb.cx + 400; g.player.y = fb.cy;
  step(g, 1);
  const dArena = Math.hypot(g.player.x - fb.cx, g.player.y - fb.cy);
  ok("プレイヤーは円形アリーナ内にクランプされる", dArena <= fb.R - 8 + 0.01, `d=${dArena}`);
  // ビーム攻撃が予約される
  fb.beamT = 0.01;
  let beamQueued = false;
  for (let i = 0; i < 10 && !beamQueued; i++) { step(g, 1); beamQueued = g.delayed.some((d) => d.kind === "beam"); }
  ok("ラスボスはビーム攻撃を予約する（予告つき delayed）", beamQueued);
  // ラスボス中に死ねば敗北
  g.player.hp = 1;
  const boss = fb.e;
  boss.x = g.player.x; boss.y = g.player.y;
  step(g, 2, {});
  ok("ラスボス戦中に死ぬと敗北", g.over && !g.won, `over=${g.over} won=${g.won}`);
}

console.log("=== 7. 実績・図鑑 ===");
{
  const g = fresh();
  const bank0 = meta.getBank();
  const bonus = g.unlockAch("firstClear");
  ok("実績解放でボーナスが achPending に積まれる（即時入金しない）", bonus === 50 && g.achPending === 50 && meta.getBank() === bank0, `pending=${g.achPending}`);
  ok("実績が永続化される", meta.isAchUnlocked("firstClear"));
  ok("同じ実績は二重解放しない", g.unlockAch("firstClear") === 0 && g.achPending === 50);
  g.coins = 10;
  g.bankRun();
  ok("bankRun でコイン＋実績ボーナスが一度だけ入金", meta.getBank() === bank0 + 60, `bank=${meta.getBank()}`);
  const kills0 = meta.getAch().totalKills;
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 30, 0, false);
  e.hp = 1;
  g.damageEnemy(e, 5, { src: "wand" });
  ok("敵キル数が図鑑に加算される", meta.getAch().enemyKills.slime >= 1 && meta.getAch().totalKills === kills0 + 1, `slime=${meta.getAch().enemyKills.slime}`);
  ok("図鑑は12種ぶんの情報を持つ", meta.ENEMY_INFO.length === 12);
  ok("実績は14件定義されている", Object.keys(meta.ACHIEVEMENTS).length === 14);
}

console.log("=== 8. 天候のゲームプレイ効果 ===");
{
  const g = fresh();
  const ids = [0, 60, 120, 180, 240, 300].map((t) => { g.time = t; return g.weatherId(); });
  ok("天候は60秒周期で render と同じ順序", JSON.stringify(ids) === JSON.stringify(["storm", "rain", "snow", "cherry", "leaves", "godrays"]), ids.join(","));
  g.time = 60; // 雨
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 60, 0, false);
  e.hp = 100000; e.maxHp = 100000;
  const before = e.hp;
  g.damageEnemy(e, 100, { kind: "bolt", src: "thunder" });
  ok("雨：雷ダメージ +15%", approx(before - e.hp, 115, 0.01), `dmg=${before - e.hp}`);
  g.time = 120; // 雪
  g.damageEnemy(e, 1, { slow: 2, src: "nova" });
  ok("雪：減速の持続 +25%", approx(e.slow, 2.5, 0.01), `slow=${e.slow}`);
  g.time = 180; // 桜
  g.xpNeed = 1e9; // レベルアップで消費されないよう固定して増分だけを見る
  const xp0 = g.xp;
  g.gainXp(10);
  ok("桜：XPジェム価値 +20%", g.xp - xp0 === 12, `xp=${g.xp - xp0}`);
  g.time = 300; g.wonOnce = true; // 木漏れ日（ラスボス発動を抑止して検証）
  g.player.hp = g.player.maxHp - 10;
  g.player.stats.regen = 0;
  step(g, 60);
  ok("木漏れ日：自然回復 +0.5/秒", approx(g.player.maxHp - g.player.hp, 9.5, 0.3), `hp=${g.player.hp}/${g.player.maxHp}`);
}
{
  const g = fresh(); // 嵐（time 0）
  g.stormT = 0.01;
  step(g, 2);
  const strike = g.delayed.find((d) => d.storm);
  ok("嵐：落雷が予告つきで予約される", !!strike && g.zones.some((z) => z.kind === "telegraph"));
  if (strike) {
    const e = g.spawnEnemy(T("slime", { spd: 0 }), strike.x, strike.y, false);
    e.hp = 100000; e.maxHp = 100000;
    const before = e.hp;
    strike.t = 0;
    step(g, 2);
    ok("嵐：落雷が範囲内の敵にダメージ", e.hp < before, `dmg=${before - e.hp}`);
  }
}

console.log("=== 9. 破壊可能オブジェクト＋即時アイテム ===");
{
  const g = fresh();
  ok("ラン開始時に props が配置される", g.props.length > 0, `n=${g.props.length}`);
  const pr = { x: 30, y: 0, kind: "pot", hp: 3, flash: 0, seed: 1 };
  g.props.push(pr);
  g.damageArea(30, 0, 20, 5, { src: "nova" });
  ok("範囲攻撃で prop が壊れる", !g.props.includes(pr));
  const pr2 = { x: 200, y: 200, kind: "candle", hp: 3, flash: 0, seed: 2 };
  g.props.push(pr2);
  g.damageProp(pr2, 3);
  ok("damageProp で壊れてドロップ抽選が走る（pickups 増減あり）", !g.props.includes(pr2));
}
{
  const g = fresh();
  const e = g.spawnEnemy(T("slime", { spd: 30 }), 120, 0, false);
  g.useInstantItem("itemFreeze");
  ok("フリーズアイテムで敵に freeze が付く", (e.freeze || 0) > 2.9, `freeze=${e.freeze}`);
  const x0 = e.x;
  step(g, 60);
  ok("フリーズ中は敵が動かない（1秒経過時点）", Math.abs(e.x - x0) < 0.01, `dx=${e.x - x0}`);
  step(g, 150);
  ok("フリーズは3秒で解けて再び動く", e.x < x0 - 1, `x=${e.x}`);
}
{
  const g = fresh();
  g.spawnPickup(200, 0, "xp", 5);
  const it = g.pickups[g.pickups.length - 1];
  g.useInstantItem("itemVacuum");
  ok("ジェム吸引でフィールドのジェムに vacuum が付く", it.vacuum === true);
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 100, 0, false);
  e.hp = 100000; e.maxHp = 100000;
  g.enemyShots.push({ x: 0, y: 0, vx: 0, vy: 0, life: 5, dmg: 5, f: { stop() {} } });
  g.useInstantItem("itemBomb");
  ok("聖水ボムで敵弾が全消去される", g.enemyShots.length === 0);
  ok("聖水ボムが範囲内の敵に bomb ダメージ", (g.dmgStats.bomb || { dmg: 0 }).dmg > 0, `bomb=${JSON.stringify(g.dmgStats.bomb)}`);
}

console.log("=== 10. デイリーチャレンジ ===");
{
  const c1 = daily.getDailyConfig("2026-11-11");
  const c2 = daily.getDailyConfig("2026-11-11");
  ok("同じ日付では同じモディファイア（決定的）", JSON.stringify(c1.modifiers) === JSON.stringify(c2.modifiers), JSON.stringify(c1.modifiers));
  ok("モディファイアは2〜3個", c1.modifiers.length >= 2 && c1.modifiers.length <= 3, `n=${c1.modifiers.length}`);
  const s = daily.summarizeDaily(c1);
  ok("モディファイアには名前があり、summarizeDaily が倍率を返す", c1.modifiers.every((m) => typeof m.name === "string" && m.name.length > 0) && typeof s.xpMult === "number" && typeof s.dashCdMult === "number");
  daily.recordDailyBest("2026-11-11", { clear: false, time: 120, level: 5, kills: 40 });
  daily.recordDailyBest("2026-11-11", { clear: true, time: 300, level: 9, kills: 200 });
  let db = daily.getDailyBest("2026-11-11");
  ok("デイリーベストはクリアが優先される", db && db.clear === true && db.kills === 200);
  daily.recordDailyBest("2026-11-11", { clear: true, time: 100, level: 3, kills: 10 });
  db = daily.getDailyBest("2026-11-11");
  ok("デイリーベストは良い記録でしか更新されない", db.time === 300 && db.kills === 200, `time=${db.time}`);
  ok("デイリーベストは通常ベストと分離している", daily.getDailyBest("2026-11-12") === null);
}
{
  // デイリー中は永続ショップ強化が無効
  meta.addBank(1000);
  if (meta.getLevel("vitality") < 1) meta.buy("vitality");
  const lv = meta.getLevel("vitality");
  const gN = fresh();
  ok("通常ランではショップ強化が効く（前提確認）", lv === 0 || gN.player.maxHp >= TUNE.playerMaxHp + 20 * lv, `lv=${lv} hp=${gN.player.maxHp}`);
  const summary = { modifierIds: [], modifierNames: [], enemyTypes: null, weaponsOnly: null, startRelics: [], spdMult: 1, eliteMult: 1, xpMult: 1.3, dashCdMult: 0.5 };
  const g = createGame();
  g.reset({ date: "2026-11-11", summary });
  ok("デイリー中はショップボーナスOFF（最大HPが素の値）", g.player.maxHp === TUNE.playerMaxHp, `hp=${g.player.maxHp}`);
  ok("デイリーの倍率が反映される（XP×1.3／ダッシュCD半分）", g.xpMult === 1.3 && g.dashCdMult === 0.5);
  ok("デイリー中は呪いも無効", g.curse.length === 0);
  // 出現武器限定
  const g2 = createGame();
  g2.reset({ date: "2026-11-11", summary: { ...summary, weaponsOnly: ["flame"], xpMult: 1, dashCdMult: 1 } });
  g2.weapons = [{ id: "wand", lv: 1, t: 0 }];
  let bad = false;
  for (let i = 0; i < 16; i++) for (const c of W.makeChoices(g2)) if (c.kind === "new" && c.id !== "flame") bad = true;
  ok("デイリーの出現武器限定がカードに効く", !bad);
}

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
