// OSS 連携（pixelfx 拡張 / ZzFX+ZzFXM BGM / noisejs）の直接トリガ検証。
// 実行: node tools/check_oss.mjs
// ブラウザ無しで回すため localStorage と AudioContext はスタブを使う（音は鳴らさず状態だけ検証）。
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const { FX } = await import("../js/fx.js");
const { createFrame, clearFrame, createFx } = await import("../vendor/pixelfx/core/index.js");
const { createGame } = await import("../js/game.js");
const { noise } = await import("../vendor/noisejs/noise.js");
const { buildGroundTile, mirrorTileCoord } = await import("../js/render.js");
const { music, SONG, SONG_SECONDS } = await import("../js/music.js");
const { zzfxM } = await import("../vendor/zzfxm/zzfxm.js");

// ---- 1. pixelfx レジストリ：全エントリが生成・描画でき、絵が出る -------------------
console.log("=== FX registry ===");
const keys = Object.keys(FX);
ok(keys.length === 67, `レジストリは 67 件（旧31 + 新35 + ラスボス用 arcaneBeam）: ${keys.length}`);
let allOk = true, blankOnes = [];
for (const k of keys) {
  try {
    const frame = createFrame(320, 180, 0, 0);
    const f = createFx(FX[k], { x: 160, y: 90, seed: 3 });
    let painted = 0;
    for (let i = 0; i < 30; i++) { // 遅れて出る演出（隕石・聖柱）も含め1秒分を蓄積して判定
      f.update(1 / 30);
      clearFrame(frame);
      f.draw(frame);
      for (let j = 0; j < frame.color.length; j++) if (frame.color[j] !== 0) painted++;
    }
    if (painted === 0) blankOnes.push(k);
  } catch (e) {
    allOk = false;
    console.log(`    throw at ${k}: ${e.message}`);
  }
}
ok(allOk, "全67エントリが例外なく生成・更新・描画できる");
ok(blankOnes.length === 0, `全エントリが非空白ピクセルを描く（空白: ${blankOnes.join(",") || "なし"}）`);

// ---- 2. ゲーム内配線の直接トリガ --------------------------------------------------
console.log("=== wiring triggers ===");
const T = (id, extra = {}) => ({ id, mod: FX[id === "fish" ? "fishSchool" : id === "skull" ? "flyingSkull" : id === "jelly" ? "jellyfish" : id], hp: 1000, spd: 30, r: 12, dmg: 6, xp: 3, at: 0, w: 1, ...extra });
function fresh() {
  const g = createGame();
  g.reset();
  g.spawnT = 1e9; g.swarmT = 1e9; g.bossT = 1e9; g.eventT = 1e9; // 自然湧きを止めて直接トリガだけを見る
  return g;
}
const stepG = (g, n = 6) => { for (let i = 0; i < n; i++) g.update(1 / 60, {}); };

{ // 連鎖：chain-lightning + spark-arc が出る
  const g = fresh();
  const e = g.spawnEnemy(T("slime"), g.player.x + 30, g.player.y, false);
  const before = g.fxTop.items.length;
  g.chainFrom(g.player.x, g.player.y, null, 5);
  ok(g.fxTop.items.length > before, "chainFrom で連鎖エフェクトがスポーンする");
  ok(e.hp < e.maxHp, "chainFrom で対象にダメージが入る");
}
{ // 氷結粉砕：減速中の敵への雷で ice-shatter 系が出て gate が立つ
  const g = fresh();
  const e = g.spawnEnemy(T("slime"), g.player.x + 20, g.player.y, false);
  e.slow = 2;
  const before = g.fxTop.items.length;
  g.damageEnemy(e, 1, { kind: "bolt" });
  ok(g.shatterCd > 0, "シナジー発動で shatterCd ゲートが立つ");
  ok(g.fxTop.items.length > before, "シナジー発動で粉砕エフェクトがスポーンする");
}
{ // 幽霊の死に様＝soul-rise、ボス撃破＝大爆発系、どちらも例外なし
  const g = fresh();
  const gh = g.spawnEnemy(T("ghost"), g.player.x + 20, g.player.y, false);
  g.damageEnemy(gh, 99999, {});
  ok(gh.hp <= 0, "幽霊を倒せる（soul-rise 配線）");
  const g2 = fresh();
  const boss = g2.spawnEnemy(T("skull", { hp: 500, spd: 24 }), g2.player.x + 60, g2.player.y, true, { boss: true });
  boss.maxHp = 500; boss.hp = 500;
  g2.damageEnemy(boss, 99999, {});
  ok(boss.hp <= 0, "ボスを倒せる（big-explosion 配線）");
  stepG(g2, 10);
  ok(true, "ボス撃破後も数フレーム回せる");
}
{ // 神殿：ルーンサークルが付き、達成で消えて祝福エフェクトが出る
  const g = fresh();
  g.triggerEvent("shrine");
  ok(!!g.shrine && !!g.shrineFx, "神殿生成で rune-circle が付く");
  g.shrine.progress = g.shrine.need;
  g.player.x = g.shrine.x; g.player.y = g.shrine.y;
  stepG(g, 3);
  ok(g.shrine === null && g.shrineFx === null, "神殿達成でサークルが消える");
}
{ // 勝利インプロージョン／宝箱／ダッシュ、いずれも例外なく回る
  const g = fresh();
  g.triggerEvent("chest");
  stepG(g, 30);
  g.dashCdT = 0;
  g.update(1 / 60, { dash: true, mx: 1, my: 0 });
  ok(g.dashT > 0, "ダッシュが発動する（ZzFX dash 音は無音環境でも安全）");
  g.triggerVictory();
  stepG(g, 5);
  ok(g.won === true, "勝利処理が回る（implosion 配線）");
}

