import { chomperOpen, type Pocket } from '../geom/table';
import { hyp } from '../core/vec';
import type { Ball } from './ball';

/**
 * Whether pocket p will take ball b at sim time t. The one rule for capture, suction and the
 * escape guard alike: if they disagreed, a ball could be slurped up and spat out forever.
 */
export function accepts(p: Pocket, b: Ball, t: number): boolean {
  if (!p.open) return false;
  const tr = p.trait;
  if (!tr) return true;
  switch (tr.kind) {
    case 'chomper':
      return chomperOpen(tr, t);
    case 'picky':
      // The cue ball has no suit, so a picky pocket never takes it.
      return b.suit === tr.suit;
    case 'gentle':
      return hyp(b.vx, b.vy) <= tr.vmax;
    default:
      return true;
  }
}

/** Whether pocket p pulls ball b in. Only object balls it would take; gentle pockets never pull. */
export function sucks(p: Pocket, b: Ball, t: number): boolean {
  if (b.kind !== 'object' || !p.open) return false;
  const tr = p.trait;
  if (!tr) return true;
  if (tr.kind === 'gentle') return false;
  return accepts(p, b, t);
}

/** Whether a refusal bounces the ball off the hole (picky and gentle pockets spit). */
export function spits(p: Pocket): boolean {
  const k = p.trait?.kind;
  return k === 'picky' || k === 'gentle';
}

/** Bounce a refused ball off the hole's rim: out to the capture radius, radial speed reflected. */
export function spitOut(b: Ball, p: Pocket, r: number): void {
  let ux = b.x - p.x;
  let uy = b.y - p.y;
  const d = hyp(ux, uy);
  if (d > 1e-9) {
    ux /= d;
    uy /= d;
  } else {
    ux = p.inx;
    uy = p.iny;
  }
  b.x = p.x + ux * r;
  b.y = p.y + uy * r;
  const vr = b.vx * ux + b.vy * uy;
  if (vr < 0) {
    b.vx -= 1.5 * vr * ux;
    b.vy -= 1.5 * vr * uy;
  }
}
