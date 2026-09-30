import { R } from '../config';
import { damp } from '../core/easing';
import { TAU } from '../core/vec';
import type { Ball } from '../physics/world';

export type Mood = 'normal' | 'squint' | 'shock' | 'dizzy' | 'happy' | 'squeeze' | 'worried';

export interface Sink {
  t: number;
  dur: number;
  x0: number;
  y0: number;
  hx: number;
  hy: number;
  /** Hole radius (the sinking ball is clipped to it). */
  hr: number;
  /** Spiral direction (+1 / -1) picked from the ball's incoming velocity. */
  dir: number;
}

export interface BallFx {
  /** Unit "pole" vector of the ball's decal: x/y in the table plane, h toward the viewer. */
  px: number;
  py: number;
  ph: number;
  /** A second body axis, perpendicular to the pole (for polka dots). */
  qx: number;
  qy: number;
  qh: number;
  sqNx: number;
  sqNy: number;
  sqAmt: number;
  sqT: number;
  sink: Sink | null;
  sunk: boolean;
  /** Cue ball eyes. */
  lookX: number;
  lookY: number;
  blink: number;
  nextBlink: number;
  mood: Mood;
  moodT: number;
  /** Cue ball: how far sidespin has twirled its face, radians (springs back when it stops). */
  yaw: number;
  idleLookT: number;
  idleX: number;
  idleY: number;
}

function fresh(rand: () => number): BallFx {
  // Random resting orientation with the number facing up-ish so it reads at rest.
  const a = rand() * Math.PI * 2;
  const tilt = rand() * 0.9;
  const px = Math.cos(a) * Math.sin(tilt);
  const py = Math.sin(a) * Math.sin(tilt);
  const ph = Math.cos(tilt);
  // q = normalize(p x z-ish helper) gives an axis perpendicular to p.
  let qx = -py;
  let qy = px;
  let qh = 0;
  const ql = Math.hypot(qx, qy);
  if (ql < 1e-6) {
    qx = 1;
    qy = 0;
  } else {
    qx /= ql;
    qy /= ql;
  }
  const spin = rand() * Math.PI * 2;
  // Rotate q about p by a random amount so polka dots do not all line up.
  const rx = py * qh - ph * qy;
  const ry = ph * qx - px * qh;
  const rh = px * qy - py * qx;
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  qx = qx * c + rx * s;
  qy = qy * c + ry * s;
  qh = qh * c + rh * s;
  return {
    px,
    py,
    ph,
    qx,
    qy,
    qh,
    sqNx: 1,
    sqNy: 0,
    sqAmt: 0,
    sqT: 10,
    sink: null,
    sunk: false,
    lookX: 0,
    lookY: 0,
    blink: 0,
    nextBlink: 1 + rand() * 3,
    mood: 'normal',
    moodT: 0,
    idleLookT: 0,
    idleX: 0,
    idleY: 0,
    yaw: 0,
  };
}

export class BallFxStore {
  private map = new Map<number, BallFx>();

  get(id: number): BallFx {
    let f = this.map.get(id);
    if (!f) {
      f = fresh(Math.random);
      this.map.set(id, f);
    }
    return f;
  }

  reset(balls: readonly Ball[], rand: () => number): void {
    this.map.clear();
    for (const b of balls) this.map.set(b.id, fresh(rand));
  }

  /** Squash along (nx, ny): amount ~0..0.4. Stronger hits override weaker ongoing ones. */
  squash(id: number, nx: number, ny: number, amount: number): void {
    const f = this.get(id);
    const current = f.sqAmt * Math.exp(-7 * f.sqT);
    if (amount < current) return;
    f.sqNx = nx;
    f.sqNy = ny;
    f.sqAmt = amount;
    f.sqT = 0;
  }

  /** Current squash scale along the normal (area is preserved across it). */
  squashScale(f: BallFx): number {
    if (f.sqT > 1.2) return 1;
    return 1 - f.sqAmt * Math.exp(-7 * f.sqT) * Math.cos(24 * f.sqT);
  }

  sink(b: Ball, hx: number, hy: number, hr: number, vx: number, vy: number): void {
    const f = this.get(b.id);
    const cross = (hx - b.x) * vy - (hy - b.y) * vx;
    f.sink = { t: 0, dur: 0.45, x0: b.x, y0: b.y, hx, hy, hr, dir: cross >= 0 ? 1 : -1 };
    f.sunk = false;
  }

