import { clamp, clamp01 } from '../core/vec';
import type { ShotQ } from '../physics/launch';

export type { ShotQ } from '../physics/launch';

/** Lattice scale for shot directions: int16 components. */
export const DIR_SCALE = 32767;

/**
 * The one place a shot touches trig. Everything downstream (the launch, replays, shared links)
 * works from the integers, so a shot plays out the same in every browser.
 */
export function quantizeShot(aim: number, power: number, ex = 0, ey = 0): ShotQ {
  return {
    dx: Math.round(Math.cos(aim) * DIR_SCALE),
    dy: Math.round(Math.sin(aim) * DIR_SCALE),
    p: Math.round(clamp01(power) * 1000),
    ex: Math.round(clamp(ex, -1, 1) * 100),
    ey: Math.round(clamp(ey, -1, 1) * 100),
  };
}
