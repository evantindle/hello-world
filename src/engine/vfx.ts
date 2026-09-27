// Transient effects triggered by physics events: flashes, flare rings, shockwave ripples,
// screen flash, plus a continuous gravitational-wave pattern for inspiralling binaries.

import type { RGB, V3 } from '../core/math.ts';
import { project } from '../core/math.ts';
import type { SpriteInstance } from '../render/bodies.ts';
import type { Ripple } from '../render/post.ts';
import type { View } from '../render/view.ts';

interface Flash {
  pos: () => V3;
  color: RGB;
  radius: number;
  grow: number;
  intensity: number;
  t0: number;
  dur: number;
  style: number;
}

interface Shock {
  pos: V3;
  t0: number;
  /** Expansion speed in 1080p pixels per second. */
  speed: number;
  amp: number;
  width: number;
  dur: number;
}

export interface GravWave {
  pos: V3;
  /** Orbital phase (radians). */
  phase: number;
  /** Wavelength in world units. */
  wavelength: number;
  /** Displacement amplitude in 1080p pixels. */
  amp: number;
  /** Radius (world) where the pattern is strongest. */
  extent: number;
}

export class Vfx {
  flashes: Flash[] = [];
  shocks: Shock[] = [];
  screenFlash = 0;
  screenFlashColor: RGB = [1, 1, 1];
  gw: GravWave | null = null;

  reset() {
    this.flashes = [];
    this.shocks = [];
    this.screenFlash = 0;
    this.gw = null;
  }

  flash(clock: number, pos: V3 | (() => V3), color: RGB, radius: number, intensity: number, dur = 1.2, grow = 3, style = 1) {
    const p = typeof pos === 'function' ? pos : () => pos;
    this.flashes.push({ pos: p, color, radius, grow, intensity, t0: clock, dur, style });
  }

  shock(clock: number, pos: V3, amp = 18, speed = 900, dur = 2.2, width = 26) {
    this.shocks.push({ pos: [...pos] as V3, t0: clock, speed, amp, width, dur });
  }

  pulseScreen(amount: number, color: RGB = [1, 0.95, 0.9]) {
    this.screenFlash = Math.max(this.screenFlash, amount);
    this.screenFlashColor = color;
  }

  update(clock: number, dt: number) {
    this.flashes = this.flashes.filter((f) => clock < f.t0 + f.dur);
    this.shocks = this.shocks.filter((s) => clock < s.t0 + s.dur);
    this.screenFlash *= Math.exp(-dt * 3.5);
  }

  sprites(clock: number, out: SpriteInstance[]) {
    for (const f of this.flashes) {
      const t = (clock - f.t0) / f.dur;
      const env = Math.pow(1 - t, 2.2) * Math.min(1, t * 25 + 0.05);
      out.push({
        pos: f.pos(),
        radius: f.radius * (1 + f.grow * Math.pow(t, 0.5)),
        color: f.color,
        intensity: f.intensity * env,
        spikes: 0,
        style: f.style,
        seed: 0,
        angle: 0,
      });
    }
  }

  ripples(clock: number, v: View): Ripple[] {
    const out: Ripple[] = [];
    const k = v.pxScale;
    for (const s of this.shocks) {
      const p = project(v.viewProj, s.pos);
      if (p.w <= 0) continue;
      const t = clock - s.t0;
      const life = t / s.dur;
      out.push({
        x: (p.x * 0.5 + 0.5) * v.w,
        y: (p.y * 0.5 + 0.5) * v.h,
        radius: s.speed * k * t,
        amp: s.amp * k * Math.pow(1 - life, 1.5),
        width: s.width * k * (1 + t * 0.8),
        type: 0,
        phase: 0,
        wavelength: 1,
      });
    }
    if (this.gw && this.gw.amp > 0.01) {
      const g = this.gw;
      const p = project(v.viewProj, g.pos);
      if (p.w > 0) {
        const pxPerWorld = v.focalPx / p.w;
        out.push({
          x: (p.x * 0.5 + 0.5) * v.w,
          y: (p.y * 0.5 + 0.5) * v.h,
          radius: g.extent * pxPerWorld,
          amp: g.amp * k,
          width: 0,
          type: 1,
          phase: 2 * g.phase,
          wavelength: Math.max(8, g.wavelength * pxPerWorld),
        });
      }
    }
    return out;
  }
}
