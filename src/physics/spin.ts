import {
  A_ROLL,
  A_SLIDE,
  CUE_BRAKE,
  K_C,
  K_DRAG,
  K_ROLL,
  K_SIDE,
  K_THROW,
  MU_C,
  SLIP_EPS,
  SPIN_RANGE,
  WZ_DECAY,
  WZ_RAIL_KEEP,
} from '../config';
import { hyp } from '../core/vec';
import type { Ball } from './ball';

/**
 * English, cartoon-physics edition. The cue ball tracks its slip s = v - w: the velocity of the
 * cloth contact point, where w is the velocity the ball's spin alone would roll it at. A ball
 * with no English has zero slip and behaves exactly like the original game.
 *
 *  - Side English starts the ball with sideways slip. Cloth friction trades it into sideways
 *    velocity (dv = -a s^ dt, ds = -(7/2) a s^ dt for a solid sphere), which bends the path: the
 *    final heading is v0 - (2/7) s0, so K_C caps the bend at 25 degrees whatever the power.
 *  - Draw and follow are banked until the first ball contact (they fade with distance), then
 *    released into the slip along the pre-contact heading: after a full hit, draw pulls the ball
 *    back and follow drives it on.
 *  - Sidespin (wz, + clockwise on screen) throws the ball along a cushion when it bounces.
 */

/** Sets the spin state for a shot. ex: + is right of the aim line; ey: + is draw. */
export function launchSpin(cue: Ball, dx: number, dy: number, speed: number, exq: number, eyq: number): void {
  let ex = exq / 100;
  let ey = eyq / 100;
  const m = hyp(ex, ey);
  if (m > 1) {
    ex /= m;
    ey /= m;
  }
  cue.eng = m > 1 ? 1 : m;
  // Right of the heading on a y-down screen.
  const rx = -dy;
  const ry = dx;
  cue.sx = -ex * K_C * speed * rx;
  cue.sy = -ex * K_C * speed * ry;
  cue.bank = ey * K_ROLL * speed;
  cue.wz = -ex * K_SIDE * speed;
}

export function hasSpin(b: Ball): boolean {
  return b.sx !== 0 || b.sy !== 0 || b.bank !== 0 || b.wz !== 0;
}

/** First real contact with a ball: the banked draw/follow goes into the slip. */
export function releaseBank(cue: Ball, vxPre: number, vyPre: number): void {
  if (cue.bank === 0) return;
  const v = hyp(vxPre, vyPre);
  if (v > 1e-9) {
    cue.sx += (cue.bank * vxPre) / v;
    cue.sy += (cue.bank * vyPre) / v;
  }
  cue.bank = 0;
}

/**
 * Cushion contact (normal n into the table, approach speed vn < 0, restitution e): the slip's
 * normal part bounces, and sidespin throws the ball along the cushion.
 */
export function cushionSpin(b: Ball, nx: number, ny: number, vn: number, e: number): number {
  const sn = b.sx * nx + b.sy * ny;
  if (sn < 0) {
    b.sx -= (1 + e) * sn * nx;
    b.sy -= (1 + e) * sn * ny;
  }
  if (b.wz !== 0) {
    const cap = MU_C * (1 + e) * -vn;
    let dvt = K_THROW * b.wz;
    if (dvt > cap) dvt = cap;
    else if (dvt < -cap) dvt = -cap;
    // Tangent (-ny, nx): clockwise spin kicks the ball this way off the cushion.
    b.vx += -ny * dvt;
    b.vy += nx * dvt;
    b.wz *= WZ_RAIL_KEEP;
    return dvt;
  }
  return 0;
}

/**
 * Friction for a spinning cue ball over one substep, scaled by the felt under it (mr: rolling and
 * sliding friction, md: drag). Returns true if the ball should be exempt from the rest snap this
 * substep (it is still skidding).
 */
export function spinFriction(b: Ball, h: number, mr: number, md: number): boolean {
  const s = hyp(b.sx, b.sy);
  if (s > SLIP_EPS) {
    // Skidding: only cloth friction on the slip acts.
    const d = Math.min(s, 3.5 * A_SLIDE * mr * h);
    const ux = b.sx / s;
    const uy = b.sy / s;
    b.vx -= (ux * d) / 3.5;
    b.vy -= (uy * d) / 3.5;
    b.sx -= ux * d;
    b.sy -= uy * d;
    if (d >= s) {
      b.sx = 0;
      b.sy = 0;
    }
    decay(b, h);
    return true;
  }
  b.sx = 0;
  b.sy = 0;
  // Rolling: the original friction, with the dizzy brake fading out as English goes up (a shot
  // with English is meant to move the cue ball after contact).
  const sp = hyp(b.vx, b.vy);
  if (sp > 0) {
    const e1 = (1 - b.eng) * (1 - b.eng);
    const k = b.braking ? 1 + (CUE_BRAKE - 1) * e1 * e1 : 1;
    const sp2 = Math.max(0, sp - A_ROLL * k * mr * h) * (1 - K_DRAG * k * md * h);
    const f = sp2 / sp;
    b.vx *= f;
    b.vy *= f;
  }
  decay(b, h);
  return false;
}

function decay(b: Ball, h: number): void {
  if (b.bank !== 0) {
    const f = 1 - (hyp(b.vx, b.vy) * h) / SPIN_RANGE;
    b.bank = f > 0 ? b.bank * f : 0;
  }
  if (b.wz !== 0) b.wz *= 1 - WZ_DECAY * h;
}

export function clearSpinState(b: Ball): void {
  b.sx = 0;
  b.sy = 0;
  b.bank = 0;
  b.wz = 0;
}
