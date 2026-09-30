import { TABLE_H, TABLE_W, VIEW_MARGIN } from '../config';
import { damp } from '../core/easing';
import type { Game } from '../game/game';
import { PEGS } from '../game/spin';
import { BallFxStore } from './ballfx';
import { Jelly } from './jelly';
import { Particles } from './particles';
import { WordPops } from './wordpops';

/** All purely-visual state. Updated every frame; never read by the game logic. */
export class Fx {
  readonly jelly = new Jelly();
  readonly particles = new Particles();
  readonly pops = new WordPops();
  readonly balls = new BallFxStore();
  /** Seconds of animation time (runs at world speed, so slow-mo slows it too). */
  time = 0;
  /** White flash overlay after a strike, 0..1. */
  flash = 0;
  vignette = 0;
  vignetteTarget = 0;
  /** Per vertex id: seconds of red "nope" flash left. */
  readonly nope = new Map<number, number>();
  /** Per pocket vertex id: chomp animation time left. */
  readonly chomp = new Map<number, number>();
  /** Per pocket vertex id: animated hole radius. */
  readonly holeR = new Map<number, number>();
  /** Per vertex id: seconds since a scratch bolted it (drives the wrench animation). */
  readonly bolted = new Map<number, number>();
  readonly pegFlick: number[] = new Array<number>(PEGS).fill(0);
  lastPeg = 0;
  /** Strike speed lines. */
  speedLines: { x: number; y: number; dx: number; dy: number; t: number; power: number } | null = null;
  /** Game-over celebration timers. */
  confettiRain = 0;
  fireworks = 0;
  private fireworkT = 0;
  /** Poke ripples on the felt. */
  readonly ripples: { x: number; y: number; t: number }[] = [];
  /** Tired / dizzy cue ball skid marks. */
  skid = 0;
  hungerWobble = 0;
  /** The stick pull when the shot was released (used by the strike lunge). */
  releasePull = 0;
  /** The bottom of the screen as a world direction; set from the camera every frame. */
  down = { x: 0, y: 1 };
  /** Seconds left to show the power ring / English marker after the player touched them. */
  dialShow = 0;
  englishShow = 0;

  constructor(readonly rand: () => number) {}

  reset(game: Game): void {
    this.jelly.reset();
    this.jelly.sync(game.table);
    this.particles.clear();
    this.pops.clear();
    this.balls.reset(game.balls, this.rand);
    this.nope.clear();
    this.chomp.clear();
    this.holeR.clear();
    this.bolted.clear();
    this.speedLines = null;
    this.confettiRain = 0;
    this.fireworks = 0;
    this.ripples.length = 0;
    this.vignette = 0;
    this.vignetteTarget = 0;
    this.flash = 0;
  }

  update(dtReal: number, game: Game, look: { x: number; y: number } | null): void {
    const dt = dtReal * game.timeScale;
    this.time += dt;
    this.jelly.sync(game.table);
    this.jelly.update(dt);
    this.particles.down = this.down;
    this.particles.update(dt);
    this.pops.update(dt);
    this.balls.update(dt, game.balls, this.rand, look);
    this.flash = Math.max(0, this.flash - dtReal * 5);
    this.dialShow = Math.max(0, this.dialShow - dtReal);
    this.englishShow = Math.max(0, this.englishShow - dtReal);
    this.vignette = damp(this.vignette, this.vignetteTarget, 6, dtReal);
    for (const [k, v] of this.nope) {
      if (v - dtReal <= 0) this.nope.delete(k);
      else this.nope.set(k, v - dtReal);
    }
    for (const [k, v] of this.bolted) {
      if (v > 2) this.bolted.delete(k);
      else this.bolted.set(k, v + dtReal);
    }
    for (const [k, v] of this.chomp) {
      if (v - dt <= 0) this.chomp.delete(k);
      else this.chomp.set(k, v - dt);
    }
    for (const p of game.geom.pockets) {
      const cur = this.holeR.get(p.vid) ?? p.r;
      // Springy growth: overshoot a little when the pockets get hungrier.
      this.holeR.set(p.vid, damp(cur, p.r, 9, dt));
    }
    for (let i = 0; i < this.pegFlick.length; i++) this.pegFlick[i] = Math.max(0, this.pegFlick[i]! - dt * 5);
    if (this.speedLines) {
      this.speedLines.t += dt;
      if (this.speedLines.t > 0.3) this.speedLines = null;
    }
    for (const r of this.ripples) r.t += dt;
    while (this.ripples.length && this.ripples[0]!.t > 0.7) this.ripples.shift();
    this.hungerWobble += dt * (2 + game.hunger * 4);

    // Game-over party: confetti rains from the top edge of the screen.
    if (this.confettiRain > 0) {
      this.confettiRain -= dtReal;
      const n = Math.random() < 0.9 ? 3 : 1;
      const d = this.down;
      // Screen-right in world axes, and the view's half extents along each screen axis.
      const rx = d.y;
      const ry = -d.x;
      const halfW = (d.y !== 0 ? TABLE_W : TABLE_H) / 2 + VIEW_MARGIN;
      const halfH = (d.y !== 0 ? TABLE_H : TABLE_W) / 2 + VIEW_MARGIN;
      for (let i = 0; i < n; i++) {
        const across = (this.rand() - 0.5) * 2 * halfW;
        const side = (this.rand() - 0.5) * 60;
        const fall = 80 + this.rand() * 120;
        this.particles.spawn({
          kind: 'confetti',
          x: TABLE_W / 2 + rx * across - d.x * (halfH + 50),
          y: TABLE_H / 2 + ry * across - d.y * (halfH + 50),
          vx: rx * side + d.x * fall,
          vy: ry * side + d.y * fall,
          size: 8 + this.rand() * 7,
          rot: this.rand() * 6,
          vr: (this.rand() - 0.5) * 14,
          life: 4,
          drag: 0.6,
          g: 90,
          color: ['#ff4d6d', '#ffd23f', '#3a86ff', '#06d6a0', '#8e44ec', '#ff8a1f'][
            Math.floor(this.rand() * 6)
          ]!,
        });
      }
    }
    if (this.fireworks > 0) {
      this.fireworks -= dtReal;
      this.fireworkT -= dtReal;
      if (this.fireworkT <= 0) {
        this.fireworkT = 0.35 + this.rand() * 0.4;
        this.particles.burst(80 + this.rand() * 840, 20 + this.rand() * 300, this.rand);
      }
    }
  }
}
