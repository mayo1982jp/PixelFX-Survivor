// 新機能（敵行動・ボス・ダッシュ・イベント/レリック・進化・シナジー・エンドレス/呪い/ベスト）の
// ヘッドレス直接トリガーテスト。`node tools/check_new_features.mjs` で実行。
// localStorage スタブを import 前に差し込む（呪い・ベストの永続化も検証するため）
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
  g.weapons = []; // 武器の自動発射を止めて行動だけを見る
  g.spawnT = 1e9; g.swarmT = 1e9; g.bossT = 1e9; g.eventT = 1e9;
  g.player.stats.crit = 0;
  return g;
}
const step = (g, n, input = {}) => { for (let i = 0; i < n; i++) g.update(DT, input); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

console.log("=== 1. 敵の行動パターン ===");
{
  const g = fresh();
  const slime = g.spawnEnemy(T("slime", { spd: 24 }), 120, 0, false); slime.bt = 0;
  step(g, 30);
  ok("slime は直進（y がほぼ 0）", Math.abs(slime.y) < 0.5, `y=${slime.y}`);
  ok("slime は接近する", slime.x < 120 && slime.x > 100, `x=${slime.x}`);
}
{
  const g = fresh();
  const frog = g.spawnEnemy(T("frog", { spd: 42 }), 120, 0, false); frog.bt = 0;
  const x0 = frog.x;
  step(g, 40); // 0.67秒 = しゃがみ中
  const crouchMove = Math.abs(frog.x - x0);
  step(g, 30); // 跳躍込みで合計1.17秒
  const totalMove = Math.abs(frog.x - x0);
  ok("frog はしゃがみ中ほぼ動かない", crouchMove < 1.5, `move=${crouchMove.toFixed(2)}`);
  ok("frog は跳躍で大きく進む", totalMove > 12, `move=${totalMove.toFixed(2)}`);
}
{
  const g = fresh();
  const ghost = g.spawnEnemy(T("ghost", { spd: 44 }), 120, 0, false); ghost.bt = 0; ghost.phase = 0;
  step(g, 45);
  ok("ghost は横にうねる（|y|>2）", Math.abs(ghost.y) > 2, `y=${ghost.y.toFixed(2)}`);
}
{
  const g = fresh();
  const bf = g.spawnEnemy(T("butterfly", { spd: 72 }), 30, 0, false);
  const d0 = dist(bf, g.player);
  step(g, 30);
  ok("butterfly は近づくと逃げる（距離増）", dist(bf, g.player) > d0 + 3, `d ${d0} -> ${dist(bf, g.player).toFixed(1)}`);
}
{
  const g = fresh();
  const eye = g.spawnEnemy(T("eyeball", { spd: 32 }), 85, 0, false); eye.bt = 0;
  let charged = false, chargeDisp = 0, prev = null;
  for (let i = 0; i < 60 * 5; i++) {
    g.update(DT, {});
    if (eye.bstate === 2) {
      if (prev) chargeDisp = Math.max(chargeDisp, Math.hypot(eye.x - prev.x, eye.y - prev.y));
      charged = true;
    }
    prev = { x: eye.x, y: eye.y };
    if (charged && eye.bstate === 0) break;
  }
  ok("eyeball は予告→チャージに入る", charged);
  ok("eyeball チャージは通常移動より速い（>1.4px/frame）", chargeDisp > 1.4, `disp=${chargeDisp.toFixed(2)}`);
}
{
  const g = fresh();
  const jelly = g.spawnEnemy(T("jelly", { spd: 22 }), 60, 0, false);
  g.killEnemy(jelly);
  ok("jelly は倒すと鈍足ゾーンを残す", g.zones.some((z) => z.kind === "slow"));
}

console.log("=== 2. ボス（召喚・フェーズ2・放射弾・HPバー用参照） ===");
{
  const g = fresh();
  const boss = g.spawnEnemy(T("skull", { hp: 500, spd: 24 }), 150, 0, true, { boss: true });
  boss.maxHp = 500; boss.hp = 500;
  ok("getBoss() がボスを返す", g.getBoss() === boss);
  const before = g.enemies.length;
  boss.summonT = 0.01;
  step(g, 10);
  ok("ボスは子分を召喚する", g.enemies.length > before, `${before} -> ${g.enemies.length}`);
  boss.hp = 200; // 40% → フェーズ2
  boss.burstT = 0.01;
  let sawShots = false;
  for (let i = 0; i < 90; i++) { g.update(DT, {}); if (g.enemyShots.length > 0) { sawShots = true; break; } }
  ok("ボスは HP50% 以下でフェーズ2", boss.bossPhase === 2, `phase=${boss.bossPhase}`);
  ok("フェーズ2で放射状の敵弾を撃つ", sawShots);
}

console.log("=== 3. ダッシュ ===");
{
  const g1 = fresh(); step(g1, 11, { right: true });
  const g2 = fresh(); g2.update(DT, { right: true, dash: true }); step(g2, 10, { right: true });
  ok("ダッシュは通常移動より速く進む", g2.player.x > g1.player.x * 1.8, `dash=${g2.player.x.toFixed(1)} normal=${g1.player.x.toFixed(1)}`);
  ok("ダッシュ後にクールダウンが付く", g2.dashCdT > 0);
  const cdBefore = g2.dashT;
  g2.update(DT, { right: true, dash: true });
  ok("クールダウン中は再ダッシュできない", g2.dashT <= cdBefore || g2.dashT <= 0, `dashT=${g2.dashT}`);
}
{
  const g = fresh();
  g.spawnEnemy(T("slime", { spd: 0 }), 6, 0, false);
  const hp0 = g.player.hp;
  g.update(DT, { right: true, dash: true });
  step(g, 5, { right: true });
  ok("ダッシュ中は接触ダメージを受けない", g.player.hp === hp0, `hp=${g.player.hp}`);
}
{
  const g = fresh(); // 無入力ダッシュは最後に向いた方向（初期は左）
  g.update(DT, { dash: true }); step(g, 8, {});
  ok("無入力ダッシュは向き方向（左）へ進む", g.player.x < -5, `x=${g.player.x.toFixed(1)}`);
}

console.log("=== 4. イベント・宝箱・レリック ===");
{
  const g = fresh();
  let banner = "";
  g.onBanner = (t) => { banner = t; };
  g.triggerEvent("shrine");
  ok("神殿イベントで shrine が出現しバナーが出る", !!g.shrine && banner.includes("神殿"));
  g.shrine.x = g.player.x; g.shrine.y = g.player.y;
  step(g, 120);
  ok("サークル内では進行する", g.shrine && g.shrine.progress > 1.5, `prog=${g.shrine && g.shrine.progress}`);
  const prog = g.shrine.progress;
  g.player.x += 200; step(g, 60);
  ok("離れると進行が止まる（リセットされない）", g.shrine && Math.abs(g.shrine.progress - prog) < 0.01);
  g.player.x -= 200; g.shrine.progress = 9.9;
  step(g, 120); // 達成→報酬ジェム/コインが磁石で回収されるまで進める
  ok("10秒で神殿達成し報酬（XP/コイン）が得られる", !g.shrine && (g.coins >= 16 || g.xp > 0 || g.level > 1), `coins=${g.coins} xp=${g.xp} lv=${g.level}`);
}
{
  const g = fresh();
  g.triggerEvent("curse");
  ok("呪いの群れは coinBonus=3 の敵を出す", g.curseSwarmT > 0 && g.enemies.some((e) => e.coinBonus === 3));
}
{
  const g = fresh();
  g.triggerEvent("chest");
  const marked = g.enemies.find((e) => e.chestElite);
  ok("宝箱イベントで marked 精鋭が出る", !!marked);
  g.killEnemy(marked);
  ok("marked 精鋭を倒すと宝箱が落ちる", g.pickups.some((p) => p.kind === "chest"));
  let opened = false;
  g.onChest = () => { opened = true; };
  const chest = g.pickups.find((p) => p.kind === "chest");
  chest.x = g.player.x; chest.y = g.player.y - 10;
  step(g, 3);
  ok("宝箱を拾うと onChest が発火する", opened);
  const choices = W.makeRelicChoices(g);
  ok("レリック3択が作れる（6種以上から）", choices.length === 3 && choices.every((c) => c.kind === "relic"));
  W.applyRelicChoice(g, { kind: "relic", id: "glass" });
  ok("レリック「ガラスの大砲」: ダメージ倍率+25%・最大HP-20", g.relics.includes("glass") && g.player.maxHp === 80, `maxHp=${g.player.maxHp}`);
  const choices2 = W.makeRelicChoices(g);
  ok("取得済みレリックは再度出ない", !choices2.some((c) => c.id === "glass"));
}
{
  const g = fresh(); // 荊棘：被弾時に周囲へ反射
  W.applyRelicChoice(g, { kind: "relic", id: "thorns" });
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 4, 0, false);
  step(g, 10);
  ok("荊棘：被弾すると敵が反射ダメージを受ける", e.hp < 1000, `enemyHp=${e.hp}`);
}
{
  const g = fresh(); // 残響：10キルで落雷 delayed
  W.applyRelicChoice(g, { kind: "relic", id: "echo" });
  g.spawnEnemy(T("slime", { spd: 0 }), 100, 0, false); // 落雷ターゲット
  for (let k = 0; k < 10; k++) { const v = g.spawnEnemy(T("slime", { spd: 0 }), 150, 50, false); g.killEnemy(v); }
  ok("残響：10キルで落雷（delayed）が予約される", g.delayed.some((d) => d.kind === "bolt"));
}
{
  const g = fresh(); // 爆裂ジェム
  W.applyRelicChoice(g, { kind: "relic", id: "gemBomb" });
  const e = g.spawnEnemy(T("slime", { spd: 0, hp: 500 }), 14, 0, false);
  g.spawnPickup(g.player.x, g.player.y - 10, "xp", 1);
  step(g, 3);
  ok("爆裂ジェム：XP取得で周囲の敵がダメージ", e.hp < 500, `hp=${e.hp}`);
}

