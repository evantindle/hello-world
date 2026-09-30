import { PLAY, R, RESHAPE_STEP } from '../config';
import { clamp } from '../core/vec';
import { closestOnSegment, distToSegment, pointInPolygon } from '../geom/polygon';
import {
  buildGeom,
  canSplitEdge,
  cloneTable,
  insertVertex,
  validateTable,
  vertexIndex,
  withoutVertex,
  type InvalidReason,
  type Table,
  type TableGeom,
} from '../geom/table';
import type { Ball } from '../physics/world';

/** Anything the reshaper can edit: the game implements this. */
export interface ReshapeHost {
  table: Table;
  geom: TableGeom;
  balls: Ball[];
  budget: number;
  /** Pocket hunger level (scales hole sizes); see config.ts. */
  hunger: number;
}

export interface Handle {
  kind: 'vertex' | 'edge';
  /** Vertex index, or edge index for midpoint handles. */
  index: number;
  x: number;
  y: number;
  pocket: boolean;
}

export type BlockReason = InvalidReason | 'crushed' | 'keep-out' | 'squeezed-out' | 'budget' | 'pocket';

export interface MoveResult {
  /** Distance the vertex actually travelled (and the budget it cost). */
  applied: number;
  blocked: BlockReason | null;
  /** Balls shoved by the move, with their displacement. */
  pushed: { id: number; dx: number; dy: number }[];
}

interface Pos {
  x: number;
  y: number;
}

export function listHandles(t: Table): Handle[] {
  const out: Handle[] = [];
  const n = t.verts.length;
  t.verts.forEach((v, i) => out.push({ kind: 'vertex', index: i, x: v.x, y: v.y, pocket: v.pocket }));
  for (let i = 0; i < n; i++) {
    if (!canSplitEdge(t, i)) continue;
    const a = t.verts[i]!;
    const b = t.verts[(i + 1) % n]!;
    out.push({ kind: 'edge', index: i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pocket: false });
  }
  return out;
}

