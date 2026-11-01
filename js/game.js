// ゲームコア：プレイヤー・敵・弾・拾い物・スポーン演出と衝突判定。
// pixelfx の critter を敵の見た目、projectile / impact / spell を武器演出として使う。
import { createFx } from "../vendor/pixelfx/core/index.js";
import { FX, PAL, FxLayer } from "./fx.js";
import { sfx } from "./sfx.js";
import { WEAPONS } from "./weapons.js";
import { getLevel, addBank } from "./meta.js";

export const VW = 320, VH = 180; // 論理解像度（フレームサイズ）
const SPAWN_R = 200;             // プレイヤーからの湧き半径
const MAX_ENEMIES = 170;

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
    vw: VW, vh: VH,
    time: 0, kills: 0, over: false, won: false,
    level: 1, xp: 0, xpNeed: 9, pendingLevels: 0,
    coins: 0, coinMult: 1,
    player: null, enemies: [], projectiles: [], pickups: [], delayed: [],
    weapons: [], passives: {}, burnDps: 0,
    fxWorld: new FxLayer(36), fxTop: new FxLayer(64), fxText: new FxLayer(16),
    cam: { x: 0, y: 0 }, shake: 0,
    seed: 1, spawnT: 0, swarmT: 20, bossT: 50,
    onLevelUp: null, onEnd: null, onHurt: null,
  };

  g.rseed = () => (g.seed = (g.seed * 16807 + 11) % 2147483647) % 65521;
  g.addShake = (a) => { g.shake = Math.min(8, Math.max(g.shake, a)); };
  g.passiveCount = () => Object.keys(g.passives).length;

  // ---- 初期化 ---------------------------------------------------------------
  g.reset = function reset() {
    g.time = 0; g.kills = 0; g.over = false; g.won = false;
    g.level = 1; g.xp = 0; g.xpNeed = 9; g.pendingLevels = 0;
    // 永続強化（ショップ購入レベル）を初期ステータスへ反映
    const maxHp = 100 + 20 * getLevel("vitality");
    g.coins = 0; g.coinMult = 1 + 0.2 * getLevel("greed");
    g.player = {
      x: 0, y: 0, hp: maxHp, maxHp, iframes: 0, flip: false, moving: false, bob: 0,
      stats: {
        dmgMult: 1 + 0.06 * getLevel("might"),
        cdMult: 1,
        spdMult: 1 + 0.04 * getLevel("swift"),
        magnet: 26 * (1 + 0.15 * getLevel("magnet")),
        crit: 0.05,
        regen: 0.3 * getLevel("regen"),
      },
    };
    g.enemies.length = 0; g.projectiles.length = 0; g.pickups.length = 0; g.delayed.length = 0;
    g.weapons = [{ id: "wand", lv: 1, t: 0.5 }];
    g.passives = {}; g.burnDps = 0;
    g.fxWorld.clear(); g.fxTop.clear(); g.fxText.clear();
    g.cam.x = -VW / 2; g.cam.y = -VH / 2;
    g.shake = 0; g.spawnT = 0.8; g.swarmT = 20; g.bossT = 50; g.seed = Date.now() % 65521 || 7;
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

  g.addProjectile = (x, y, angle, speed, life, dmg, pierce) => {
    if (g.projectiles.length > 26) return;
    const f = createFx(FX.plasmaShot, { x, y, angle, size: 5 + Math.min(4, dmg / 6) });
    g.projectiles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, dmg, pierce, hit: new Set(), f });
  };

  // ---- ダメージ ---------------------------------------------------------------
  g.showDamage = (x, y, dmg, crit) => {
    if (g.fxText.items.length >= g.fxText.cap - 2 && !crit) return; // 数字が多いときは通常ヒットを間引く
    const mod = crit ? FX.critNumber : FX.damageNumber;
    const text = crit ? `${Math.round(dmg)}!` : `-${Math.round(dmg)}`;
    g.fxText.spawn(mod, x + (Math.random() - 0.5) * 8, y - 14, { text, seed: g.rseed() });
  };

  /** 範囲ダメージ。slow / knock を任意で付ける */
  g.damageArea = (x, y, r, dmg, opt = {}) => {
    let hitAny = false;
    for (const e of [...g.enemies]) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= r + e.r * 0.5) {
        const ang = Math.atan2(e.y - y, e.x - x);
        g.damageEnemy(e, dmg, { knock: (opt.knock ?? 34) * (1 - d / (r + e.r)), pushX: Math.cos(ang), pushY: Math.sin(ang), slow: opt.slow });
        hitAny = true;
      }
    }
    if (hitAny && opt.sfx) opt.sfx();
    return hitAny;
  };

  g.damageEnemy = (e, raw, opt = {}) => {
    if (e.hp <= 0) return;
    const crit = Math.random() < g.player.stats.crit;
    const dmg = raw * g.player.stats.dmgMult * (crit ? 2.5 : 1);
    e.hp -= dmg;
    e.flash = 0.12;
    if (opt.slow) e.slow = Math.max(e.slow || 0, opt.slow);
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
    if (e.elite || e.type.id === "skull") {
      g.fxTop.spawn(FX.plasmaExplosion, e.x, e.y - 14, { seed: g.rseed(), light: 0.8 });
      g.addShake(3); sfx.elite();
    } else {
      g.fxTop.spawn(FX.poof, e.x, e.y, { seed: g.rseed(), light: 0.5 });
      sfx.kill();
    }
    // XPジェム（gem-spin を再配色で使っている）
    const n = e.elite ? 4 : 1;
    for (let k = 0; k < n; k++) {
      const v = Math.max(1, Math.round(e.type.xp * (e.elite ? 5 : 1) / n));
      g.spawnPickup(e.x + (Math.random() - 0.5) * 14, e.y + (Math.random() - 0.5) * 8, "xp", v);
    }
    // コイン（永続ショップ用の通貨。強欲レベルで取得量が増える）
    const cv = Math.max(1, Math.round(e.type.xp * 0.6)) * (e.elite ? 6 : 1);
    g.spawnPickup(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 6, "coin", Math.round(cv * g.coinMult));
    if (e.type.id !== "skull" && Math.random() < (e.elite ? 0.5 : 0.025)) g.spawnPickup(e.x, e.y, "heart", 15);
  };

  // ---- 拾い物 -----------------------------------------------------------------
  g.spawnPickup = (x, y, kind, value) => {
    const mod = kind === "xp" ? FX.gemSpin : kind === "coin" ? FX.coinSpin : FX.heartPickup;
    const opts = { seed: g.rseed() };
    if (kind === "xp") opts.palette = value >= 6 ? PAL.xpGold : PAL.xpBlue;
    const f = createFx(mod, { x, y, ...opts });
    g.pickups.push({ x, y, kind, value, f, vx: 0, vy: 0 });
  };

  // ---- 敵の生成 ----------------------------------------------------------------
  function spawnEnemy(type, x, y, elite) {
    const scale = 1 + g.time / 120 * 0.9; // 300秒終点で約3.25倍（元10分版の600秒終点と同等）
    const opts = { seed: g.rseed() };
    if (elite) { opts.palette = PAL.elite; opts.light = 1.5; opts.seed = g.rseed(); }
    const f = createFx(type.mod, { x, y, ...opts });
    g.enemies.push({
      type, x, y,
      hp: type.hp * scale * (elite ? 5 : 1),
      maxHp: type.hp * scale * (elite ? 5 : 1),
      spd: type.spd * (0.85 + Math.random() * 0.3) * (elite ? 0.9 : 1),
      r: type.r, dmg: type.dmg * (1 + g.time / 250) * (elite ? 1.4 : 1), // 終点2.2倍（元10分版と同等）
      fly: type.fly, elite: !!elite,
      f, flash: 0, slow: 0, burn: 0, burnAcc: 0, kx: 0, ky: 0, flame: null,
    });
  }
  g.spawnEnemy = spawnEnemy;

  function pickType() {
    const pool = TYPES.filter((t) => g.time >= t.at);
    let sum = 0; for (const t of pool) sum += t.w;
    let r = Math.random() * sum;
    for (const t of pool) { r -= t.w; if (r <= 0) return t; }
    return pool[0];
  }
  const ringPoint = () => {
    const a = Math.random() * Math.PI * 2;
    return [g.player.x + Math.cos(a) * SPAWN_R, g.player.y + Math.sin(a) * SPAWN_R * 0.8];
  };

  // ---- 本体アップデート ----------------------------------------------------------
  g.update = function update(dt, input) {
    if (!g.over) g.time += dt;
    const p = g.player;

    // --- プレイヤー移動
    let mx = 0, my = 0;
    if (input.left) mx -= 1; if (input.right) mx += 1;
    if (input.up) my -= 1; if (input.down) my += 1;
    const mag = Math.hypot(mx, my);
    p.moving = mag > 0;
    if (mag) { mx /= mag; my /= mag; if (mx) p.flip = mx > 0; } // 魔女は原画が左向き（杖が左）なので flip の意味を HERO と逆にする
    const spd = 58 * p.stats.spdMult;
    p.x += mx * spd * dt; p.y += my * spd * dt;
    if (p.moving) p.bob += dt * 9;
    p.iframes = Math.max(0, p.iframes - dt);
    if (p.stats.regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);

    // --- カメラ追従（シェイクの減衰は updateVisuals 側）
    g.cam.x += (p.x - VW / 2 - g.cam.x) * Math.min(1, dt * 8);
    g.cam.y += (p.y - VH / 2 - 14 - g.cam.y) * Math.min(1, dt * 8);

    // --- 湧き
    g.spawnT -= dt;
    const interval = Math.max(0.22, 1.35 - g.time * 0.0032); // 終点0.39秒（元10分版と同等）
    if (g.spawnT <= 0 && g.enemies.length < MAX_ENEMIES) {
      g.spawnT = interval;
      const t = pickType();
      const [x, y] = ringPoint();
      spawnEnemy(t, x, y, g.time > 55 && Math.random() < 0.06); // ラン経過18%時点（元110秒/600秒と同等）
    }
    g.swarmT -= dt;
    if (g.swarmT <= 0) { // 群れラッシュ：同じ方向からまとめて湧く
      g.swarmT = 42;
      const a = Math.random() * Math.PI * 2;
      const n = 10 + Math.floor(g.time / 22); // 終点で約23湧（元10分版と同等）
      for (let i = 0; i < n && g.enemies.length < MAX_ENEMIES; i++) {
        const aa = a + (Math.random() - 0.5) * 0.8;
        spawnEnemy(pickType(), p.x + Math.cos(aa) * SPAWN_R, p.y + Math.sin(aa) * SPAWN_R * 0.8, false);
      }
      g.addShake(2);
    }
    g.bossT -= dt;
    if (g.bossT <= 0) { // 髑髏の精鋭
      g.bossT = 60;
      if (g.time > 50) {
        const [x, y] = ringPoint();
        spawnEnemy(TYPES[TYPES.length - 1], x, y, true);
        g.addShake(3);
      }
    }

    // --- 敵
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const slow = e.slow > 0 ? 0.5 : 1;
      if (e.slow > 0) e.slow -= dt;
      e.x += (dx / d) * e.spd * slow * dt + (e.kx || 0) * dt;
      e.y += (dy / d) * e.spd * slow * dt + (e.ky || 0) * dt;
      e.kx *= Math.exp(-dt * 7); e.ky *= Math.exp(-dt * 7);
      if (e.flash > 0) e.flash -= dt;
      // 燃焼 DoT：1回/0.5秒でチリチリ削り、spirit-flame（暖色）を随伴させる
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnAcc += dt;
        if (!e.flame && g.flameCount() < 14)
          e.flame = createFx(FX.spiritFlame, { x: e.x, y: e.y, palette: PAL.fire, seed: g.rseed(), light: 1.2 });
        if (e.burnAcc >= 0.5) {
          e.burnAcc -= 0.5;
          e.hp -= g.burnDps * g.player.stats.dmgMult * 0.5;
          if (e.hp <= 0) { g.killEnemy(e); continue; }
        }
        if (e.burn <= 0 && e.flame) e.flame.stop();
      }
      // 接触ダメージ
      if (p.iframes <= 0 && d < e.r * 0.55 + 7) {
        p.hp -= e.dmg;
        p.iframes = 0.7;
        g.addShake(4);
        sfx.hurt();
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
        g.damageEnemy(e, b.dmg, { knock: 46, pushX: Math.cos(ang), pushY: Math.sin(ang) });
        g.fxTop.spawn(FX.hitSpark, b.x, b.y - 4, { aim: ang, height: 8, seed: g.rseed() });
        if (b.pierce-- <= 0) { b.gone = true; b.f.stop(); }
      }
    }

    // --- ディレイ着弾（雷・聖光・星はアニメの本格的な着弾瞬間にダメージを出す）
    for (let i = g.delayed.length - 1; i >= 0; i--) {
      const dl = g.delayed[i];
      dl.t -= dt;
      if (dl.t <= 0) {
        g.damageArea(dl.x, dl.y - 8, dl.r, dl.dmg, {
          knock: dl.kind === "smite" ? 60 : 30,
          sfx: dl.kind === "bolt" ? sfx.thunder : undefined,
        });
        if (dl.kind === "bolt") g.fxTop.spawn(FX.zapHit, dl.x, dl.y - 10, { seed: g.rseed() });
        g.delayed.splice(i, 1);
      }
    }

    // --- 拾い物
    const magnetR = p.stats.magnet;
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const it = g.pickups[i];
      const dx = p.x - it.x, dy = p.y - 10 - it.y, d = Math.hypot(dx, dy);
      if (d < magnetR + 30) { const k = Math.min(1, dt * (6 + 240 / Math.max(8, d))); it.x += dx * k * 1.6; it.y += dy * k * 1.6; }
      if (d < 9) {
        g.pickups.splice(i, 1);
        if (it.kind === "xp") { g.gainXp(it.value); sfx.pickup(); }
        else if (it.kind === "coin") { g.coins += it.value; sfx.coin(); }
        else { p.hp = Math.min(p.maxHp, p.hp + it.value); sfx.heart(); g.fxTop.spawn(FX.hitSpark, p.x, p.y - 10, { seed: g.rseed(), height: 6 }); }
      } else if (d > 340) g.pickups.splice(i, 1);
    }

    // --- 武器
    for (const w of g.weapons) {
      const def = WEAPONS[w.id];
      w.t -= dt;
      if (w.t <= 0) {
        w.t = def.cd(w.lv) * p.stats.cdMult;
        def.fire(g, w.lv);
      }
    }

    // 演出レイヤーの時間進行は updateVisuals（main が毎フレーム呼ぶ）に任せる

    // --- 勝利（5分生存）
    if (g.time >= 300 && !g.over) g.finish(true);
  };

  g.flameCount = () => { let n = 0; for (const e of g.enemies) if (e.flame) n++; return n; };

  g.gainXp = (v) => {
    g.xp += v;
    while (g.xp >= g.xpNeed) {
      g.xp -= g.xpNeed;
      g.level++;
      g.xpNeed = Math.floor(9 + g.level * 5 + g.level * g.level * 1.2);
      g.pendingLevels++;
    }
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
  };

  g.finish = (win) => {
    g.over = true; g.won = win;
    addBank(g.coins); // ラン中で拾ったコインを永続貯金へ入金
    if (win) sfx.win(); else sfx.over();
    if (g.onEnd) g.onEnd(win);
  };

  g.reset();
  return g;
}
