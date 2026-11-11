// ゲームコア：プレイヤー・敵・弾・拾い物・スポーン演出と衝突判定。
// pixelfx の critter を敵の見た目、projectile / impact / spell を武器演出として使う。
import { createFx } from "../vendor/pixelfx/core/index.js";
import { FX, PAL, FxLayer } from "./fx.js";
import { sfx } from "./sfx.js";
import { WEAPONS, RELICS, hasRelic, totalDps } from "./weapons.js";
import { getLevel, addBank, getCurses, curseCoinMult, recordBest, ACHIEVEMENTS, unlockAch as metaUnlockAch, addEnemyKill, getAch, flushAch } from "./meta.js";
import { STYLES, loadStyleId } from "./witch.js";

// 天候の巡回（render.js の見た目と同じ順序・60秒周期をゲームプレイ側でも使う）
export const WEATHER_ORDER = ["storm", "rain", "snow", "cherry", "leaves", "godrays"];
export const WEATHER_NAMES = { storm: "嵐", rain: "雨", snow: "雪", cherry: "桜", leaves: "落葉", godrays: "木漏れ日" };

export let VW = 320, VH = 180; // 論理解像度（画面アスペクトに合わせて動的に再計算）
let SPAWN_R = 224;             // 湧きリング半径（画面の対角半分＋余裕。setViewport で更新）

// ---- レベルデザイン調整パラメーター（デバッグパネルからリアルタイム変更可） ----
// デフォルト値はこれまでのハードコードと同一。変更は localStorage に保存されリロード後も保持される。
export const DEFAULT_TUNE = Object.freeze({
  winTime: 300,
  maxEnemies: 170,
  spawnBase: 1.35, spawnDecay: 0.0032, spawnMin: 0.22,
  swarmFirst: 20, swarmInterval: 42, swarmBase: 10, swarmDiv: 22,
  bossFirst: 50, bossInterval: 60,
  eliteTime: 55, eliteRate: 0.06,
  hpDiv: 120, hpK: 0.9, dmgDiv: 250,
  eliteHpMult: 5, eliteDmgMult: 1.4, eliteSpdMult: 0.9,
  spdVar: 0.15,
  enemyHpMult: 1, enemySpdMult: 1, enemyDmgMult: 1, enemyXpMult: 1,
  playerSpeed: 58, playerMaxHp: 100, playerCrit: 0.05, playerMagnet: 26,
  playerIframes: 0.7, accel: 10, decel: 14,
  dmgMultExtra: 1, cdMultExtra: 1,
  xpBase: 9, xpLinear: 5, xpQuad: 1.2,
  heartHeal: 15, heartRate: 0.025, heartRateElite: 0.5,
  coinMultExtra: 1,
  hitStopScale: 1, shakeScale: 1,
  dashCd: 2.5, dashTime: 0.18, dashSpeed: 3.2,
  eventFirst: 65, eventInterval: 68,
  ambientFx: 1,
});
export const TUNE = { ...DEFAULT_TUNE };

const TUNE_KEY = "pixelSurvivor.tune.v1";
function loadTune() {
  try {
    const raw = JSON.parse(localStorage.getItem(TUNE_KEY));
    if (raw && typeof raw === "object") {
      for (const k of Object.keys(DEFAULT_TUNE)) {
        const v = Number(raw[k]);
        if (Number.isFinite(v)) TUNE[k] = v;
      }
    }
  } catch { /* 保存が無い・破損時はデフォルト */ }
}
export function saveTune() {
  try { localStorage.setItem(TUNE_KEY, JSON.stringify(TUNE)); } catch { /* 保存不可でも続行 */ }
}
export function resetTune() {
  Object.assign(TUNE, DEFAULT_TUNE);
  saveTune();
}
loadTune();

/** チェンジ適用：maxHp・magnet・crit・dmg/cd・xpNeed など「現在のステータスに即反映すべき値」を同期。 */
export function applyTuneSideEffects(g, key, prev, next) {
  if (!g || !g.player) return;
  const p = g.player;
  const st = p.stats;
  if (key === "playerMaxHp") {
    const d = next - prev;
    if (d !== 0) {
      p.maxHp = Math.max(1, p.maxHp + d);
      p.hp = d > 0 ? p.hp + d : Math.min(p.hp, p.maxHp);
    }
  } else if (key === "playerMagnet" && prev > 0) {
    st.magnet *= next / prev;
  } else if (key === "playerCrit") {
    st.crit = Math.max(0, Math.min(1, st.crit + (next - prev)));
  } else if (key === "dmgMultExtra" && prev > 0) {
    st.dmgMult *= next / prev;
  } else if (key === "cdMultExtra" && prev > 0) {
    st.cdMult *= next / prev;
  } else if (key === "xpBase" || key === "xpLinear" || key === "xpQuad") {
    g.xpNeed = g.level <= 1
      ? Math.floor(TUNE.xpBase)
      : Math.floor(TUNE.xpBase + TUNE.xpLinear * g.level + TUNE.xpQuad * g.level * g.level);
  }
}

/** 画面サイズに合わせた論理解像度を設定。短辺を約180px基準に保ちつつアスペクトに追従し、黒帯なく全面表示する。 */
export function setViewport(w, h) {
  VW = Math.max(160, Math.min(640, Math.round(w)));
  VH = Math.max(160, Math.min(640, Math.round(h)));
  SPAWN_R = Math.hypot(VW, VH) / 2 + 24; // 画面の角の外側に湧くように
}

// 敵の種類。mod は pixelfx の critter エフェクト（ループする生き物アニメ）
// at はすべて 240秒（4分）以内 = 4分で全種が出現する仕様。skull は末尾固定（ボス湧きが TYPES[last] を参照）。
const TYPES = [
  { id: "slime", mod: FX.slime, hp: 10, spd: 24, r: 12, dmg: 6, xp: 1, at: 0, w: 10 },
  { id: "frog", mod: FX.frog, hp: 12, spd: 42, r: 11, dmg: 6, xp: 2, at: 24, w: 8 },
  { id: "ghost", mod: FX.ghost, hp: 7, spd: 44, r: 10, dmg: 5, xp: 2, at: 36, w: 6 },
  { id: "snake", mod: FX.snake, hp: 9, spd: 58, r: 13, dmg: 8, xp: 3, at: 64, w: 5 },
  { id: "bat", mod: FX.bat, hp: 10, spd: 56, r: 14, dmg: 7, xp: 3, at: 80, w: 5, fly: 1 },
  { id: "bird", mod: FX.bird, hp: 12, spd: 66, r: 12, dmg: 7, xp: 4, at: 104, w: 4, fly: 1 },
  { id: "eyeball", mod: FX.eyeball, hp: 18, spd: 32, r: 12, dmg: 8, xp: 4, at: 128, w: 4 },
  { id: "fish", mod: FX.fishSchool, hp: 20, spd: 30, r: 15, dmg: 9, xp: 5, at: 152, w: 3 },
  { id: "jelly", mod: FX.jellyfish, hp: 26, spd: 22, r: 14, dmg: 10, xp: 6, at: 172, w: 3, fly: 1 },
  { id: "wisp", mod: FX.wisp, hp: 24, spd: 48, r: 17, dmg: 9, xp: 6, at: 192, w: 3, fly: 1 },
  { id: "butterfly", mod: FX.butterfly, hp: 16, spd: 72, r: 15, dmg: 11, xp: 8, at: 216, w: 2, fly: 1 },
  { id: "skull", mod: FX.flyingSkull, hp: 90, spd: 24, r: 19, dmg: 12, xp: 25, at: 240, w: 1, fly: 1 },
];

