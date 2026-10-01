import { R } from '../config';
import { hyp } from '../core/vec';
import { THICK } from '../geom/parts';
import { closestOnSegment, distToSegment, pointInPolygon } from '../geom/polygon';
import type { InvalidReason, TableGeom } from '../geom/table';

/** Why an edit (a bend, a toy move, a placement) stopped where it did. */
export type BlockReason =
  | InvalidReason
  | 'crushed'
  | 'keep-out'
  | 'squeezed-out'
  | 'budget'
  | 'pocket'
  | 'bolted'
  | 'steel'
  /** A bend ran into a toy. */
  | 'part-in-the-way'
  /** A toy would leave the table, sit on a pocket, or overlap another toy. */
  | 'off-table'
  | 'on-pocket'
  | 'overlap'
  /** Out of grab tokens, or beyond a grab's reach. */
  | 'tokens'
  | 'reach'
  /** A toy the level fixed in place. */
  | 'locked';

export interface Pos {
  x: number;
  y: number;
}

/**
 * Position-only settle of balls against new geometry. Walls shove balls, balls shove balls.
 * Fails (and the caller rejects the step) if a ball would be crushed, squeezed out of the
 * table, or pushed inside an open hole's suction radius (or onto a pull, black hole or portal).
 */
export function settlePositions(
  pos: Pos[],
  geom: TableGeom,
  prev: readonly Pos[],
  prevGeom: TableGeom,
): { ok: boolean; reason?: BlockReason } {
  const rails = geom.rails;
  const n = pos.length;
  const min = 2 * R;
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (const p of pos) {
      for (const r of rails) {
        const q = closestOnSegment(p.x, p.y, r.ax, r.ay, r.bx, r.by);
        const ox = p.x - q.x;
        const oy = p.y - q.y;
        const d = hyp(ox, oy);
        if (d >= R - 1e-6) continue;
        // Radial push, except when the centre is behind the rail within its span (it slipped
        // through): then push straight back along the inward normal.
        let nx = r.nx;
        let ny = r.ny;
        const behindSpan = ox * r.nx + oy * r.ny < 0 && q.t > 0 && q.t < 1;
        if (d > 1e-6 && !behindSpan) {
          nx = ox / d;
          ny = oy / d;
        }
        p.x = q.x + nx * R;
        p.y = q.y + ny * R;
        moved = true;
      }
      // Toys shove too: two-sided walls and round bumpers.
      for (const w of geom.walls) {
        const q = closestOnSegment(p.x, p.y, w.ax, w.ay, w.bx, w.by);
        const ox = p.x - q.x;
        const oy = p.y - q.y;
        const d = hyp(ox, oy);
        const min = R + THICK;
        if (d >= min - 1e-6) continue;
        let nx = w.nx;
        let ny = w.ny;
        if (d > 1e-6) {
          nx = ox / d;
          ny = oy / d;
        } else if ((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        p.x = q.x + nx * min;
        p.y = q.y + ny * min;
        moved = true;
      }
      for (const bp of geom.bumpers) {
        const ox = p.x - bp.x;
        const oy = p.y - bp.y;
        const d = hyp(ox, oy);
        const min = bp.r + R;
        if (d >= min - 1e-6) continue;
        p.x = bp.x + (d > 1e-6 ? ox / d : 1) * min;
        p.y = bp.y + (d > 1e-6 ? oy / d : 0) * min;
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const a = pos[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = pos[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = hyp(dx, dy);
        if (d >= min - 1e-6) continue;
        const nx = d > 1e-9 ? dx / d : 1;
        const ny = d > 1e-9 ? dy / d : 0;
        const half = (min - d) / 2 + 1e-4;
        a.x -= nx * half;
        a.y -= ny * half;
        b.x += nx * half;
        b.y += ny * half;
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const p of pos) if (!pointInPolygon(p.x, p.y, geom.poly)) return { ok: false, reason: 'squeezed-out' };
  for (const p of pos) {
    for (const r of rails) {
      if (distToSegment(p.x, p.y, r.ax, r.ay, r.bx, r.by) < R - 0.5) return { ok: false, reason: 'crushed' };
    }
    for (const w of geom.walls) {
      if (distToSegment(p.x, p.y, w.ax, w.ay, w.bx, w.by) < R + THICK - 0.5)
        return { ok: false, reason: 'crushed' };
    }
    for (const bp of geom.bumpers) {
      if (hyp(p.x - bp.x, p.y - bp.y) < bp.r + R - 0.5) return { ok: false, reason: 'crushed' };
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hyp(pos[j]!.x - pos[i]!.x, pos[j]!.y - pos[i]!.y) < min - 0.5)
        return { ok: false, reason: 'crushed' };
    }
  }
  for (const pk of geom.pockets) {
    if (!pk.open) continue;
    const before = prevGeom.pockets.find((q) => q.vid === pk.vid);
    for (let i = 0; i < n; i++) {
      const da = hyp(pos[i]!.x - pk.x, pos[i]!.y - pk.y);
      if (da >= pk.sr) continue;
      const db = before && before.open ? hyp(prev[i]!.x - before.x, prev[i]!.y - before.y) : Infinity;
      if (da < db - 0.01) return { ok: false, reason: 'keep-out' };
    }
  }
  // Toys that would move a ball the moment the shot starts (pulls, black holes, portals) may not
  // be brought onto a ball, nor a ball onto them: no free shots.
  for (const f of geom.fields) {
    const before = prevGeom.fields.find((q) => q.src === f.src);
    if (keptOut(pos, prev, f.x, f.y, before, f.kind === 'blackhole' ? f.r + R : f.r))
      return { ok: false, reason: 'keep-out' };
  }
  for (const e of geom.portals) {
    const before = prevGeom.portals.find((q) => q.src === e.src);
    if (keptOut(pos, prev, e.x, e.y, before, e.r + R)) return { ok: false, reason: 'keep-out' };
  }
  return { ok: true };
}

/** A ball inside radius r of (x, y) that got closer than it was (to `before`, the same toy). */
function keptOut(
  pos: readonly Pos[],
  prev: readonly Pos[],
  x: number,
  y: number,
  before: { x: number; y: number } | undefined,
  r: number,
): boolean {
  for (let i = 0; i < pos.length; i++) {
    const da = hyp(pos[i]!.x - x, pos[i]!.y - y);
    if (da >= r) continue;
    const db = before ? hyp(prev[i]!.x - before.x, prev[i]!.y - before.y) : Infinity;
    if (da < db - 0.01) return true;
  }
  return false;
}
