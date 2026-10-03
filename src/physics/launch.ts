import { V_SHOT_MAX, V_SHOT_MIN } from '../config';
import { hyp } from '../core/vec';
import { clearSpin, type Ball } from './ball';
import { launchSpin } from './spin';

/**
 * A shot, quantized to integers so it can be recorded, shared and replayed bit-for-bit anywhere:
 * the direction as a 16-bit lattice vector, power in thousandths, English in hundredths.
 */
export interface ShotQ {
  dx: number;
  dy: number;
  /** Power 0..1000. */
  p: number;
  /** English: + is right of the aim line. -100..100. */
  ex: number;
  /** English: + is draw (below centre), - is follow. -100..100. */
  ey: number;
}

/** Cue speed for power 0..1: p^1.25 written as p * sqrt(sqrt(p)), which rounds the same everywhere. */
export function launchSpeed(p: number): number {
  return V_SHOT_MIN + (V_SHOT_MAX - V_SHOT_MIN) * p * Math.sqrt(Math.sqrt(p));
}

/** Sets the cue ball moving (and spinning) for a quantized shot. */
export function launchFrom(cue: Ball, q: ShotQ): { dx: number; dy: number; speed: number } {
  const l = hyp(q.dx, q.dy) || 1;
  const dx = q.dx / l;
  const dy = q.dy / l;
  const speed = launchSpeed(q.p / 1000);
  clearSpin(cue);
  cue.vx = dx * speed;
  cue.vy = dy * speed;
  if (q.ex !== 0 || q.ey !== 0) launchSpin(cue, dx, dy, speed, q.ex, q.ey);
  return { dx, dy, speed };
}