/** Nearest handle within `radius`; vertex knobs win ties against midpoint handles. */
export function hitHandle(t: Table, x: number, y: number, radius: number): Handle | null {
  let best: Handle | null = null;
  let bd = Infinity;
  for (const h of listHandles(t)) {
    const d = Math.hypot(h.x - x, h.y - y) * (h.kind === 'edge' ? 1.25 : 1);
    if (d < radius && d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/**
 * Position-only settle of balls against new geometry. Walls shove balls, balls shove balls.
 * Fails (and the caller rejects the step) if a ball would be crushed, squeezed out of the
 * table, or pushed inside an open hole's suction radius.
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
        const d = Math.hypot(ox, oy);
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
    }
    for (let i = 0; i < n; i++) {
      const a = pos[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = pos[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
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
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(pos[j]!.x - pos[i]!.x, pos[j]!.y - pos[i]!.y) < min - 0.5)
        return { ok: false, reason: 'crushed' };
    }
  }
  for (const pk of geom.pockets) {
    if (!pk.open) continue;
    const before = prevGeom.pockets.find((q) => q.vid === pk.vid);
    for (let i = 0; i < n; i++) {
      const da = Math.hypot(pos[i]!.x - pk.x, pos[i]!.y - pk.y);
      if (da >= pk.sr) continue;
      const db = before && before.open ? Math.hypot(prev[i]!.x - before.x, prev[i]!.y - before.y) : Infinity;
      if (da < db - 0.01) return { ok: false, reason: 'keep-out' };
    }
  }
  return { ok: true };
}

/**
 * Move vertex `idx` in a straight line toward (tx, ty) in small steps, committing the longest
 * valid prefix. Balls are shoved as walls pass. Does not touch the budget.
 */
function sweepVertex(host: ReshapeHost, idx: number, tx: number, ty: number, validate: boolean): MoveResult {
  const res: MoveResult = { applied: 0, blocked: null, pushed: [] };
  const v = host.table.verts[idx]!;
  const dx = tx - v.x;
  const dy = ty - v.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return res;
  const steps = Math.max(1, Math.ceil(L / RESHAPE_STEP));
  const fromX = v.x;
  const fromY = v.y;
  const active = host.balls.filter((b) => b.active);
  const start = active.map((b) => ({ x: b.x, y: b.y }));
  let cur = start.map((p) => ({ ...p }));
  let prevGeom = host.geom;
  let goodX = fromX;
  let goodY = fromY;
  for (let k = 1; k <= steps; k++) {
    v.x = fromX + (dx * k) / steps;
    v.y = fromY + (dy * k) / steps;
    const geom = buildGeom(host.table, host.hunger);
    if (validate) {
      const valid = validateTable(host.table, geom);
      if (!valid.ok) {
        res.blocked = valid.reason ?? 'crossing';
        break;
      }
    }
    const trial = cur.map((p) => ({ ...p }));
    const s = settlePositions(trial, geom, cur, prevGeom);
    if (!s.ok) {
      res.blocked = s.reason ?? 'crushed';
      break;
    }
    cur = trial;
    prevGeom = geom;
    goodX = v.x;
    goodY = v.y;
  }
  v.x = goodX;
  v.y = goodY;
  host.geom = prevGeom;
  active.forEach((b, i) => {
    const p = cur[i]!;
    const ddx = p.x - start[i]!.x;
    const ddy = p.y - start[i]!.y;
    if (Math.abs(ddx) + Math.abs(ddy) > 0.01) res.pushed.push({ id: b.id, dx: ddx, dy: ddy });
    b.x = p.x;
    b.y = p.y;
  });
  res.applied = Math.hypot(goodX - fromX, goodY - fromY);
  return res;
}

/** Drag a vertex (by id) toward a target, spending stretch budget on the distance travelled. */
export function moveVertex(host: ReshapeHost, vid: number, tx: number, ty: number): MoveResult {
  const idx = vertexIndex(host.table, vid);
  if (idx < 0) return { applied: 0, blocked: null, pushed: [] };
  const v = host.table.verts[idx]!;
  tx = clamp(tx, PLAY.minX, PLAY.maxX);
  ty = clamp(ty, PLAY.minY, PLAY.maxY);
  let dx = tx - v.x;
  let dy = ty - v.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-3) return { applied: 0, blocked: null, pushed: [] };
  let budgetClipped = false;
  if (L > host.budget) {
    if (host.budget < 0.5) return { applied: 0, blocked: 'budget', pushed: [] };
    const f = host.budget / L;
    dx *= f;
    dy *= f;
    budgetClipped = true;
  }
  const res = sweepVertex(host, idx, v.x + dx, v.y + dy, true);
  host.budget = Math.max(0, host.budget - res.applied);
  if (!res.blocked && budgetClipped) res.blocked = 'budget';
  return res;
}

/**
 * Remove a bend vertex by sliding it onto the line between its neighbours (shoving balls,
 * paying budget for the distance), then deleting it. All or nothing.
 */
export function removeBend(host: ReshapeHost, vid: number): MoveResult & { removed: boolean } {
  const fail = (blocked: BlockReason) => ({ applied: 0, blocked, pushed: [], removed: false });
  const idx = vertexIndex(host.table, vid);
  const t = host.table;
  const v = t.verts[idx];
  if (!v) return fail('pocket');
  if (v.pocket) return fail('pocket');
  const n = t.verts.length;
  const a = t.verts[(idx + n - 1) % n]!;
  const b = t.verts[(idx + 1) % n]!;
  const q = closestOnSegment(v.x, v.y, a.x, a.y, b.x, b.y);
  const cost = Math.hypot(v.x - q.x, v.y - q.y);
  if (cost > host.budget + 1e-6) return fail('budget');

  const saved = {
    table: cloneTable(t),
    geom: host.geom,
    pos: host.balls.map((ball) => ({ x: ball.x, y: ball.y })),
  };
  const rollback = (blocked: BlockReason) => {
    host.table = saved.table;
    host.geom = saved.geom;
    host.balls.forEach((ball, i) => {
      ball.x = saved.pos[i]!.x;
      ball.y = saved.pos[i]!.y;
    });
    return fail(blocked);
  };

  const r = sweepVertex(host, idx, q.x, q.y, false);
  if (r.blocked) return rollback(r.blocked);
  const cand = withoutVertex(host.table, vertexIndex(host.table, vid));
  if (!cand) return rollback('pocket');
  const geom = buildGeom(cand, host.hunger);
  const valid = validateTable(cand, geom);
  if (!valid.ok) return rollback(valid.reason ?? 'crossing');
  const active = host.balls.filter((ball) => ball.active);
  const pos = active.map((ball) => ({ x: ball.x, y: ball.y }));
  const settled = settlePositions(
    pos,
    geom,
    pos.map((p) => ({ ...p })),
    host.geom,
  );
  if (!settled.ok) return rollback(settled.reason ?? 'crushed');
  active.forEach((ball, i) => {
    ball.x = pos[i]!.x;
    ball.y = pos[i]!.y;
  });
  host.table = cand;
  host.geom = geom;
  host.budget = Math.max(0, host.budget - r.applied);
  return { ...r, removed: true };
}

/** One pointer drag of a knob (or of a freshly inserted bend, when grabbing an edge midpoint). */
export class DragSession {
  applied = 0;
  lastBlocked: BlockReason | null = null;

  private constructor(
    readonly vid: number,
    private grabDx: number,
    private grabDy: number,
    readonly inserted: boolean,
  ) {}

  static begin(host: ReshapeHost, handle: Handle, px: number, py: number): DragSession | null {
    let idx = handle.index;
    let inserted = false;
    if (handle.kind === 'edge') {
      if (!canSplitEdge(host.table, handle.index)) return null;
      idx = insertVertex(host.table, handle.index);
      host.geom = buildGeom(host.table, host.hunger);
      inserted = true;
    }
    const v = host.table.verts[idx];
    if (!v) return null;
    return new DragSession(v.id, v.x - px, v.y - py, inserted);
  }

  move(host: ReshapeHost, px: number, py: number): MoveResult {
    const r = moveVertex(host, this.vid, px + this.grabDx, py + this.grabDy);
    this.applied += r.applied;
    this.lastBlocked = r.blocked;
    return r;
  }

  /** Drops a bend that was inserted but never really moved. Returns true if it was dropped. */
  end(host: ReshapeHost): boolean {
    if (!this.inserted || this.applied >= 2) return false;
    const idx = vertexIndex(host.table, this.vid);
    const cand = idx >= 0 ? withoutVertex(host.table, idx) : null;
    if (!cand) return false;
    const geom = buildGeom(cand, host.hunger);
    if (!validateTable(cand, geom).ok) return false;
    const active = host.balls.filter((b) => b.active);
    const pos = active.map((b) => ({ x: b.x, y: b.y }));
    if (
      !settlePositions(
        pos,
        geom,
        pos.map((p) => ({ ...p })),
        host.geom,
      ).ok
    )
      return false;
    active.forEach((b, i) => {
      b.x = pos[i]!.x;
      b.y = pos[i]!.y;
    });
    host.table = cand;
    host.geom = geom;
    return true;
  }
}