console.log("=== 5. 武器進化・シナジー ===");
{
  const g = fresh();
  g.weapons = [{ id: "wand", lv: 8, t: 0.5 }];
  g.passives = { haste: 2 };
  const choices = W.makeChoices(g);
  const evo = choices.find((c) => c.kind === "evolve");
  ok("wand Lv8＋素早さLv2 で進化カードが必ず出る", !!evo && evo.evoId === "wandEvo");
  W.applyChoice(g, evo);
  ok("進化適用で武器が wandEvo になる", g.weapons[0].id === "wandEvo");
  ok("進化後も DPS が計算できる", W.totalDps(g.player.stats, g.weapons) > 0);
  const e = g.spawnEnemy(T("slime", { spd: 0 }), 60, 0, false);
  const pb = g.projectiles.length;
  W.WEAPONS.wandEvo.fire(g, 8);
  ok("進化ワンドが発射できる", g.projectiles.length > pb);
  ok("対象の敵は生きている（前提）", e.hp > 0);
}
{
  const g = fresh(); // 進化ヒント（3択抽選なので複数回引いて確認）
  g.weapons = [{ id: "wand", lv: 7, t: 0.5 }];
  g.passives = { haste: 1 };
  let card = null;
  for (let i = 0; i < 40 && !card; i++) card = W.makeChoices(g).find((c) => c.kind === "weapon" && c.id === "wand");
  ok("Lv7 の武器カードに進化条件ヒントが出る", !!card && card.hint.includes("進化条件"), `hint=${card && card.hint}`);
}
{
  const g = fresh(); // シナジー氷結粉砕：減速中の敵への雷は +50%
  const a = g.spawnEnemy(T("slime", { spd: 0 }), 200, 0, false);
  const b = g.spawnEnemy(T("slime", { spd: 0 }), 240, 0, false);
  a.slow = 5;
  g.damageEnemy(a, 10, { kind: "bolt" });
  g.damageEnemy(b, 10, { kind: "bolt" });
  ok("氷結粉砕：減速中の敵は雷ダメージ 1.5倍", (1000 - a.hp) === 15 && (1000 - b.hp) === 10, `a=${1000 - a.hp} b=${1000 - b.hp}`);
}
{
  const g = fresh(); // チェインサンダー：delayed boltChain が連鎖
  const a = g.spawnEnemy(T("slime", { spd: 0, hp: 100000 }), -20, 0, false);
  const b = g.spawnEnemy(T("slime", { spd: 0, hp: 100000 }), 12, 0, false);
  g.delayed.push({ t: 0.05, x: a.x, y: a.y, r: 24, dmg: 20, kind: "boltChain" });
  step(g, 12);
  ok("チェイン：着弾後に近くの敵へ連鎖ダメージ", a.hp < 100000 && b.hp < 100000, `a=${a.hp} b=${b.hp}`);
}
{
  const g = fresh(); // ブリザードノヴァの2段目
  W.WEAPONS.novaEvo.fire(g, 8);
  ok("ブリザードノヴァは余波（delayed nova2）を予約する", g.delayed.some((d) => d.kind === "nova2"));
}
{
  const g = fresh(); // ヘルフレイムの燃え移り
  g.weapons = [{ id: "flameEvo", lv: 8, t: 99 }];
  const a = g.spawnEnemy(T("slime", { spd: 0, hp: 10 }), 10, 0, false);
  const b = g.spawnEnemy(T("slime", { spd: 0 }), 30, 0, false);
  a.burn = 3;
  g.killEnemy(a);
  ok("ヘルフレイム：燃焼中に倒すと近くの敵へ燃え移る", b.burn > 0, `burn=${b.burn}`);
}