export function createGame() {
  const g = {
    time: 0, kills: 0, over: false, won: false,
    level: 1, xp: 0, xpNeed: 9, pendingLevels: 0,
    coins: 0, coinMult: 1,
    hitStop: 0, stopCool: 0, // ヒットストップ（凍結残り時間／次の弱凍結までの間引き時間）
    player: null, enemies: [], projectiles: [], pickups: [], delayed: [],
    weapons: [], passives: {}, burnDps: 0,
    fxWorld: new FxLayer(36), fxTop: new FxLayer(64), fxText: new FxLayer(16),
    cam: { x: 0, y: 0 }, shake: 0,
    seed: 1, spawnT: 0, swarmT: TUNE.swarmFirst, bossT: TUNE.bossFirst,
    onLevelUp: null, onEnd: null, onHurt: null,
    // 新機能の状態
    dashT: 0, dashCdT: 0, dashDirX: -1, dashDirY: 0,
    shatterCd: 0, shrineFx: null,
    relics: [], zones: [], enemyShots: [], shrine: null,
    eventT: TUNE.eventFirst, curseSwarmT: 0, vacuumT: 20,
    bossRef: null, endless: false, wonOnce: false, banked: false,
    curse: [], runHpMult: 1, runSpdMult: 1, runEliteRateMult: 1,
    relicKills: 0, lastBest: null,
    onBanner: null, onChest: null,
    // Gemini改善10件の状態
    finalBoss: null, arenaFx: null, pendingFinalBossDown: false, finalBossDone: false,
    props: [], propCells: new Set(), propT: 0,
    dmgStats: {}, rerolls: 2, banishes: 2, banished: [],
    justCdT: 0, justBuffT: 0, justCount: 0, dashUsed: false, onJustDodge: null,
    stormT: 8, achPending: 0, runButterflies: 0, ach400: false,
    daily: null, weaponsOnly: null, xpMult: 1, dashCdMult: 1, dailyTypes: null,
    styleId: "violet", burnMult: 1, burnSrc: "flame",
  };

  g.rseed = () => (g.seed = (g.seed * 16807 + 11) % 2147483647) % 65521;
  g.addShake = (a) => { a *= TUNE.shakeScale; g.shake = Math.min(8, Math.max(g.shake, a)); };
  g.passiveCount = () => Object.keys(g.passives).length;

  /** 現在の天候（g.time の60秒周期。render の見た目と単一の真実を共有する） */
  g.weatherId = () => WEATHER_ORDER[Math.floor(Math.max(0, g.time) / 60) % WEATHER_ORDER.length];
  g.weatherName = () => WEATHER_NAMES[g.weatherId()];

  /** ダメージ源別の集計（リザルト内訳用）。kills は killEnemy 側で lastSrc を使って数える */
  g.trackDamage = (src, dmg, killed) => {
    const key = src || "other";
    let rec = g.dmgStats[key];
    if (!rec) { rec = { dmg: 0, kills: 0 }; g.dmgStats[key] = rec; }
    if (dmg > 0) rec.dmg += dmg;
    if (killed) rec.kills += 1;
  };

  /** 実績解放：ボーナスは achPending に積み、bankRun で一度だけ入金する */
  g.unlockAch = (id) => {
    const bonus = metaUnlockAch(id);
    if (bonus > 0) {
      g.achPending = (g.achPending || 0) + bonus;
      const a = ACHIEVEMENTS[id];
      if (a && g.onBanner) g.onBanner(`実績解放「${a.name}」 +${bonus}C`);
      if (g.player) g.fxTop.spawn(FX.achievement, g.player.x, g.player.y - 34, { seed: g.rseed(), title: a ? a.name : id, text: a ? a.name : id });
    }
    return bonus;
  };

  /** ジャスト回避：ダッシュ無敵中に本来当たる攻撃をすり抜けたときに呼ぶ（内部CD 1秒） */
  g.tryJustDodge = () => {
    if (g.justCdT > 0 || g.dashT <= 0) return false;
    const p = g.player;
    g.justCdT = 1.0;
    g.justBuffT = 3.0;
    g.justCount += 1;
    g.dashCdT *= 0.5; // 残りクールダウンを半分に
    for (let i = 0; i < 3; i++)
      g.spawnPickup(p.x + (Math.random() - 0.5) * 12, p.y + (Math.random() - 0.5) * 10, "xp", 1);
    g.fxTop.spawn(FX.manaBurst, p.x, p.y - 8, { seed: g.rseed() });
    g.fxText.spawn(FX.critNumber, p.x, p.y - 26, { text: "JUST!", seed: g.rseed() });
    sfx.just();
    if (g.onJustDodge) g.onJustDodge();
    return true;
  };

  /** ヒットストップ要求。main が g.update を sec 秒分止める間、世界を完全に凍らせる。
   *  多段ヒットで連続凍結しコマ落ちしないようクールダウンで間引く（force はクリティカル・死亡・被弾など強い一撃） */
  g.punch = (sec = 0.05, opt = {}) => {
    const { cool = 0.22, force = false } = opt;
    if (g.stopCool > 0 && !force) return;
    g.hitStop = Math.max(g.hitStop, sec * TUNE.hitStopScale);
    g.stopCool = Math.max(g.stopCool, cool);
  };

  // ---- 初期化 ---------------------------------------------------------------
  g.reset = function reset(daily = null) {
    g.time = 0; g.kills = 0; g.over = false; g.won = false;
    g.level = 1; g.xp = 0; g.xpNeed = Math.floor(TUNE.xpBase); g.pendingLevels = 0;
    g.hitStop = 0; g.stopCool = 0;
    // デイリー（g.daily）の時は永続ショップ強化も呪いも無効（公平のため）。L() で丸める
    g.daily = daily || null;
    const ds = daily ? daily.summary || null : null;
    const L = (id) => (g.daily ? 0 : getLevel(id));
    // 呪い（タイトルで選択）をラン限定倍率へ反映。TUNE 本体は書き換えない
    g.curse = g.daily ? [] : getCurses();
    g.runHpMult = g.curse.includes("curseHp") ? 1.5 : 1;
    g.runSpdMult = g.curse.includes("curseSpd") ? 1.2 : 1;
    g.runEliteRateMult = (g.curse.includes("curseElite") ? 2 : 1) * (ds && ds.eliteMult ? ds.eliteMult : 1);
    g.dashT = 0; g.dashCdT = 0; g.dashDirX = -1; g.dashDirY = 0;
    g.shatterCd = 0; g.shrineFx = null;
    g.relics = []; g.zones = []; g.enemyShots = []; g.shrine = null;
    g.eventT = TUNE.eventFirst; g.curseSwarmT = 0; g.vacuumT = 20;
    g.bossRef = null; g.endless = false; g.wonOnce = false; g.banked = false;
    g.relicKills = 0; g.lastBest = null;
    // Gemini改善10件のラン初期化
    g.dmgStats = {}; g.rerolls = 2; g.banishes = 2; g.banished = [];
    g.justCdT = 0; g.justBuffT = 0; g.justCount = 0; g.dashUsed = false;
    g.stormT = 8; g.achPending = 0; g.runButterflies = 0; g.ach400 = false;
    g.xpMult = ds && ds.xpMult ? ds.xpMult : 1;
    g.dashCdMult = ds && ds.dashCdMult ? ds.dashCdMult : 1;
    g.weaponsOnly = ds && ds.weaponsOnly ? ds.weaponsOnly : null;
    g.dailyTypes = ds && ds.enemyTypes ? ds.enemyTypes : null;
    if (g.arenaFx) { g.arenaFx.stop(); g.arenaFx = null; }
    g.finalBoss = null; g.pendingFinalBossDown = false; g.finalBossDone = false;
    g.props = []; g.propCells = new Set(); g.propT = 0;
    // スタイル（衣装）＝初期武器と特性
    const style = STYLES.find((s) => s.id === loadStyleId()) || STYLES[0];
    g.styleId = style.id;
    const tr = style.trait || {}; // witch.js の特性スキーマ（burnMult/spdMult は絶対倍率、critAdd/regenAdd/hpAdd は加算）
    g.burnMult = tr.burnMult || 1;
    // 永続強化（ショップ購入レベル）を初期ステータスへ反映
    const maxHp = TUNE.playerMaxHp + 20 * L("vitality") + (tr.hpAdd || 0);
    g.coins = 0; g.coinMult = (1 + 0.2 * L("greed")) * (g.daily ? 1 : curseCoinMult());
    g.player = {
      x: 0, y: 0, vx: 0, vy: 0, hp: maxHp, maxHp, iframes: 0, flip: false, moving: false, bob: 0,
      dirX: -1, dirY: 0,
      stats: {
        dmgMult: (1 + 0.06 * L("might")) * TUNE.dmgMultExtra,
        cdMult: TUNE.cdMultExtra,
        spdMult: (1 + 0.04 * L("swift")) * (tr.spdMult || 1) * (ds && ds.spdMult ? ds.spdMult : 1),
        magnet: TUNE.playerMagnet * (1 + 0.15 * L("magnet")),
        crit: TUNE.playerCrit + (tr.critAdd || 0),
        regen: 0.3 * L("regen") + (tr.regenAdd || 0),
      },
    };
    g.enemies.length = 0; g.projectiles.length = 0; g.pickups.length = 0; g.delayed.length = 0;
    g.weapons = [{ id: style.startWeapon || "wand", lv: 1, t: 0.5 }];
    g.passives = {}; g.burnDps = 0; g.burnSrc = "flame";
    if (style.startPassive) g.passives[style.startPassive] = 1; // verdant: 緑の守り石
    if (ds && Array.isArray(ds.startRelics)) { // デイリーの初期レリック
      for (const rid of ds.startRelics) {
        if (RELICS[rid] && !g.relics.includes(rid)) { g.relics.push(rid); RELICS[rid].apply(g); }
      }
    }
    g.fxWorld.clear(); g.fxTop.clear(); g.fxText.clear();
    g.cam.x = -VW / 2; g.cam.y = -VH / 2;
    g.shake = 0; g.spawnT = 0.8; g.swarmT = TUNE.swarmFirst; g.bossT = TUNE.bossFirst; g.seed = Date.now() % 65521 || 7;
    g.updateProps(); // 破壊可能オブジェクトの初期配置
  };

  // ---- クエリ系（武器側から使う primitives） ----------------------------------
  g.nearestEnemy = (x, y, maxR) => {
    let best = null, bd = maxR * maxR;
    for (const e of g.enemies) { const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; best = e; } }
    return best;
  };
  g.randomEnemy = (maxR) => {
    const p = g.player, pool = g.enemies.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) <= maxR);
    return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  };
  /** 敵が最も密集している点（各敵の周囲 60px にいる敵数を数えて最大を選ぶ） */
  g.busiestPoint = (range) => {
    let best = null, bn = 1;
    for (const e of g.enemies) {
      let n = 0;
      for (const o of g.enemies) if (Math.hypot(o.x - e.x, o.y - e.y) < 60) n++;
      if (n > bn && Math.hypot(e.x - g.player.x, e.y - g.player.y) <= range) { bn = n; best = e; }
    }
    return best;
  };
  g.forEachEnemy = (fn) => { for (const e of g.enemies) fn(e); };

  g.addProjectile = (x, y, angle, speed, life, dmg, pierce, mod, src) => {
    if (g.projectiles.length > 26) return;
    const f = createFx(mod || FX.plasmaShot, { x, y, angle, size: 5 + Math.min(4, dmg / 6) });
    g.projectiles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, dmg, pierce, hit: new Set(), f, src: src || "other" });
  };

  // ---- ダメージ ---------------------------------------------------------------
  g.showDamage = (x, y, dmg, crit) => {
    if (g.fxText.items.length >= g.fxText.cap - 2 && !crit) return; // 数字が多いときは通常ヒットを間引く
    const mod = crit ? FX.critNumber : FX.damageNumber;
    const text = crit ? `${Math.round(dmg)}!` : `-${Math.round(dmg)}`;
    g.fxText.spawn(mod, x + (Math.random() - 0.5) * 8, y - 14, { text, seed: g.rseed() });
  };

  /** 範囲ダメージ。slow / knock / kind（シナジー判定用）/ src / electrify を任意で付ける。破壊可能オブジェクトも対象 */
  g.damageArea = (x, y, r, dmg, opt = {}) => {
    let hitAny = false;
    for (const e of [...g.enemies]) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= r + e.r * 0.5) {
        const ang = Math.atan2(e.y - y, e.x - x);
        g.damageEnemy(e, dmg, { knock: (opt.knock ?? 34) * (1 - d / (r + e.r)), pushX: Math.cos(ang), pushY: Math.sin(ang), slow: opt.slow, kind: opt.kind, src: opt.src, electrify: opt.electrify });
        hitAny = true;
      }
    }
    for (const pr of [...g.props]) {
      if (Math.hypot(pr.x - x, pr.y - y) <= r + 5) { g.damageProp(pr, dmg); hitAny = true; }
    }
    if (hitAny && opt.sfx) opt.sfx();
    return hitAny;
  };

  /** チェインサンダー用：(x,y) の近くで exclude 以外の最も近い敵へ連鎖ダメージ */
  g.chainFrom = (x, y, exclude, dmg, radius = 46, src = "thunderEvo") => {
    let best = null, bd = radius * radius;
    for (const e of g.enemies) {
      if (e === exclude || e.hp <= 0) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      // 連鎖の見た目：起点から対象方向へ chain-lightning、着弾点に spark-arc
      g.fxTop.spawn(FX.chainLightning, x, y - 12, { seed: g.rseed(), flip: best.x < x });
      g.fxTop.spawn(FX.sparkArc, best.x, best.y - 10, { seed: g.rseed() });
      g.damageEnemy(best, dmg, { kind: "bolt", src });
    }
    return best;
  };

  g.damageEnemy = (e, raw, opt = {}) => {
    if (e.hp <= 0) return;
    const src = opt.src || "other";
    // シナジー「融解」：燃焼中の敵に氷（nova 系）が当たると残り燃焼を一括精算して爆発し、燃焼を消費する
    const isIce = opt.kind === "ice" || opt.kind === "nova2";
    if (isIce && e.burn > 0 && g.burnDps > 0) {
      const burstRaw = e.burn * g.burnDps * (g.burnMult || 1);
      e.burn = 0; e.burnAcc = 0;
      if (e.flame) { e.flame.stop(); e.flame = null; }
      g.fxTop.spawn(FX.fireball, e.x, e.y - 14, { seed: g.rseed(), palette: PAL.fire });
      g.damageArea(e.x, e.y, 26, burstRaw, { kind: "melt", src: "melt" });
      if (e.hp <= 0) { e.lastSrc = "melt"; g.killEnemy(e); return; }
    }
    // シナジー「感電審判」：スマイト着弾で感電デバフ（その敵へのクリ率 +15%）
    if (opt.electrify) e.elect = Math.max(e.elect || 0, opt.electrify);
    const crit = Math.random() < g.player.stats.crit + ((e.elect || 0) > 0 ? 0.15 : 0);
    // シナジー「氷結粉砕」：減速中の敵は雷（kind: bolt）から +50% ダメージ
    const synergy = (e.slow > 0 && opt.kind === "bolt") ? 1.5 : 1;
    if (synergy > 1 && (g.shatterCd || 0) <= 0) { // 粉砕の見た目（連発時は 0.25 秒に1回まで）
      g.shatterCd = 0.25;
      g.fxTop.spawn(FX.iceShatter, e.x, e.y - 8, { seed: g.rseed() });
      if (Math.random() < 0.35) g.fxTop.spawn(FX.iceSpikes, e.x, e.y, { seed: g.rseed() });
    }
    // 天候「雨」：雷ダメージ +15%（氷結粉砕とは別係数で乗算）
    const rainBolt = (opt.kind === "bolt" && g.weatherId() === "rain") ? 1.15 : 1;
    const dmg = raw * g.player.stats.dmgMult * (crit ? 2.5 : 1) * synergy * rainBolt;
    e.hp -= dmg;
    e.lastSrc = src;
    g.trackDamage(src, dmg, false);
    e.flash = 0.12;
    // ヒットストップ：通常命中は短く強めに、クリティカルは最優先で長めに。
    // 通常はクールダウン 0.4 秒で間引く（撃ち合いの終盤で常時スローにならないため）
    g.punch(crit ? 0.06 : 0.05, crit ? { force: true, cool: 0.3 } : { cool: 0.4 });
    // 天候「雪」：減速の持続 +25%
    if (opt.slow) e.slow = Math.max(e.slow || 0, opt.slow * (g.weatherId() === "snow" ? 1.25 : 1));
    if (opt.pushX !== undefined) { e.kx = (e.kx || 0) + opt.pushX * opt.knock; e.ky = (e.ky || 0) + opt.pushY * opt.knock; }
    g.showDamage(e.x, e.y - (e.fly ? 24 : 14), dmg, crit);
    if (!crit && Math.random() < 0.4) g.fxTop.spawn(FX.hitSpark, e.x + (opt.pushX || 0) * -6, e.y - 12, { aim: Math.atan2(opt.pushY || 0, opt.pushX || -1), seed: g.rseed(), height: 10 });
    if (e.hp <= 0) g.killEnemy(e);
    else sfx.hit();
  };

  g.killEnemy = (e) => {
    const i = g.enemies.indexOf(e);
    if (i >= 0) g.enemies.splice(i, 1);
    g.kills++;
    e.dead = true;
    if (e.boss) g.bossRef = null;
    // ダメージ内訳のキル帰属＋図鑑キル数＋関連実績
    g.trackDamage(e.lastSrc || "other", 0, true);
    addEnemyKill(e.type.id);
    if (e.type.id === "butterfly") { g.runButterflies++; if (g.runButterflies >= 15) g.unlockAch("butterfly15"); }
    if (g.kills === 100) g.unlockAch("kills100run");
    if (g.kills === 500) g.unlockAch("kills500run");
    if (getAch().totalKills >= 1000) g.unlockAch("kills1000");
    if (e.finalBoss) g.pendingFinalBossDown = true;
    // ヘルフレイム：燃焼中に倒れた敵は近くの敵へ燃え移る
    if (e.burn > 0 && g.weapons.some((w) => w.id === "flameEvo")) {
      const near = g.nearestEnemy(e.x, e.y, 52);
      if (near && near !== e) near.burn = Math.max(near.burn || 0, 2.5);
    }
    // クラゲは倒れると鈍足の泡ゾーンを残す
    if (e.type.id === "jelly") g.zones.push({ x: e.x, y: e.y, r: 22, t: 4, kind: "slow" });
    // 宝箱イベントの精鋭は宝箱を落とす（落下地点に光柱を立てて見つけやすくする）
    if (e.chestElite) {
      g.spawnPickup(e.x, e.y, "chest", 0);
      g.fxTop.spawn(FX.lootBeam, e.x, e.y - 10, { seed: g.rseed(), palette: PAL.xpGold });
    }
    // レリック：残響の鈴（10キル落雷）／吸血の牙（50キル回復）
    if (g.relics.length) {
      g.relicKills++;
      if (hasRelic(g, "echo") && g.relicKills % 10 === 0) {
        const t = g.randomEnemy(160);
        if (t) {
          g.fxTop.spawn(FX.lightningStrike, t.x, t.y, { seed: g.rseed() });
          g.delayed.push({ t: 0.76, x: t.x, y: t.y, r: 22, dmg: 22, kind: "bolt", src: "echo" });
        }
      }
      if (hasRelic(g, "vampire") && g.relicKills % 50 === 0) {
        g.player.hp = Math.min(g.player.maxHp, g.player.hp + 5);
      }
    }
    if (e.boss) { // ボス撃破は最大級の爆発＋粉砕
      g.fxTop.spawn(FX.bigExplosion, e.x, e.y - 14, { seed: g.rseed(), light: 0.9 });
      g.fxTop.spawn(FX.shatterDeath, e.x, e.y - 10, { seed: g.rseed() });
      g.addShake(5); g.punch(0.08, { force: true, cool: 0.25 }); sfx.elite();
    } else if (e.elite || e.type.id === "skull") {
      g.fxTop.spawn(FX.plasmaExplosion, e.x, e.y - 14, { seed: g.rseed(), light: 0.8 });
      if (e.type.id === "skull") g.fxTop.spawn(FX.shatterDeath, e.x, e.y - 10, { seed: g.rseed() });
      g.addShake(3); g.punch(0.08, { force: true, cool: 0.25 }); sfx.elite();
    } else if (e.type.id === "ghost") { // 幽霊は魂が昇る
      g.fxTop.spawn(FX.soulRise, e.x, e.y - 6, { seed: g.rseed(), light: 0.6 });
      sfx.kill();
    } else {
      g.fxTop.spawn(FX.poof, e.x, e.y, { seed: g.rseed(), light: 0.5 });
      sfx.kill();
    }
    // キルマイルストーン演出（100キルごとコンボ表示、500キルで達成バッジ）
    if (g.kills % 500 === 0) g.fxTop.spawn(FX.achievement, g.player.x, g.player.y - 34, { seed: g.rseed(), title: `${g.kills} KILLS`, text: `${g.kills} KILLS` });
    else if (g.kills % 100 === 0) g.fxTop.spawn(FX.comboCounter, g.player.x, g.player.y - 30, { seed: g.rseed(), count: g.kills, label: "KILLS" });
    // XPジェム（gem-spin を再配色で使っている）
    const n = e.elite ? 4 : 1;
    for (let k = 0; k < n; k++) {
      const v = Math.max(1, Math.round(e.type.xp * (e.elite ? 5 : 1) * TUNE.enemyXpMult / n));
      g.spawnPickup(e.x + (Math.random() - 0.5) * 14, e.y + (Math.random() - 0.5) * 8, "xp", v);
    }
    // コイン（永続ショップ用の通貨。強欲・呪い倍率と、呪いの群れ中は追加で ×3）
    const cv = Math.max(1, Math.round(e.type.xp * 0.6)) * (e.elite ? 6 : 1) * (e.coinBonus || 1);
    g.spawnPickup(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 6, "coin", Math.round(cv * g.coinMult * TUNE.coinMultExtra));
    if (e.type.id !== "skull" && Math.random() < (e.elite ? TUNE.heartRateElite : TUNE.heartRate)) g.spawnPickup(e.x, e.y, "heart", TUNE.heartHeal);
    // ラスボス撃破は killEnemy の全処理（ドロップ等）が終わってから勝利フローへ
    if (g.pendingFinalBossDown) { g.pendingFinalBossDown = false; g.onFinalBossDown(); }
  };

  // ---- 拾い物 -----------------------------------------------------------------
  g.spawnPickup = (x, y, kind, value) => {
    const mod = kind === "xp" ? FX.gemSpin : kind === "heart" ? FX.heartPickup : FX.coinSpin;
    const opts = { seed: g.rseed() };
    if (kind === "xp") opts.palette = value >= 6 ? PAL.xpGold : PAL.xpBlue;
    if (kind === "chest" || kind.startsWith("item")) { opts.palette = PAL.xpGold; opts.light = 1.6; }
    const f = createFx(mod, { x, y, ...opts });
    g.pickups.push({ x, y, kind, value, f, vx: 0, vy: 0 });
  };

  // ---- 敵の生成 ----------------------------------------------------------------
  // opt: { boss, chest, coinBonus } — boss=ボス髑髏, chest=宝箱イベント精鋭（金色）
  function spawnEnemy(type, x, y, elite, opt = {}) {
    const scale = 1 + g.time / TUNE.hpDiv * TUNE.hpK;
    const opts = { seed: g.rseed() };
    if (opt.chest) { opts.palette = PAL.xpGold; opts.light = 1.6; opts.seed = g.rseed(); }
    else if (opt.pal) { opts.palette = opt.pal; opts.light = 1.5; opts.seed = g.rseed(); }
    else if (elite) { opts.palette = PAL.elite; opts.light = 1.5; opts.seed = g.rseed(); }
    const f = createFx(type.mod, { x, y, ...opts });
    const hp = type.hp * scale * (elite ? TUNE.eliteHpMult : 1) * TUNE.enemyHpMult * g.runHpMult;
    const e = {
      type, x, y,
      hp, maxHp: hp,
      spd: type.spd * (1 - TUNE.spdVar + Math.random() * TUNE.spdVar * 2) * (elite ? TUNE.eliteSpdMult : 1) * TUNE.enemySpdMult * g.runSpdMult,
      r: type.r, dmg: type.dmg * (1 + g.time / TUNE.dmgDiv) * (elite ? TUNE.eliteDmgMult : 1) * TUNE.enemyDmgMult,
      fly: type.fly, elite: !!elite,
      f, flash: 0, slow: 0, burn: 0, burnAcc: 0, kx: 0, ky: 0, flame: null,
      // 行動パターン用ステート
      bt: Math.random() * 2, bstate: 0, btx: 0, bty: 0, phase: Math.random() * Math.PI * 2,
      boss: !!opt.boss, chestElite: !!opt.chest, coinBonus: opt.coinBonus || 0,
      summonT: 6, burstT: 5, telegraph: false,
    };
    if (g.curseSwarmT > 0 && !e.coinBonus) e.coinBonus = 3;
    g.enemies.push(e);
    if (e.boss) g.bossRef = e;
    // ボスと宝箱の精鋭はポータルから現れる（通常湧きは従来どおり即出現でバランス不変）
    if (opt.boss) g.fxWorld.spawn(FX.portal, x, y - 10, { seed: g.rseed(), palette: PAL.elite });
    else if (opt.chest) g.fxWorld.spawn(FX.spawnPortal, x, y - 10, { seed: g.rseed(), palette: PAL.xpGold });
    return e;
  }
  g.spawnEnemy = spawnEnemy;
  g.getBoss = () => (g.bossRef && g.bossRef.hp > 0 && g.enemies.includes(g.bossRef)) ? g.bossRef : null;

  function pickType() {
    let pool = TYPES.filter((t) => g.time >= t.at);
    if (g.dailyTypes && g.dailyTypes.length) { // デイリー: 敵種別を絞る（時間条件で空なら時間条件を無視）
      const lim = pool.filter((t) => g.dailyTypes.includes(t.id));
      if (lim.length) pool = lim;
      else { const all = TYPES.filter((t) => g.dailyTypes.includes(t.id) && t.id !== "skull"); if (all.length) pool = all; }
    }
    let sum = 0; for (const t of pool) sum += t.w;
    let r = Math.random() * sum;
    for (const t of pool) { r -= t.w; if (r <= 0) return t; }
    return pool[0];
  }
  g.pickType = pickType;
  // 指定角度方向の「画面の少し外側」座標。長方形ビューの辺に沿うのでアスペクト非依存で必ず画面外に出る。
  const ringAt = (a) => {
    const cx = Math.cos(a), sy = Math.sin(a);
    const hw = VW / 2, hh = VH / 2;
    const tx = hw / Math.max(1e-3, Math.abs(cx));
    const ty = hh / Math.max(1e-3, Math.abs(sy));
    const t = Math.min(tx, ty) * 1.12 + 18;
    return [g.player.x + cx * t, g.player.y + sy * t];
  };
  const ringPoint = () => ringAt(Math.random() * Math.PI * 2);

  /** ランイベントを1つ発生させる（テストから直接呼べるよう公開） */
  g.triggerEvent = function triggerEvent(kind) {
    const ev = kind || ["chest", "shrine", "curse"][(Math.random() * 3) | 0];
    const p = g.player;
    if (ev === "chest") {
      const pool = TYPES.filter((t) => g.time >= t.at && t.id !== "skull");
      const t = pool.length ? pool[(Math.random() * pool.length) | 0] : TYPES[0];
      const [x, y] = ringPoint();
      spawnEnemy(t, x, y, true, { chest: true });
      if (g.onBanner) g.onBanner("宝箱の精鋭が現れた！ 倒すと宝箱ドロップ");
    } else if (ev === "shrine") {
      if (!g.shrine) {
        const a = Math.random() * Math.PI * 2;
        g.shrine = { x: p.x + Math.cos(a) * 72, y: p.y + Math.sin(a) * 72, r: 28, progress: 0, need: 10, done: false };
        // 神殿の足元にルーンサークルを回し続ける（達成時に stop する）
        g.shrineFx = g.fxWorld.spawn(FX.runeCircle, g.shrine.x, g.shrine.y, { seed: g.rseed(), palette: PAL.xpGold });
      }
      if (g.onBanner) g.onBanner("XP神殿出現！ サークル内にとどまれ（10秒）");
    } else {
      g.curseSwarmT = 10;
      const a = Math.random() * Math.PI * 2;
      for (let i = 0; i < 10 && g.enemies.length < TUNE.maxEnemies; i++) {
        const aa = a + (Math.random() - 0.5) * 0.8;
        const [sx, sy] = ringAt(aa);
        const e = spawnEnemy(pickType(), sx, sy, false, { coinBonus: 3 });
        if (e) e.spd *= 1.3;
      }
      if (g.onBanner) g.onBanner("呪いの群れ！ 速いがコイン3倍");
    }
    return ev;
  };

  // ---- 本体アップデート ----------------------------------------------------------
  g.update = function update(dt, input) {
    if (!g.over) { if (g.finalBoss) g.time = TUNE.winTime; else g.time += dt; } // ラスボス戦中はタイマー停止（05:00表示）
    if (g.stopCool > 0) g.stopCool -= dt;
    if (g.shatterCd > 0) g.shatterCd -= dt;
    g.justCdT = Math.max(0, g.justCdT - dt);
    g.justBuffT = Math.max(0, g.justBuffT - dt);
    const p = g.player;
    if (g.endless && !g.ach400 && g.time >= 400) { g.ach400 = true; g.unlockAch("endless400"); }
    // 破壊可能オブジェクトの定期再配置
    g.propT -= dt;
    if (g.propT <= 0) { g.propT = 0.5; g.updateProps(); }
    for (const pr of g.props) if (pr.flash > 0) pr.flash -= dt;
    // 天候「嵐」：約10秒ごとにフィールドへ予告付き落雷（敵にダメージ、予告内に立つプレイヤーにも小ダメージ）
    if (g.weatherId() === "storm" && !g.over) {
      g.stormT -= dt;
      if (g.stormT <= 0) {
        g.stormT = 10;
        const sx = p.x + (Math.random() - 0.5) * 260, sy = p.y + (Math.random() - 0.5) * 180;
        g.delayed.push({ t: 0.9, x: sx, y: sy, r: 30, dmg: 26, kind: "stormBolt", storm: true });
        g.zones.push({ x: sx, y: sy, r: 30, t: 0.9, kind: "telegraph" });
      }
    }

    // --- プレイヤー移動（加速・減速に Ease をかける）
    let mx = input.ax || 0, my = input.ay || 0; // コントローラーのアナログ入力は強弱をそのまま使う
    if (!mx && !my) {                            // 無ければキーボード / 仮想スティックの 8 方向
      if (input.left) mx -= 1; if (input.right) mx += 1;
      if (input.up) my -= 1; if (input.down) my += 1;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }       // 斜め入力の速度だけを整える（弱い傾きは弱い速度）
    if (mx) p.flip = mx > 0; // 魔女は原画が左向き（杖が左）なので flip の意味を HERO と逆にする
    if (mag > 0.02) { p.dirX = mx / (mag || 1); p.dirY = my / (mag || 1); if (mag > 1) { p.dirX = mx; p.dirY = my; } }
    // クラゲの泡など鈍足ゾーン内では移動速度が下がる
    const inSlowZone = g.zones.some((z) => z.kind === "slow" && Math.hypot(p.x - z.x, p.y - z.y) < z.r);
    const spd = TUNE.playerSpeed * p.stats.spdMult * (inSlowZone ? 0.55 : 1) * (g.weatherId() === "leaves" ? 1.1 : 1); // 天候「落葉」: 速度+10%
    // --- ダッシュ（Space / Bボタン / ダッシュボタン。クールダウン中は不可、発動中は無敵）
    if (g.dashCdT > 0) g.dashCdT -= dt;
    if (input.dash && g.dashCdT <= 0 && g.dashT <= 0) {
      g.dashT = TUNE.dashTime;
      g.dashUsed = true;
      g.dashCdT = TUNE.dashCd * (g.dashCdMult || 1);
      g.dashDirX = p.dirX; // 入力中はその方向、無入力時は最後に向いた方向
      g.dashDirY = p.dirY;
      g.fxTop.spawn(FX.manaBurst, p.x, p.y - 10, { seed: g.rseed() });
      sfx.dash();
      if (hasRelic(g, "fireTrail")) g.zones.push({ x: p.x, y: p.y, r: 16, t: 1.2, kind: "burn", dps: 9 });
    }
    if (g.dashT > 0) {
      g.dashT -= dt;
      const dv = spd * TUNE.dashSpeed;
      p.vx = g.dashDirX * dv; p.vy = g.dashDirY * dv;
      p.iframes = Math.max(p.iframes, g.dashT); // ダッシュ中は無敵（被弾後の無敵とは別管理で上書きしない）
    } else {
      // 指数補間なのでフレーム時間に依存せず、同じ立ち上がり・減速になる
      const ease = 1 - Math.exp(-(mag > 0.02 ? TUNE.accel : TUNE.decel) * dt);
      p.vx += (mx * spd - p.vx) * ease;
      p.vy += (my * spd - p.vy) * ease;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // ラスボス戦：円形アリーナ内にプレイヤーをクランプ
    if (g.finalBoss) {
      const fb = g.finalBoss, adx = p.x - fb.cx, ady = p.y - fb.cy, ad = Math.hypot(adx, ady) || 1;
      if (ad > fb.R - 8) { p.x = fb.cx + (adx / ad) * (fb.R - 8); p.y = fb.cy + (ady / ad) * (fb.R - 8); }
    }
    const vel = Math.hypot(p.vx, p.vy);
    p.moving = vel > 6;                          // 実際に動いているか（歩行 bob・見た目の判定）
    if (p.moving) p.bob += dt * 9 * Math.min(1, vel / spd); // 遅い移動はゆっくり歩く
    p.iframes = Math.max(0, p.iframes - dt);
    { // 自然回復（天候「木漏れ日」: +0.5/秒を上乗せ）
      const regenTot = (p.stats.regen || 0) + (g.weatherId() === "godrays" ? 0.5 : 0);
      if (regenTot > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regenTot * dt);
    }

    // --- カメラ追従（シェイクの減衰は updateVisuals 側）
    g.cam.x += (p.x - VW / 2 - g.cam.x) * Math.min(1, dt * 8);
    g.cam.y += (p.y - VH / 2 - 14 - g.cam.y) * Math.min(1, dt * 8);

    // --- 湧き
    g.spawnT -= dt;
    const interval = Math.max(TUNE.spawnMin, TUNE.spawnBase - g.time * TUNE.spawnDecay) * (g.curseSwarmT > 0 ? 0.55 : 1);
    if (g.spawnT <= 0 && g.enemies.length < TUNE.maxEnemies && !g.finalBoss) {
      g.spawnT = interval;
      const t = pickType();
      const [x, y] = ringPoint();
      spawnEnemy(t, x, y, g.time > TUNE.eliteTime && Math.random() < TUNE.eliteRate * g.runEliteRateMult);
    }
    if (g.curseSwarmT > 0) g.curseSwarmT -= dt;

    // --- ランイベント（約60〜75秒間隔で3種からランダム）
    g.eventT -= dt;
    if (g.eventT <= 0) {
      g.eventT = Math.max(30, TUNE.eventInterval + (Math.random() * 14 - 7)); // 既定68±7 ≒ 61〜75秒
      if (!g.finalBoss) g.triggerEvent();
    }
    // XP神殿：サークル内にとどまると進行、離れると一時停止（リセットはしない）
    if (g.shrine && !g.shrine.done) {
      const sh = g.shrine;
      if (Math.hypot(p.x - sh.x, p.y - sh.y) < sh.r) {
        sh.progress += dt;
        if (sh.progress >= sh.need) {
          sh.done = true;
          for (let k = 0; k < 5; k++) g.spawnPickup(sh.x + (Math.random() - 0.5) * 24, sh.y + (Math.random() - 0.5) * 16, "xp", 7);
          for (let k = 0; k < 3; k++) g.spawnPickup(sh.x + (Math.random() - 0.5) * 24, sh.y + (Math.random() - 0.5) * 16, "coin", 8);
          g.fxTop.spawn(FX.confetti, sh.x, sh.y - 10, { seed: g.rseed() });
          g.fxTop.spawn(FX.healAoe, sh.x, sh.y - 6, { seed: g.rseed() }); // 達成の祝福
          g.fxTop.spawn(FX.collectBurst, sh.x, sh.y - 10, { seed: g.rseed() });
          if (g.shrineFx) { g.shrineFx.stop(); g.shrineFx = null; }
          if (g.onBanner) g.onBanner("神殿達成！ 報酬を獲得");
          g.shrine = null;
        }
      }
    }
    // ゾーン（鈍足の泡／炎の軌跡）の寿命と燃焼ゾーンのダメージ
    for (let i = g.zones.length - 1; i >= 0; i--) {
      const z = g.zones[i];
      z.t -= dt;
      if (z.t <= 0) { g.zones.splice(i, 1); continue; }
      if (z.kind === "burn") {
        z.acc = (z.acc || 0) + dt;
        if (z.acc >= 0.5) {
          z.acc -= 0.5;
          for (const e of [...g.enemies]) if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r * 0.5) e.burn = Math.max(e.burn || 0, 0.6);
          g.burnDps = Math.max(g.burnDps, z.dps || 9);
        }
      }
    }
    // レリック「磁心」：20秒ごとに全ピックアップを吸い寄せる
    if (hasRelic(g, "magnetCore")) {
      g.vacuumT -= dt;
      if (g.vacuumT <= 0) {
        g.vacuumT = 20;
        for (const it of g.pickups) it.vacuum = true;
        g.fxTop.spawn(FX.collectBurst, p.x, p.y - 10, { seed: g.rseed() }); // 吸引の合図
      }
    }
    g.swarmT -= dt;
    if (g.swarmT <= 0 && !g.finalBoss) { // 群れラッシュ：同じ方向からまとめて湧く
      g.swarmT = TUNE.swarmInterval;
      const a = Math.random() * Math.PI * 2;
      const n = TUNE.swarmBase + Math.floor(g.time / TUNE.swarmDiv);
      for (let i = 0; i < n && g.enemies.length < TUNE.maxEnemies; i++) {
        const aa = a + (Math.random() - 0.5) * 0.8;
        const [sx, sy] = ringAt(aa);
        spawnEnemy(pickType(), sx, sy, false);
      }
      g.addShake(2);
    }
    g.bossT -= dt;
    if (g.bossT <= 0 && !g.finalBoss) { // ボス髑髏（精鋭）
      g.bossT = TUNE.bossInterval;
      if (g.time > TUNE.bossFirst) {
        const [x, y] = ringPoint();
        spawnEnemy(TYPES[TYPES.length - 1], x, y, true, { boss: true });
        g.addShake(3);
        if (g.onBanner) g.onBanner("⚠ BOSS 出現 ⚠");
      }
    }

    // --- 敵（種別ごとの行動パターン）
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const slow = e.slow > 0 ? 0.5 : 1;
      if (e.slow > 0) e.slow -= dt;
      if (e.elect > 0) e.elect -= dt; // 感電デバフの残り時間
      const frozen = (e.freeze || 0) > 0; // 即時アイテム「時止め」
      if (frozen) e.freeze -= dt;
      e.bt = (e.bt || 0) + dt;
      let mvx = dx / d, mvy = dy / d, mult = 1;
      const perpX = -dy / d, perpY = dx / d;
      const weave = (amt, freq) => { const s = Math.sin(e.bt * freq + (e.phase || 0)) * amt; mvx += perpX * s; mvy += perpY * s; const l = Math.hypot(mvx, mvy) || 1; mvx /= l; mvy /= l; };
      // 予告チャージ系の共通処理（eyeball / ボス第2形態）
      const chargeStep = (range, teleTime, chargeMult, coolTime) => {
        if (e.bstate === 1) { // 予告
          e.telegraph = true; mult = 0;
          if (e.bt >= teleTime) { e.bstate = 2; e.bt = 0; }
        } else if (e.bstate === 2) { // 突進
          e.telegraph = false; mvx = e.btx; mvy = e.bty; mult = chargeMult;
          if (e.bt >= 0.45) { e.bstate = 0; e.bt = 0; }
        } else if (d < range && e.bt > coolTime) {
          e.bstate = 1; e.bt = 0; e.btx = dx / d; e.bty = dy / d;
        }
      };
      switch (e.type.id) {
        case "frog": { // 0.75秒しゃがんで 0.35秒跳ぶ
          const c = e.bt % 1.1;
          if (c < 0.75) { mult = 0; if (c > 0.7) { e.btx = dx / d; e.bty = dy / d; } }
          else { mvx = e.btx || mvx; mvy = e.bty || mvy; mult = 3.1; }
          break;
        }
        case "ghost": weave(0.75, 3.0); break;
        case "snake": weave(0.85, 6.0); if (e.bt % 3 < 0.5) mult = 2.1; break;
        case "bat": weave(0.6, 4.2); break;
        case "bird": weave(0.35, 3.0); mult = (e.bt % 2 < 0.7) ? 1.7 : 0.55; break;
        case "eyeball": chargeStep(95, 0.6, 3.6, 1.2); if (e.bstate === 0) mult = 0.8; break;
        case "fish": { // 群れの流れ：全体で同じ方向へうねる
          const s = Math.sin(g.time * 1.6 + (e.phase || 0) * 0.3) * 0.55;
          const ca = Math.cos(s), sa = Math.sin(s);
          const nx = mvx * ca - mvy * sa, ny = mvx * sa + mvy * ca; mvx = nx; mvy = ny;
          break;
        }
        case "wisp": { // 渦を巻きながら接近
          const ca = Math.cos(0.55), sa = Math.sin(0.55);
          const nx = mvx * ca - mvy * sa, ny = mvx * sa + mvy * ca; mvx = nx; mvy = ny;
          break;
        }
        case "butterfly": if (d < 58) { mvx = -mvx; mvy = -mvy; mult = 1.05; } else mult = 0.55; break;
        case "jelly": mult = 1; break;
        case "skull": {
          if (e.boss) {
            const phase2 = e.hp <= e.maxHp * 0.5;
            e.bossPhase = phase2 ? 2 : 1;
            if (phase2 && !e.phase2Fx) { // フェーズ移行の瞬間だけ時止め＋ポータル演出
              e.phase2Fx = true;
              g.fxTop.spawn(FX.timeStop, e.x, e.y - 12, { seed: g.rseed() });
              g.fxWorld.spawn(FX.portal, e.x, e.y - 10, { seed: g.rseed(), palette: PAL.elite });
            }
            // 召喚：フェーズ1は6秒ごと、フェーズ2は4.5秒ごとに子分3〜5体（フリーズ中は止まる）
            if (!frozen) e.summonT -= dt;
            if (e.summonT <= 0 && g.enemies.length < TUNE.maxEnemies) {
              e.summonT = phase2 ? 4.5 : 6;
              const n = 3 + ((Math.random() * 3) | 0);
              for (let k = 0; k < n; k++) {
                const st = pickType(); // デイリー制限も召喚に効かせる。ただし髑髏は子分にしない（従来どおり）
                spawnEnemy(st.id === "skull" ? TYPES[0] : st, e.x + (Math.random() - 0.5) * 36, e.y + (Math.random() - 0.5) * 24, false);
              }
              g.fxTop.spawn(FX.summonRise, e.x, e.y - 10, { seed: g.rseed() });
              g.fxTop.spawn(FX.manaBurst, e.x, e.y - 14, { seed: g.rseed() });
            }
            if (phase2 && !frozen) {
              chargeStep(120, 0.6, 3.4, 1.6);
              if (e.bstate === 0) mult = 1.35;
              // 放射バースト：5秒ごとに8方向へ敵弾
              e.burstT -= dt;
              if (e.burstT <= 0) {
                e.burstT = 5;
                for (let k = 0; k < 8; k++) {
                  const a = (k / 8) * Math.PI * 2 + e.bt;
                  // フェーズ2の放射弾は energy-disc の見た目で通常弾と区別する（数値は不変）
                  const f = createFx(phase2 ? FX.energyDisc : FX.plasmaShot, { x: e.x, y: e.y - 10, angle: a, size: 5, palette: PAL.fire, seed: g.rseed() });
                  g.enemyShots.push({ x: e.x, y: e.y - 10, vx: Math.cos(a) * 46, vy: Math.sin(a) * 46, life: 2.6, dmg: e.dmg * 0.8, f });
                }
                sfx.zap();
              }
            }
            // ラスボス専用の大技2種（放射バースト／直線ビーム）
            if (e.finalBoss && g.finalBoss && !frozen) {
              const fb = g.finalBoss;
              fb.burstT -= dt;
              if (fb.burstT <= 0) {
                fb.burstT = 3.5;
                g.fxTop.spawn(FX.manaBurst, e.x, e.y - 14, { seed: g.rseed(), palette: PAL.finalBoss });
                for (let k = 0; k < 10; k++) {
                  const a = (k / 10) * Math.PI * 2 + e.bt;
                  const f = createFx(FX.energyDisc, { x: e.x, y: e.y - 10, angle: a, size: 5, palette: PAL.finalBoss, seed: g.rseed() });
                  g.enemyShots.push({ x: e.x, y: e.y - 10, vx: Math.cos(a) * 52, vy: Math.sin(a) * 52, life: 2.8, dmg: e.dmg * 0.8, f });
                }
                sfx.zap();
              }
              fb.beamT -= dt;
              if (fb.beamT <= 0) { // プレイヤー方向へ予告0.7秒つきビーム
                fb.beamT = 4.2;
                const ang = Math.atan2(p.y - e.y, p.x - e.x);
                g.delayed.push({ t: 0.7, kind: "beam", x: e.x, y: e.y - 10, angle: ang, len: 280, width: 16, dmg: e.dmg * 1.2 });
              }
            }
          }
          break;
        }
        default: break; // slime は直進
      }
      e.x += mvx * e.spd * mult * slow * (frozen ? 0 : 1) * (g.weatherId() === "leaves" ? 1.1 : 1) * dt + (e.kx || 0) * dt;
      e.y += mvy * e.spd * mult * slow * (frozen ? 0 : 1) * (g.weatherId() === "leaves" ? 1.1 : 1) * dt + (e.ky || 0) * dt;
      e.kx *= Math.exp(-dt * 7); e.ky *= Math.exp(-dt * 7);
      if (e.flash > 0) e.flash -= dt;
      // 燃焼 DoT：1回/0.5秒でチリチリ削り、spirit-flame（暖色）を随伴させる
      if (e.burn > 0) {
        e.burn -= dt * (g.weatherId() === "rain" ? 1 / 0.85 : 1); // 天候「雨」: 燃焼の持続 -15%
        e.burnAcc += dt;
        if (!e.flame && g.flameCount() < 14)
          e.flame = createFx(FX.spiritFlame, { x: e.x, y: e.y, palette: PAL.fire, seed: g.rseed(), light: 1.2 });
        if (e.burnAcc >= 0.5) {
          e.burnAcc -= 0.5;
          const btick = g.burnDps * (g.burnMult || 1) * g.player.stats.dmgMult * 0.5;
          e.hp -= btick;
          const bSrc = g.burnSrc || "flame"; // 燃焼DoTの帰属（リザルト内訳）
          e.lastSrc = bSrc;
          g.trackDamage(bSrc, btick, false);
          if (e.hp <= 0) { g.killEnemy(e); continue; }
        }
        if (e.burn <= 0 && e.flame) e.flame.stop();
      }
      // 接触ダメージ（ダッシュ中は無敵。ダッシュですり抜けたらジャスト回避、フリーズ中は当たらない）
      if (d < e.r * 0.55 + 7 && g.dashT > 0) g.tryJustDodge();
      else if (g.dashT <= 0 && p.iframes <= 0 && !frozen && d < e.r * 0.55 + 7) {
        p.hp -= e.dmg;
        p.iframes = TUNE.playerIframes;
        g.addShake(4);
        g.punch(0.06, { force: true, cool: 0.3 }); // 被弾も一瞬止めて手応えを出す
        sfx.hurt();
        if (hasRelic(g, "thorns")) g.damageArea(p.x, p.y - 8, 18, 10, { knock: 40, src: "thorns" });
        if (g.onHurt) g.onHurt();
        if (p.hp <= 0) { p.hp = 0; g.finish(false); return; }
      }
      // 遠すぎたら回収
      if (d > SPAWN_R * 2.4) { g.enemies.splice(i, 1); }
    }

    // --- 弾（fx の時間進行・回収は updateVisuals 側でまとめて）
    for (let i = g.projectiles.length - 1; i >= 0; i--) {
      const b = g.projectiles[i];
      if (b.gone) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || Math.hypot(b.x - p.x, b.y - p.y) > SPAWN_R) { b.gone = true; b.f.stop(); continue; }
      const e = g.nearestEnemy(b.x, b.y, 14);
      if (e && !b.hit.has(e) && Math.hypot(e.x - b.x, e.y - b.y) < e.r * 0.75 + 6) {
        b.hit.add(e);
        const ang = Math.atan2(b.vy, b.vx);
        const wasBurning = e.burn > 0;
        g.damageEnemy(e, b.dmg, { knock: 46, pushX: Math.cos(ang), pushY: Math.sin(ang), src: b.src });
        g.fxTop.spawn(FX.hitSpark, b.x, b.y - 4, { aim: ang, height: 8, seed: g.rseed() });
        // シナジー「誘爆」：燃焼中の敵をワンド系の弾で倒すと小火球が飛び散る
        if (e.hp <= 0 && wasBurning && (b.src === "wand" || b.src === "wandEvo")) {
          for (let k = 0; k < 3; k++) {
            const a2 = Math.random() * Math.PI * 2;
            const fx2 = e.x + Math.cos(a2) * 20, fy2 = e.y + Math.sin(a2) * 16;
            g.fxTop.spawn(FX.fireball, fx2, fy2 - 8, { seed: g.rseed(), palette: PAL.fire });
            g.damageArea(fx2, fy2, 16, 10, { kind: "burst", src: "burst" });
          }
        }
        if (b.pierce-- <= 0) { b.gone = true; b.f.stop(); }
      }
      if (!b.gone) { // 敵に当たらなければ破壊可能オブジェクトを判定
        for (const pr of [...g.props]) {
          if (Math.hypot(pr.x - b.x, pr.y - b.y) < 12) {
            g.damageProp(pr, b.dmg);
            if (b.pierce-- <= 0) { b.gone = true; b.f.stop(); }
            break;
          }
        }
      }
    }

    // --- 敵弾（ボス第2形態の放射バースト）
    for (let i = g.enemyShots.length - 1; i >= 0; i--) {
      const b = g.enemyShots[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && g.dashT > 0 && Math.hypot(b.x - p.x, b.y - (p.y - 8)) < 11) g.tryJustDodge(); // 敵弾のすり抜けもジャスト回避
      if (!dead && g.dashT <= 0 && p.iframes <= 0 && Math.hypot(b.x - p.x, b.y - (p.y - 8)) < 11) {
        p.hp -= b.dmg;
        p.iframes = TUNE.playerIframes;
        g.addShake(4); g.punch(0.06, { force: true, cool: 0.3 });
        sfx.hurt();
        if (hasRelic(g, "thorns")) g.damageArea(p.x, p.y - 8, 18, 10, { knock: 40, src: "thorns" });
        if (g.onHurt) g.onHurt();
        dead = true;
        if (p.hp <= 0) { p.hp = 0; g.finish(false); return; }
      }
      if (dead) { b.f.stop(); g.enemyShots.splice(i, 1); }
    }

    // --- ディレイ着弾（雷・聖光・星はアニメの本格的な着弾瞬間にダメージを出す）
    for (let i = g.delayed.length - 1; i >= 0; i--) {
      const dl = g.delayed[i];
      dl.t -= dt;
      if (dl.t <= 0) {
        if (dl.kind === "beam") { // ラスボスの直線ビーム（帯に当たれば被弾、ダッシュですり抜ければジャスト回避）
          g.fxTop.spawn(FX.arcaneBeam, dl.x, dl.y, { seed: g.rseed(), angle: dl.angle, palette: PAL.finalBoss });
          const ca = Math.cos(dl.angle), sa = Math.sin(dl.angle);
          const rx = p.x - dl.x, ry = (p.y - 8) - dl.y;
          const along = rx * ca + ry * sa, perp = Math.abs(-rx * sa + ry * ca);
          if (along > 0 && along < dl.len && perp < dl.width) {
            if (g.dashT > 0) g.tryJustDodge();
            else if (p.iframes <= 0) {
              p.hp -= dl.dmg;
              p.iframes = TUNE.playerIframes;
              g.addShake(4); g.punch(0.06, { force: true, cool: 0.3 }); sfx.hurt();
              if (hasRelic(g, "thorns")) g.damageArea(p.x, p.y - 8, 18, 10, { knock: 40, src: "thorns" });
              if (g.onHurt) g.onHurt();
              if (p.hp <= 0) { p.hp = 0; g.delayed.splice(i, 1); g.finish(false); return; }
            }
          }
          g.delayed.splice(i, 1);
          continue;
        }
        if (dl.storm) { // 天候「嵐」の落雷
          g.fxTop.spawn(FX.lightningStrike, dl.x, dl.y, { seed: g.rseed() });
          g.damageArea(dl.x, dl.y - 8, dl.r, dl.dmg, { kind: "bolt", src: "storm", knock: 20 });
          if (Math.hypot(p.x - dl.x, (p.y - 8) - dl.y) < dl.r) {
            if (g.dashT > 0) g.tryJustDodge();
            else if (p.iframes <= 0) {
              p.hp -= 8;
              p.iframes = TUNE.playerIframes; g.addShake(3); sfx.hurt();
              if (g.onHurt) g.onHurt();
              if (p.hp <= 0) { p.hp = 0; g.delayed.splice(i, 1); g.finish(false); return; }
            }
          }
          g.delayed.splice(i, 1);
          continue;
        }
        const isBolt = dl.kind === "bolt" || dl.kind === "boltChain";
        g.damageArea(dl.x, dl.y - 8, dl.r, dl.dmg, {
          knock: dl.kind === "smite" ? 60 : 30,
          slow: dl.slow,
          kind: isBolt ? "bolt" : dl.kind,
          src: dl.src,
          electrify: dl.electrify,
          sfx: isBolt ? sfx.thunder : undefined,
        });
        if (isBolt) g.fxTop.spawn(FX.zapHit, dl.x, dl.y - 10, { seed: g.rseed() });
        if (dl.kind === "boltChain") {
          // 着弾点付近の敵へ60%で連鎖（対象は着弾で生き残った最も近い敵を起点に探す）
          const src = g.nearestEnemy(dl.x, dl.y, dl.r + 10);
          g.chainFrom(dl.x, dl.y, src, dl.dmg * 0.6, 52, dl.src || "thunderEvo");
        }
        g.delayed.splice(i, 1);
      }
    }

    // --- 拾い物
    const magnetR = p.stats.magnet;
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const it = g.pickups[i];
      const dx = p.x - it.x, dy = p.y - 10 - it.y, d = Math.hypot(dx, dy);
      if (it.vacuum || d < magnetR + 30) { const k = Math.min(1, dt * (6 + 240 / Math.max(8, d))); it.x += dx * k * 1.6; it.y += dy * k * 1.6; }
      if (d < 9) {
        g.pickups.splice(i, 1);
        if (it.kind === "xp") {
          g.gainXp(it.value); sfx.pickup();
          if (hasRelic(g, "gemBomb")) g.damageArea(p.x, p.y - 8, 20, 6, { knock: 20, src: "gemBomb" });
        }
        else if (it.kind === "coin") { g.coins += it.value; sfx.coin(); }
        else if (it.kind === "itemFreeze" || it.kind === "itemVacuum" || it.kind === "itemBomb") { g.useInstantItem(it.kind); }
        else if (it.kind === "chest") {
          g.fxTop.spawn(FX.chestOpen, p.x, p.y - 8, { seed: g.rseed(), palette: PAL.xpGold }); // 宝箱が開く
          g.fxTop.spawn(FX.lootBeam, p.x, p.y - 12, { seed: g.rseed(), palette: PAL.xpGold });
          g.fxTop.spawn(FX.confetti, p.x, p.y - 16, { seed: g.rseed() });
          sfx.level();
          if (g.onChest) g.onChest();
        }
        else { p.hp = Math.min(p.maxHp, p.hp + it.value); sfx.heart(); g.fxTop.spawn(FX.hitSpark, p.x, p.y - 10, { seed: g.rseed(), height: 6 }); }
      } else if (d > 340 && it.kind !== "chest") g.pickups.splice(i, 1);
    }

    // --- 武器
    for (const w of g.weapons) {
      const def = WEAPONS[w.id];
      w.t -= dt;
      if (w.t <= 0) {
        w.t = def.cd(w.lv) * p.stats.cdMult * (g.justBuffT > 0 ? 0.75 : 1); // ジャスト回避バフ（cdMult 本体は書き換えない）
        def.fire(g, w.lv);
      }
    }

    // 演出レイヤーの時間進行は updateVisuals（main が毎フレーム呼ぶ）に任せる

    // --- ラスボス：300秒到達で即勝利ではなく最終決戦へ（1ラン1回だけ）
    if (g.time >= TUNE.winTime && !g.over && !g.wonOnce && !g.finalBoss && !g.finalBossDone) g.startFinalBoss();
  };

  /** ラスボス戦開始：通常敵を一掃し、円形アリーナに巨大な精鋭髑髏を出現させる */
  g.startFinalBoss = () => {
    const p = g.player;
    for (const e of [...g.enemies]) {
      g.fxTop.spawn(FX.poof, e.x, e.y, { seed: g.rseed(), light: 0.5 });
      e.f.stop();
      if (e.flame) e.flame.stop();
    }
    g.enemies.length = 0;
    for (const z of g.zones) { if (z.f) z.f.stop(); }
    g.zones.length = 0;
    const dps = Math.max(1, totalDps(g.player.stats, g.weapons));
    const hp = Math.min(200000, Math.max(1500, Math.round(dps * 30)));
    const boss = spawnEnemy(TYPES[TYPES.length - 1], p.x + 60, p.y - 20, true, { boss: true, pal: PAL.finalBoss });
    boss.maxHp = hp; boss.hp = hp;
    boss.r = 30;
    boss.dmg = Math.max(boss.dmg, 16);
    boss.finalBoss = true;
    g.finalBoss = { e: boss, cx: p.x, cy: p.y, R: 150, burstT: 3.5, beamT: 2.5 };
    if (g.arenaFx) g.arenaFx.stop();
    g.arenaFx = g.fxWorld.spawn(FX.runeCircle, p.x, p.y, { seed: g.rseed(), palette: PAL.finalBoss, radius: 150 });
    if (g.onBanner) g.onBanner("最終決戦！ 巨大髑髏を倒せ！");
    g.addShake(6);
    sfx.elite();
  };

  /** ラスボス撃破＝勝利（その後エンドレス継続も可能） */
  g.onFinalBossDown = () => {
    g.finalBoss = null;
    g.finalBossDone = true;
    if (g.arenaFx) { g.arenaFx.stop(); g.arenaFx = null; }
    if (g.player) g.fxTop.spawn(FX.implosion, g.player.x, g.player.y - 10, { seed: g.rseed() });
    g.unlockAch("finalBossDown");
    g.triggerVictory();
  };

  // ---- 破壊可能オブジェクト＋即時アイテム --------------------------------------
  /** プレイヤー周辺のセル（150px）を決定的に走査して props を配置し、遠方を除去する */
  g.updateProps = () => {
    const p = g.player; if (!p) return;
    const CELL = 150, R = 420;
    const cx0 = Math.floor((p.x - R) / CELL), cx1 = Math.floor((p.x + R) / CELL);
    const cy0 = Math.floor((p.y - R) / CELL), cy1 = Math.floor((p.y + R) / CELL);
    const kinds = ["candle", "crystal", "pot"];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const key = cx + ":" + cy;
      if (g.propCells.has(key)) continue;
      g.propCells.add(key);
      let h = (cx * 73856093) ^ (cy * 19349663) ^ 0x9e3779b9;
      h = (h ^ (h >>> 13)) >>> 0;
      if (h % 100 >= 15) continue; // 約15%のセルにだけ配置
      const ox = ((h >>> 7) % 121) - 60, oy = ((h >>> 13) % 121) - 60;
      const x = cx * CELL + CELL / 2 + ox, y = cy * CELL + CELL / 2 + oy;
      if (Math.hypot(x - p.x, y - p.y) < 46) continue; // プレイヤーの足元には置かない
      g.props.push({ x, y, kind: kinds[h % 3], hp: 3, flash: 0, seed: h });
    }
    for (let i = g.props.length - 1; i >= 0; i--) {
      if (Math.hypot(g.props[i].x - p.x, g.props[i].y - p.y) > 500) g.props.splice(i, 1);
    }
  };

  g.damageProp = (pr, dmg) => {
    const i = g.props.indexOf(pr);
    if (i < 0) return;
    pr.hp -= dmg;
    pr.flash = 0.1;
    if (pr.hp > 0) return;
    g.props.splice(i, 1);
    g.fxTop.spawn(FX.poof, pr.x, pr.y - 6, { seed: g.rseed(), light: 0.6 });
    g.fxTop.spawn(FX.collectBurst, pr.x, pr.y - 6, { seed: g.rseed() });
    const roll = Math.random();
    if (roll < 0.55) g.spawnPickup(pr.x, pr.y, "coin", Math.max(1, Math.round(3 * g.coinMult)));
    else if (roll < 0.75) g.spawnPickup(pr.x, pr.y, "heart", TUNE.heartHeal);
    else if (roll < 0.87) { /* ドロップなし */ }
    else {
      const items = ["itemFreeze", "itemVacuum", "itemBomb"];
      g.spawnPickup(pr.x, pr.y, items[(Math.random() * 3) | 0], 0);
    }
  };

  /** 即時アイテムの発動（拾った瞬間に効果） */
  g.useInstantItem = (kind) => {
    const p = g.player;
    if (kind === "itemFreeze") {
      for (const e of g.enemies) e.freeze = Math.max(e.freeze || 0, 3);
      g.fxTop.spawn(FX.timeStop, p.x, p.y - 10, { seed: g.rseed() });
      if (g.onBanner) g.onBanner("時止め！ 全ての敵が3秒止まる");
    } else if (kind === "itemVacuum") {
      for (const it of g.pickups) if (it.kind === "xp" || it.kind === "coin") it.vacuum = true;
      g.fxTop.spawn(FX.collectBurst, p.x, p.y - 10, { seed: g.rseed() });
      if (g.onBanner) g.onBanner("ジェム吸引！");
    } else if (kind === "itemBomb") {
      g.fxTop.spawn(FX.bigExplosion, p.x, p.y - 10, { seed: g.rseed() });
      for (const b of g.enemyShots) b.f.stop();
      g.enemyShots.length = 0;
      g.damageArea(p.x, p.y, 170, 45, { src: "bomb", kind: "holy" });
      if (g.onBanner) g.onBanner("聖水ボム！");
    }
    sfx.relic();
  };

  /** 300秒到達：コインはまだ貯金しない（エンドレスで稼いだ分も含め、ラン終了時に一括入金） */
  g.triggerVictory = () => {
    g.wonOnce = true; g.over = true; g.won = true;
    // 勝利系の実績
    g.unlockAch("firstClear");
    if (!g.dashUsed) g.unlockAch("noDashClear");
    if (g.curse.length >= 1) g.unlockAch("curseClear");
    if (g.curse.length >= 3) g.unlockAch("allCurseClear");
    if (g.daily) g.unlockAch("dailyClear");
    g.hitStop = 0; g.stopCool = 0;
    // 夜明けの瞬間：周囲の闇が吸い込まれるインプロージョン
    if (g.player) g.fxTop.spawn(FX.implosion, g.player.x, g.player.y - 10, { seed: g.rseed() });
    g.lastBest = recordBest({ time: g.time, level: g.level, kills: g.kills });
    sfx.win();
    if (g.onEnd) g.onEnd(true);
  };

  /** エンドレス継続：勝利状態を解いて同じランを続ける（スケーリングは時間式なので自然に延びる） */
  g.continueEndless = () => {
    if (!g.wonOnce || g.endless) return;
    g.endless = true; g.over = false; g.won = false;
    if (g.onBanner) g.onBanner("エンドレス突入！ 夜はまだ続く…");
  };

  /** ランのコインを一度だけ貯金へ入金（実績ボーナス achPending もここで一括） */
  g.bankRun = () => {
    if (g.banked) return;
    g.banked = true;
    addBank(g.coins + (g.achPending || 0));
    flushAch();
  };

  g.flameCount = () => { let n = 0; for (const e of g.enemies) if (e.flame) n++; return n; };

  g.gainXp = (v) => {
    // 天候「桜」: ジェムの価値 +20%（厳密にはスポーン時に確定させたいが、一元化のため取得側で換算）
    if (g.weatherId() === "cherry") v = Math.round(v * 1.2);
    if (g.xpMult && g.xpMult !== 1) v = Math.round(v * g.xpMult); // デイリー: XP倍率
    g.xp += v;
    while (g.xp >= g.xpNeed) {
      g.xp -= g.xpNeed;
      g.level++;
      g.xpNeed = Math.floor(TUNE.xpBase + TUNE.xpLinear * g.level + TUNE.xpQuad * g.level * g.level);
      g.pendingLevels++;
    }
    if (g.level >= 20) g.unlockAch("level20");
    if (g.pendingLevels > 0 && g.onLevelUp) g.onLevelUp();
  };

  /** エフェクト類の時間進行だけを進める（playing/levelup/pause 全状態で毎フレーム呼ぶ） */
  g.updateVisuals = (dt) => {
    g.fxWorld.update(dt); g.fxTop.update(dt); g.fxText.update(dt);
    g.shake = Math.max(0, g.shake - dt * 10);
    for (const e of g.enemies) {
      e.f.options.x = e.x; e.f.options.y = e.y; e.f.update(dt);
      if (e.flame) {
        e.flame.options.x = e.x; e.flame.options.y = e.y; e.flame.update(dt);
        if (e.flame.done()) e.flame = null;
      }
    }
    for (let i = g.projectiles.length - 1; i >= 0; i--) {
      const b = g.projectiles[i];
      b.f.options.x = b.x; b.f.options.y = b.y; b.f.update(dt);
      if (b.gone && b.f.done()) g.projectiles.splice(i, 1);
    }
    for (const it of g.pickups) { it.f.options.x = it.x; it.f.options.y = it.y; it.f.update(dt); }
    for (const b of g.enemyShots) { b.f.options.x = b.x; b.f.options.y = b.y; b.f.update(dt); }
  };

  g.finish = (win) => {
    if (win && !g.endless && !g.wonOnce) { g.triggerVictory(); return; }
    g.over = true; g.won = win;
    g.hitStop = 0; g.stopCool = 0; // 終了瞬間の凍結を解いて結果表示へ
    g.bankRun(); // ラン中で拾ったコインを永続貯金へ入金（二重入金なし）
    flushAch();
    g.lastBest = recordBest({ time: g.time, level: g.level, kills: g.kills });
    if (win) sfx.win(); else sfx.over();
    if (g.onEnd) g.onEnd(win);
  };

  g.reset();
  return g;
}