  unsink(id: number): void {
    const f = this.get(id);
    f.sink = null;
    f.sunk = false;
  }

  setMood(id: number, mood: Mood, dur: number): void {
    const f = this.get(id);
    f.mood = mood;
    f.moodT = dur;
  }

  /**
   * Rolls decals by each ball's velocity, decays squash, animates sinking balls, and runs the
   * cue ball's eyes. `look` gives the point the cue ball wants to look at (or null to idle).
   */
  update(
    dt: number,
    balls: readonly Ball[],
    rand: () => number,
    look: { x: number; y: number } | null,
  ): void {
    for (const b of balls) {
      const f = this.get(b.id);
      f.sqT += dt;
      if (f.sink) {
        f.sink.t += dt;
        if (f.sink.t >= f.sink.dur) {
          f.sink = null;
          f.sunk = true;
        }
      }
      if (b.active) {
        f.sunk = false;
        // Decals follow the ball's spin, not its travel: v - slip (the same thing without English).
        const wx = b.vx - b.sx;
        const wy = b.vy - b.sy;
        const s = Math.hypot(wx, wy);
        if (s > 1e-3) roll(f, wx / s, wy / s, (s * dt) / R);
        if (b.wz !== 0) f.yaw += (b.wz / R) * dt * 0.25;
        else f.yaw = damp(f.yaw, Math.round(f.yaw / TAU) * TAU, 6, dt);
      }
      if (b.kind === 'cue') this.updateEyes(f, b, dt, rand, look);
    }
  }

  private updateEyes(
    f: BallFx,
    b: Ball,
    dt: number,
    rand: () => number,
    look: { x: number; y: number } | null,
  ): void {
    if (f.moodT > 0) {
      f.moodT -= dt;
      if (f.moodT <= 0) f.mood = 'normal';
    }
    // Blinking.
    f.nextBlink -= dt;
    if (f.nextBlink <= 0) {
      f.blink = 1;
      f.nextBlink = 1.8 + rand() * 3.5;
    }
    f.blink = Math.max(0, f.blink - dt * 7);
    // Where to look.
    let tx = 0;
    let ty = 0;
    const s = Math.hypot(b.vx, b.vy);
    if (s > 40) {
      tx = b.vx / s;
      ty = b.vy / s;
    } else if (look) {
      const dx = look.x - b.x;
      const dy = look.y - b.y;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        const k = Math.min(1, l / 120);
        tx = (dx / l) * k;
        ty = (dy / l) * k;
      }
    } else {
      f.idleLookT -= dt;
      if (f.idleLookT <= 0) {
        f.idleLookT = 0.6 + rand() * 1.6;
        const a = rand() * Math.PI * 2;
        const m = rand() * 0.9;
        f.idleX = Math.cos(a) * m;
        f.idleY = Math.sin(a) * m;
      }
      tx = f.idleX;
      ty = f.idleY;
    }
    f.lookX = damp(f.lookX, tx, 14, dt);
    f.lookY = damp(f.lookY, ty, 14, dt);
  }
}

/**
 * Rotate a body vector (x, y in the table plane, h toward the viewer) as if the ball rolled
 * `angle` radians along unit direction (ux, uy): the top of the ball moves forward.
 */
export function rollVec(x: number, y: number, h: number, ux: number, uy: number, angle: number) {
  const a = x * ux + y * uy;
  const wx = x - a * ux;
  const wy = y - a * uy;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a2 = a * c + h * s;
  const h2 = h * c - a * s;
  const nx = wx + a2 * ux;
  const ny = wy + a2 * uy;
  const l = Math.hypot(nx, ny, h2) || 1;
  return { x: nx / l, y: ny / l, h: h2 / l };
}

function roll(f: BallFx, ux: number, uy: number, angle: number): void {
  const p = rollVec(f.px, f.py, f.ph, ux, uy, angle);
  const q = rollVec(f.qx, f.qy, f.qh, ux, uy, angle);
  f.px = p.x;
  f.py = p.y;
  f.ph = p.h;
  f.qx = q.x;
  f.qy = q.y;
  f.qh = q.h;
}
