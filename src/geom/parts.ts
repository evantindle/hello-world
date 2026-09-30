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
