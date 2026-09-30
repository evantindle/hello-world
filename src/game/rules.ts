import { BALL_COLORS, COLORS, CUE_START, PAR, R, RACK_APEX } from '../config';
import type { Rng } from '../core/rng';
import { hyp } from '../core/vec';
import { centroid, distToSegment, pointInPolygon } from '../geom/polygon';
import type { TableGeom } from '../geom/table';
import type { Ball } from '../physics/world';

/** Cue ball plus ten object balls in a 1-2-3-4 triangle pointing at the cue. */
export function rackBalls(rng: Rng): Ball[] {
  const balls: Ball[] = [
    {
      id: 0,
      kind: 'cue',
      num: 0,
      color: COLORS.cue,
      stripe: false,
      x: CUE_START.x,
      y: CUE_START.y,
      vx: 0,
      vy: 0,
      active: true,
    },
  ];
  const nums = rng.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  nums.unshift(1);
  const pitch = 2 * R + 0.6;
  const dx = pitch * Math.cos(Math.PI / 6);
  let k = 0;
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) {
      const num = nums[k++]!;
      balls.push({
        id: num,
        kind: 'object',
        num,
        color: BALL_COLORS[num - 1]!,
        stripe: num >= 9,
        x: RACK_APEX.x + row * dx,
        y: RACK_APEX.y + (j - row / 2) * pitch,
        vx: 0,
        vy: 0,
        active: true,
      });
    }
  }
  return balls;
}

/**
 * A legal spot for the cue ball after a scratch: best of N samples by clearance from rails,
 * balls and holes. Never fails (falls back to the best sample, then the centroid).
 */
export function findRespawnSpot(rng: Rng, geom: TableGeom, balls: readonly Ball[], selfId: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of geom.poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let best = centroid(geom.poly);
  let bestScore = -Infinity;
  for (let i = 0; i < 96; i++) {
    const x = rng.range(minX, maxX);
    const y = rng.range(minY, maxY);
    if (!pointInPolygon(x, y, geom.poly)) continue;
    const score = clearance(x, y, geom, balls, selfId);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

export function clearance(
  x: number,
  y: number,
  geom: TableGeom,
  balls: readonly Ball[],
  selfId: number,
): number {
  let score = Infinity;
  for (const r of geom.rails) score = Math.min(score, distToSegment(x, y, r.ax, r.ay, r.bx, r.by) - R);
  for (const b of balls) {
    if (!b.active || b.id === selfId) continue;
    score = Math.min(score, hyp(b.x - x, b.y - y) - 2 * R);
  }
  for (const p of geom.pockets) {
    if (!p.open) continue;
    score = Math.min(score, hyp(p.x - x, p.y - y) - p.sr - R);
  }
  // Prefer spots that are not hugging a hole even if the table is crowded.
  for (const p of geom.pockets) score = Math.min(score, hyp(p.x - x, p.y - y) - p.r);
  return score;
}

export interface Rank {
  title: string;
  blurb: string;
}

export function rankFor(score: number, par = PAR): Rank {
  const d = score - par;
  if (d <= -6) return { title: 'UNBENDLIEVABLE', blurb: 'The table bends to your will. Literally.' };
  if (d <= -3) return { title: 'TABLE WIZARD', blurb: 'You speak fluent felt.' };
  if (d <= 0) return { title: 'FELT WHISPERER', blurb: 'Under par. The pockets respect you.' };
  if (d <= 4) return { title: 'CERTIFIED BENDER', blurb: 'Solid work. Bendy, even.' };
  if (d <= 10) return { title: 'ENTHUSIASTIC AMATEUR', blurb: 'The balls went in eventually!' };
  return { title: 'MENACE TO BILLIARDS', blurb: 'The table has filed a complaint.' };
}

const BEST_KEY = 'bendy-billiards.best';

export function loadBest(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveBest(score: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage blocked (private mode, sandboxed iframe): best score just won't persist.
  }
}