// ---- 3. BGM：スタブ AudioContext で状態遷移を検証 --------------------------------
console.log("=== BGM (ZzFXM) ===");
ok(SONG_SECONDS >= 55 && SONG_SECONDS <= 75, `曲の長さが約60秒台: ${SONG_SECONDS.toFixed(1)}s`);
{
  const [l] = zzfxM(...SONG);
  ok(l.length > 44100 * 55, "zzfxM が曲データを実サンプルへ変換できる");
}
class FakeParam { constructor() { this.value = 0; } }
class FakeCtx {
  constructor() { this.state = "running"; this.destination = {}; this.currentTime = 0; }
  createGain() { return { gain: new FakeParam(), connect() {} }; }
  createBuffer(ch, n, rate) {
    const data = [new Float32Array(n), new Float32Array(n)];
    return { duration: n / rate, getChannelData: (i) => data[i] };
  }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() { this.started = true; }, stop() {} }; }
  resume() { this.state = "running"; }
}
ok(music.enabled === true, "BGM はデフォルト ON");
music.attach(new FakeCtx());
music.start();
const st = music.state();
ok(st.playing === true, `再生開始で playing=true（render ${st.renderMs.toFixed(0)}ms）`);
ok(st.renderedSeconds >= 55 && st.renderedSeconds <= 75, `レンダリング済み尺 ${st.renderedSeconds.toFixed(1)}s`);
music.stop();
ok(music.state().playing === false, "stop で playing=false");
music.start();
ok(music.toggle() === false && music.state().playing === false, "トグル OFF で停止する");
ok(store.get("pixelSurvivor.bgm.v1") === "0", "OFF が localStorage に保存される");
ok(music.toggle() === true && store.get("pixelSurvivor.bgm.v1") === "1", "トグル ON が保存される");

// ---- 4. noisejs：決定性と地面タイル ----------------------------------------------
console.log("=== noisejs ===");
{
  noise.seed(42);
  const a = [noise.perlin2(0.5, 0.5), noise.perlin2(1.3, -2.7), noise.perlin2(10, 4)];
  noise.seed(42);
  const b = [noise.perlin2(0.5, 0.5), noise.perlin2(1.3, -2.7), noise.perlin2(10, 4)];
  noise.seed(7);
  const c = [noise.perlin2(0.5, 0.5), noise.perlin2(1.3, -2.7), noise.perlin2(10, 4)];
  ok(a.every((v, i) => v === b[i]), "同じシードでは同じノイズ列になる");
  ok(a.some((v, i) => v !== c[i]), "違うシードでは違うノイズ列になる");
}
{
  const tile = buildGroundTile(123);
  ok(tile.length === 256 * 256, "地面タイルは 256x256");
  const distinct = new Set(tile).size;
  ok(distinct >= 4, `タイルに ${distinct} 色の濃淡がある（平色ではない）`);
  const tile2 = buildGroundTile(124);
  let diff = 0;
  for (let i = 0; i < tile.length; i += 97) if (tile[i] !== tile2[i]) diff++;
  ok(diff > 100, "シードが変わればタイル模様も変わる");
  ok(mirrorTileCoord(0) === 0 && mirrorTileCoord(255) === 255 && mirrorTileCoord(256) === 255
    && mirrorTileCoord(511) === 0 && mirrorTileCoord(512) === 0 && mirrorTileCoord(-1) === 0,
    "ミラータイル座標が境界で折り返す（継ぎ目なし）");
}

console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