console.log("=== 6. エンドレス・呪い・ベスト ===");
{
  meta.toggleCurse("curseHp"); meta.toggleCurse("curseSpd"); meta.toggleCurse("curseElite");
  meta.toggleCurse("curseHp"); meta.toggleCurse("curseSpd"); meta.toggleCurse("curseElite"); // 全OFFへ戻す
  const g = fresh();
  const e0 = g.spawnEnemy(T("slime", { spd: 0 }), 100, 0, false);
  const hpBase = e0.hp;
  meta.toggleCurse("curseHp");
  g.reset(); g.weapons = []; g.spawnT = 1e9; g.swarmT = 1e9; g.bossT = 1e9; g.eventT = 1e9;
  const e1 = g.spawnEnemy(T("slime", { spd: 0 }), 100, 0, false);
  ok("呪い（敵HP+50%）で敵HPが1.5倍", Math.abs(e1.hp / hpBase - 1.5) < 0.01, `${hpBase} -> ${e1.hp}`);
  ok("呪い1つでコイン倍率は ×1.5 を含む", g.coinMult >= 1.5 - 1e-9, `coinMult=${g.coinMult}`);
  meta.toggleCurse("curseHp"); // OFFに戻す
}
{
  const g = fresh();
  g.coins = 37;
  const bank0 = meta.getBank();
  g.time = TUNE.winTime - 0.01;
  step(g, 5);
  ok("300秒到達で勝利状態（wonOnce / over / 未入金）", g.wonOnce && g.over && g.won && !g.banked);
  ok("勝利時点ではまだ貯金されない", meta.getBank() === bank0);
  g.continueEndless();
  ok("エンドレス継続でゲームが再開する", g.endless && !g.over);
  step(g, 120);
  ok("エンドレスでは300秒を超えても終わらない", !g.over && g.time > TUNE.winTime);
  g.finish(false);
  ok("エンドレス終了時にコインが一度だけ入金される", g.banked && meta.getBank() === bank0 + 37);
  g.bankRun();
  ok("bankRun の二重入金はない", meta.getBank() === bank0 + 37);
  ok("ベスト記録が保存される（生存時間）", meta.getBest().time >= Math.floor(g.time) && !!g.lastBest, `best=${JSON.stringify(meta.getBest())}`);
}
{
  const g = fresh();
  g.time = 120; g.level = 7; g.kills = 55;
  g.finish(false);
  const b1 = meta.getBest();
  const g2 = fresh();
  g2.time = 30; g2.level = 2; g2.kills = 3;
  g2.finish(false);
  ok("ベストは悪い記録で上書きされない", meta.getBest().kills === Math.max(b1.kills, 55) && meta.getBest().level >= 7);
}

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
