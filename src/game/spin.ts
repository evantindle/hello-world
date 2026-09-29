import { SPIN_TIME } from '../config';
import { quartOut } from '../core/easing';
import { TAU } from '../core/vec';

/** Pegs around the cue ball that the stick ticks past, roulette style. */
export const PEGS = 16;
const PEG = TAU / PEGS;
/** Radians the stick overshoots the target before springing back. */
const OVERSHOOT = 0.22;
const ANTICIPATION = 0.012; // fraction of the total spin wound backwards first
const U_WIND = 0.08;
const U_LAND = 0.8;

/**
 * The cue's roulette spin: a little wind-up, a whip, a long deceleration, an overshoot and an
 * elastic settle that lands exactly on the target angle.
 */
export class Spin {
  from = 0;
  to = 0;
  total = 0;
  t = 0;
  dur = SPIN_TIME;
  done = true;
  angle = 0;
  /** Angular speed, rad/s (for tick pitch and motion blur). */
  speed = 0;
  private lastPeg = 0;

  start(from: number, target: number, turns: number, dur = SPIN_TIME): void {
    let delta = (target - from) % TAU;
    if (delta < 0) delta += TAU;
    this.from = from;
    this.total = delta + turns * TAU;
    this.to = from + this.total;
    this.t = 0;
    this.dur = dur;
    this.done = false;
    this.angle = from;
    this.speed = 0;
    this.lastPeg = Math.floor(from / PEG);
  }

  /** Skip ahead to the landing wobble. */
  fastForward(): void {
    if (!this.done && this.t < this.dur * U_LAND) this.t = this.dur * U_LAND;
  }

  /** Progress in [0, 1]. */
  get progress(): number {
    return this.dur > 0 ? this.t / this.dur : 1;
  }

  /** Advances the spin; returns how many pegs the stick passed this frame. */
  update(dt: number): number {
    if (this.done) return 0;
    const prev = this.angle;
    this.t = Math.min(this.dur, this.t + dt);
    this.angle = this.angleAt(this.t / this.dur);
    if (this.t >= this.dur) {
      this.done = true;
      this.angle = this.to;
    }
    this.speed = Math.abs(this.angle - prev) / Math.max(dt, 1e-6);
    const peg = Math.floor(this.angle / PEG);
    const ticks = Math.abs(peg - this.lastPeg);
    this.lastPeg = peg;
    return ticks;
  }

  angleAt(u: number): number {
    const over = OVERSHOOT / Math.max(this.total, 1e-6);
    let s: number;
    if (u < U_WIND) {
      s = -ANTICIPATION * Math.sin((Math.PI * u) / U_WIND);
    } else if (u < U_LAND) {
      s = quartOut((u - U_WIND) / (U_LAND - U_WIND)) * (1 + over);
    } else {
      const x = (u - U_LAND) / (1 - U_LAND);
      s = 1 + over * Math.exp(-5 * x) * Math.cos(2.5 * Math.PI * x);
    }
    return this.from + this.total * s;
  }
}
