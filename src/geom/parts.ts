import type { Vec } from '../core/vec';

/**
 * Table toys. Directions are lattice vectors (integers), normalized with sqrt when compiled, so
 * a part's geometry is exact and replays the same everywhere. Parts live on the Table (they are
 * part of the board: persistent, snapshotted, shared) and compile into TableGeom colliders.
 */
export interface Dir {
  x: number;
  y: number;
}

export type FeltKind = 'ice' | 'mud' | 'sand' | 'conveyor' | 'fan';

interface PartBase {
  id: number;
  x: number;
  y: number;
  /** Placed by the level: cannot be moved or rotated. */
  locked?: boolean;
}

export type Part =
  /** A free-standing wall segment centred on (x, y). */
  | (PartBase & { kind: 'stub'; dir: Dir; len: number })
  /** A curved rail: the arc of radius r around (x, y) from direction `from` to `to`, clockwise. */
  | (PartBase & { kind: 'arc'; r: number; from: Dir; to: Dir })
  /** Pinball bumper: kicks balls away harder than they arrived. */
  | (PartBase & { kind: 'bumper'; r: number })
  /** A glass pane: breaks after `hp` real hits. */
  | (PartBase & { kind: 'glass'; dir: Dir; len: number; hp: number })
  /** One-way gate: balls may cross it in direction `dir` only. */
  | (PartBase & { kind: 'gate'; dir: Dir; len: number })
  /** Speed pad: a kick along `dir` for every ball that rolls onto it. */
  | (PartBase & { kind: 'booster'; dir: Dir; len: number; wid: number; kick: number })
  /** A patch of special felt, a w x h rectangle along `dir`. */
  | (PartBase & { kind: 'felt'; felt: FeltKind; dir: Dir; w: number; h: number; power?: number })
  /** Pulls balls in (polarity 1) or pushes them away (-1). */
  | (PartBase & { kind: 'magnet'; polarity: 1 | -1; r: number; strength: number })
  /** Swallows balls and spits them out at one of its exits. */
  | (PartBase & { kind: 'blackhole'; r: number; exits: Vec[] })
  /** One end of a portal pair: `link` is the id of the other end. */
  | (PartBase & { kind: 'portal'; link: number; r: number })
  /** A target spot (Classic "park the cue ball here" goals). Not a collider. */
  | (PartBase & { kind: 'bullseye'; r: number });

export type PartKind = Part['kind'];

/** Parts with a direction arrow (spun on placement in Free Play, fixed in Classic). */
export const ARROW_PARTS: readonly PartKind[] = ['booster', 'gate', 'felt'];

export function cloneParts(parts: readonly Part[]): Part[] {
  return parts.map((p) => {
    const c = { ...p } as Part;
    if ('dir' in c) c.dir = { ...c.dir };
    if (c.kind === 'arc') {
      c.from = { ...c.from };
      c.to = { ...c.to };
    }
    if (c.kind === 'blackhole') c.exits = c.exits.map((e) => ({ ...e }));
    return c;
  });
}

// ---------------------------------------------------------------- compiled colliders

/** Half-thickness of stubs, panes, gates and curved rails: balls touch them at R + THICK. */
export const THICK = 6;

/** A two-sided wall segment compiled from a part. */
export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Unit normal. For a gate, the direction balls are allowed to cross. */
  nx: number;
  ny: number;
  kind: 'stub' | 'arc' | 'glass' | 'gate';
  /** Id of the part it came from. */
  src: number;
  e: number;
  tdamp: number;
  /** Glass: hits left before it shatters. */
  hp?: number;
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
  src: number;
}

export interface Compiled {
  walls: Wall[];
  bumpers: Bumper[];
}

function unit(d: Dir): { x: number; y: number } {
  const l = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

function segment(
  cx: number,
  cy: number,
  dir: Dir,
  len: number,
  kind: Wall['kind'],
  src: number,
  e: number,
  tdamp: number,
): Wall {
  const u = unit(dir);
  const h = len / 2;
  return { ax: cx - u.x * h, ay: cy - u.y * h, bx: cx + u.x * h, by: cy + u.y * h, nx: -u.y, ny: u.x, kind, src, e, tdamp };
}

/**
 * Points along a clockwise arc (screen coordinates) from unit direction u to v, by repeated
 * bisection (normalize(u + v) halves the angle), so no trig: exact everywhere.
 */
export function arcPoints(cx: number, cy: number, r: number, from: Dir, to: Dir, maxChord = 30): Vec[] {
  const u = unit(from);
  const v = unit(to);
  // Clockwise on a y-down screen: the turn from u to v is positive when cross > 0.
  const cross = u.x * v.y - u.y * v.x;
  const dot = u.x * v.x + u.y * v.y;
  const dirs: { x: number; y: number }[] = [u];
  if (cross < 0 || (cross === 0 && dot < 0)) {
    // More than half a turn: step through the quarter-turn points first.
    let w = u;
    for (let k = 0; k < 3; k++) {
      const q = { x: -w.y, y: w.x }; // a quarter turn clockwise
      const cq = q.x * v.y - q.y * v.x;
      const dq = q.x * v.x + q.y * v.y;
      dirs.push(q);
      w = q;
      if (cq >= 0 && dq > 0) break;
    }
  }
  const last = dirs[dirs.length - 1]!;
  if (Math.abs(last.x - v.x) + Math.abs(last.y - v.y) > 1e-9) dirs.push(v);
  const out: Vec[] = [];
  const emit = (a: { x: number; y: number }, b: { x: number; y: number }, depth: number) => {
    const chord = r * Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    if (chord <= maxChord || depth > 8) {
      out.push({ x: cx + b.x * r, y: cy + b.y * r });
      return;
    }
    const m = unit({ x: a.x + b.x, y: a.y + b.y });
    emit(a, m, depth + 1);
    emit(m, b, depth + 1);
  };
  out.push({ x: cx + u.x * r, y: cy + u.y * r });
  for (let i = 0; i + 1 < dirs.length; i++) emit(dirs[i]!, dirs[i + 1]!, 0);
  return out;
}

/** Turns the table's solid toys into colliders. */
export function compileParts(parts: readonly Part[], e: number, tdamp: number): Compiled {
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  for (const p of parts) {
    switch (p.kind) {
      case 'stub':
        walls.push(segment(p.x, p.y, p.dir, p.len, 'stub', p.id, e, tdamp));
        break;
      case 'glass':
        if (p.hp > 0) walls.push({ ...segment(p.x, p.y, p.dir, p.len, 'glass', p.id, e * 0.8, tdamp), hp: p.hp });
        break;
      case 'gate': {
        // The gate stands across its arrow: balls may cross in the arrow's direction only.
        const u = unit(p.dir);
        const w = segment(p.x, p.y, { x: -u.y, y: u.x }, p.len, 'gate', p.id, e, tdamp);
        w.nx = u.x;
        w.ny = u.y;
        walls.push(w);
        break;
      }
      case 'arc': {
        const pts = arcPoints(p.x, p.y, p.r, p.from, p.to);
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l = Math.sqrt(dx * dx + dy * dy) || 1;
          walls.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, nx: -dy / l, ny: dx / l, kind: 'arc', src: p.id, e, tdamp });
        }
        break;
      }
      case 'bumper':
        bumpers.push({ x: p.x, y: p.y, r: p.r, src: p.id });
        break;
      default:
        break;
    }
  }
  return { walls, bumpers };
}
