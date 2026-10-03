/**
 * Relative scrubbing for the shot controls. A drag moves a value by how far the finger travels
 * (it never jumps to wherever the finger lands), and the gain rises with speed: a slow, careful
 * drag makes tiny changes, a quick one sweeps the whole range. The drag keeps going anywhere on
 * the screen, so there is room for a long, slow adjustment.
 */

/** Pointer speeds (CSS px per ms): at or below SLOW the gain is at its finest, at FAST its coarsest. */
export const SLOW = 0.08;
export const FAST = 0.9;

/** Value change per px of travel at `speed`, easing from `fine` (slow drags) to `coarse` (flicks). */
export function scrubGain(speed: number, fine: number, coarse: number): number {
  const t = Math.max(0, Math.min(1, (speed - SLOW) / (FAST - SLOW)));
  return fine + (coarse - fine) * t * t * (3 - 2 * t);
}

/** Follows one drag: each move gives the travel since the last one and a smoothed speed. */
export class Scrub {
  /** Smoothed speed (negative until the first move, which counts in full). */
  private speed = -1;

  constructor(
    private x: number,
    private y: number,
    private t: number,
  ) {}

  move(x: number, y: number, t: number): { dx: number; dy: number; speed: number } {
    const dx = x - this.x;
    const dy = y - this.y;
    // Events can arrive bunched up (same timestamp); never divide by less than a few ms.
    const dt = Math.max(4, t - this.t);
    const now = Math.hypot(dx, dy) / dt;
    this.speed = this.speed < 0 ? now : this.speed * 0.5 + now * 0.5;
    this.x = x;
    this.y = y;
    this.t = t;
    return { dx, dy, speed: this.speed };
  }
}

/**
 * Power detents: a gentle notch every NOTCH. The raw scrub position sticks on each notch for
 * NOTCH_W of travel, and the stretch in between is spread so that every value stays reachable.
 */
export const NOTCH = 0.05;
export const NOTCH_W = 0.012;
const HALF = NOTCH / 2;
const FLAT = NOTCH_W / 2;

/** Raw scrub position -> dial value (both 0..1). */
export function notched(raw: number): number {
  const k = Math.round(raw / NOTCH);
  const d = raw - k * NOTCH;
  const a = Math.abs(d);
  if (a <= FLAT) return k * NOTCH;
  return Math.max(0, Math.min(1, k * NOTCH + (Math.sign(d) * ((a - FLAT) * HALF)) / (HALF - FLAT)));
}

/** Dial value -> raw scrub position (the middle of a notch for a value on one). */
export function unnotched(v: number): number {
  const k = Math.round(v / NOTCH);
  const e = v - k * NOTCH;
  if (Math.abs(e) < 1e-9) return k * NOTCH;
  return k * NOTCH + Math.sign(e) * (FLAT + (Math.abs(e) * (HALF - FLAT)) / HALF);
}

/** The raw position sits in a notch. */
export function inNotch(raw: number): boolean {
  return Math.abs(raw - Math.round(raw / NOTCH) * NOTCH) <= FLAT;
}
