// ヘッドレス操作確認（ヒットストップ・移動イージング・アナログ入力の簡易スモークテスト）。
// ブラウザを立ち上げずに `node tools/check_feel.mjs` で実行できる。game.js の仕様変更時に数字を睨む用。
import { createGame, setViewport } from "../js/game.js";
import { FX } from "../js/fx.js";

setViewport(320, 180);
const g = createGame();
const DT = 1 / 60;
const step = (input) => g.update(DT, input);

// --- 移動イージング：右入力を積み立てて速度を見る
console.log("=== accel ramp (target 58) ===");
for (let i = 0; i < 20; i++) {
  step({ right: true });
  if (i % 3 === 0 || i === 19) console.log(`step ${i + 1}: vx=${g.player.vx.toFixed(2)} x=${g.player.x.toFixed(2)}`);
}
console.log("=== decel ramp ===");
for (let i = 0; i < 12; i++) {
  step({});
  if (i % 2 === 0 || i === 11) console.log(`step ${i + 1}: vx=${g.player.vx.toFixed(2)}`);
}

// --- アナログ入力の強弱（スティック半押し）
g.reset();
for (let i = 0; i < 40; i++) step({ ax: 0.5 });
console.log("=== analog half push ===", "vx =", g.player.vx.toFixed(2), "(期待 ≈29)");

// --- ヒットストップ：敵を置いて武器を撃たせ、punch が立つか確認
g.reset();
g.spawnEnemy({ id: "slime", hp: 1000, spd: 0, r: 12, dmg: 6, xp: 1, at: 0, w: 1, mod: FX.slime }, 30, 0, false);
let stops = 0, maxStop = 0;
for (let i = 0; i < 60 * 6; i++) {
  g.update(DT, {});
  if (g.hitStop > 0) { stops++; maxStop = Math.max(maxStop, g.hitStop); g.hitStop = 0; g.stopCool = Math.max(0, g.stopCool - DT); }
}
console.log("=== hitstop ===", "発動フレーム数:", stops, "最大凍結:", maxStop.toFixed(3), "kills:", g.kills, "残HP:", g.enemies[0] ? g.enemies[0].hp.toFixed(0) : "dead");

// --- 被弾時 punch
g.reset();
g.spawnEnemy({ id: "slime", hp: 1000, spd: 0, r: 12, dmg: 6, xp: 1, at: 0, w: 1, mod: FX.slime }, 4, 0, false);
for (let i = 0; i < 30 && g.hitStop <= 0; i++) g.update(DT, {});
console.log("=== hurt punch ===", "hitStop:", g.hitStop.toFixed(3), "hp:", g.player.hp);

// --- main ループ相当の凍結（実時間だけ進め、凍結中は update を呼ばない）
g.reset();
g.spawnEnemy({ id: "slime", hp: 1000, spd: 0, r: 12, dmg: 6, xp: 1, at: 0, w: 1, mod: FX.slime }, 30, 0, false);
let simFrames = 0, realFrames = 0;
for (let i = 0; i < 600; i++) {
  realFrames++;
  if (g.hitStop > 0) { // frozen 継続：世界は完全に停止
    g.hitStop = Math.max(0, g.hitStop - DT);
    g.stopCool = Math.max(0, g.stopCool - DT);
    continue;
  }
  g.update(DT, {});
  simFrames++;
}
console.log("=== dilation ===", `実時間 ${realFrames} フレーム中、世界は ${simFrames} フレーム進行（=${((1 - simFrames / realFrames) * 100).toFixed(1)}% スロー）`);
