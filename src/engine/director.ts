// Pacing: converts real seconds into simulation time. Close encounters automatically drop into
// slow motion (bounded on-screen speed), events add scripted "bullet-time" dips.

import { smoothstep } from '../core/math.ts';
import type { DirectorConfig } from '../scenes/types.ts';

export const DEFAULT_DIRECTOR: DirectorConfig = {
  baseRate: 1,
  maxScreenSpeed: 0.9,
  minRate: 0.04,
  rampUp: 0.9,
  rampDown: 0.12,
  startHold: 1.2,
  easeIn: 1.4,
  ejectFollow: 3,
  outro: 5,
};

interface Dip {
  t0: number;
  depth: number;
  attack: number;
  hold: number;
  release: number;
}

export class Director {
  cfg: DirectorConfig;
  rate = 0;
  private dips: Dip[] = [];
  /** Manual speed multiplier (UI). */
  userSpeed = 1;
  /** Clip time the resolution event happened (null until then). */
  resolvedAt: number | null = null;

  constructor(cfg: DirectorConfig) {
    this.cfg = cfg;
  }

  /** Dip into slow motion: depth = speed fraction at the bottom. */
  slowmo(clock: number, depth = 0.15, hold = 0.8, attack = 0.15, release = 1.6) {
    this.dips.push({ t0: clock, depth, attack, hold, release });
  }

  private dipFactor(clock: number): number {
    let f = 1;
    this.dips = this.dips.filter((d) => clock < d.t0 + d.attack + d.hold + d.release);
    for (const d of this.dips) {
      const t = clock - d.t0;
      let e: number;
      if (t < d.attack) e = smoothstep(0, d.attack, t);
      else if (t < d.attack + d.hold) e = 1;
      else e = 1 - smoothstep(0, d.release, t - d.attack - d.hold);
      f *= 1 - (1 - d.depth) * e;
    }
    return f;
  }

  /**
   * @param clock clip time (s)
   * @param speedMetric max body speed / framing radius (1 / sim time)
   * @returns sim time to advance this frame
   */
  update(dt: number, clock: number, speedMetric: number): number {
    const c = this.cfg;
    let target = c.baseRate;
    if (speedMetric > 0 && c.maxScreenSpeed > 0) {
      const rMax = c.maxScreenSpeed / speedMetric;
      target = 1 / Math.sqrt(1 / (target * target) + 1 / (rMax * rMax));
    }
    target = Math.max(target, c.baseRate * c.minRate);
    target *= this.dipFactor(clock);
    target *= smoothstep(c.startHold, c.startHold + c.easeIn, clock);
    const tau = target < this.rate ? c.rampDown : c.rampUp;
    this.rate += (target - this.rate) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)));
    // Dips must bite immediately even when ramping down slowly.
    return this.rate * dt * this.userSpeed;
  }
}
