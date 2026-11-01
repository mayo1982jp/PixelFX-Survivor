// pixelfx の効果モジュールをゲームから使えるようにするレジストリと、
// 大量の一時効果（ヒット・爆発・数字など）を寿命付きで回すレイヤー管理。
import { createFx } from "../vendor/pixelfx/core/index.js";

import * as slime from "../vendor/pixelfx/fx/critters/slime.js";
import * as ghost from "../vendor/pixelfx/fx/critters/ghost.js";
import * as bat from "../vendor/pixelfx/fx/critters/bat.js";
import * as eyeball from "../vendor/pixelfx/fx/critters/eyeball.js";
import * as wisp from "../vendor/pixelfx/fx/critters/wisp.js";
import * as flyingSkull from "../vendor/pixelfx/fx/critters/flying-skull.js";
import * as frog from "../vendor/pixelfx/fx/critters/frog.js";
import * as snake from "../vendor/pixelfx/fx/critters/snake.js";
import * as bird from "../vendor/pixelfx/fx/critters/bird.js";
import * as fishSchool from "../vendor/pixelfx/fx/critters/fish-school.js";
import * as jellyfish from "../vendor/pixelfx/fx/critters/jellyfish.js";
import * as butterfly from "../vendor/pixelfx/fx/critters/butterfly.js";
import * as plasmaShot from "../vendor/pixelfx/fx/projectiles/plasma-shot.js";
import * as hitSpark from "../vendor/pixelfx/fx/impacts/hit-spark.js";
import * as zapHit from "../vendor/pixelfx/fx/lightning/zap-hit.js";
import * as lightningStrike from "../vendor/pixelfx/fx/lightning/lightning-strike.js";
import * as snowflakeBurst from "../vendor/pixelfx/fx/ice/snowflake-burst.js";
import * as spiritFlame from "../vendor/pixelfx/fx/fire/spirit-flame.js";
import * as smite from "../vendor/pixelfx/fx/holy/smite.js";
import * as manaBurst from "../vendor/pixelfx/fx/arcane/mana-burst.js";
import * as starFall from "../vendor/pixelfx/fx/arcane/star-fall.js";
import * as poof from "../vendor/pixelfx/fx/spawn/poof.js";
import * as plasmaExplosion from "../vendor/pixelfx/fx/explosions/plasma-explosion.js";
import * as gemSpin from "../vendor/pixelfx/fx/pickups/gem-spin.js";
import * as coinSpin from "../vendor/pixelfx/fx/pickups/coin-spin.js";
import * as heartPickup from "../vendor/pixelfx/fx/pickups/heart-pickup.js";
import * as damageNumber from "../vendor/pixelfx/fx/ui/damage-number.js";
import * as critNumber from "../vendor/pixelfx/fx/ui/crit-number.js";
import * as confetti from "../vendor/pixelfx/fx/ui/confetti.js";
import * as fireflies from "../vendor/pixelfx/fx/weather/fireflies.js";

// ゲームで使うエフェクトの一覧（敵の見た目・武器・拾い物・UI演出は全部 pixelfx）
export const FX = {
  slime, ghost, bat, eyeball, wisp, flyingSkull,
  frog, snake, bird, fishSchool, jellyfish, butterfly,
  plasmaShot, hitSpark, zapHit, lightningStrike, snowflakeBurst, spiritFlame,
  smite, manaBurst, starFall, poof, plasmaExplosion,
  gemSpin, coinSpin, heartPickup, damageNumber, critNumber, confetti, fireflies,
};

// 色だけ変えたい時のための差し色パレット（resolveOptions が本家の長さへ再サンプルしてくれる）
export const PAL = {
  fire: ["#200604", "#4a1008", "#8a2410", "#d44a1c", "#ff8a2a", "#ffc23d", "#ffe26b", "#fff3a6", "#ffffff"],
  elite: ["#140a2a", "#2c1454", "#4e2a8a", "#7c4ac2", "#a878e8", "#d8b8ff", "#f4e8ff", "#ffffff"],
  xpBlue: ["#08122a", "#0f2a52", "#1a4a8a", "#2f7cc2", "#62b8f4", "#a6e0ff", "#dcf4ff", "#ffffff"],
  xpGold: ["#2a1c04", "#543808", "#8a6010", "#c9901c", "#f4c03a", "#ffe27a", "#fff4c0", "#ffffff"],
  heart: undefined, // 既定の赤を使わせる
};

/**
 * 寿命付きエフェクトのレイヤー。spawn() で生成し、update() で進め、
 * done() になったものは自動で回収する。cap を超えると古いものから終わらせる。
 */
export class FxLayer {
  constructor(cap = 48) {
    this.items = [];
    this.cap = cap;
  }
  /** mod をワールド座標 (x, y) に生成。opts は pixelfx 用のオプション（seed / palette / angle など）。 */
  spawn(mod, x, y, opts = {}) {
    if (this.items.length >= this.cap) this.items.shift().f.stop();
    const f = createFx(mod, { x, y, ...opts });
    this.items.push({ f });
    return f;
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.f.update(dt);
      if (it.f.done()) this.items.splice(i, 1);
    }
  }
  draw(frame) {
    for (const it of this.items) it.f.draw(frame);
  }
  clear() { this.items.length = 0; }
}
