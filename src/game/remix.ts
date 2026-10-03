import { R } from '../config';
import { rngFor, type Rng } from '../core/rng';
import type { Vec } from '../core/vec';
import type { Part } from '../geom/parts';
import { pointInPolygon } from '../geom/polygon';
import { buildGeom, validateTable, type RailMaterial, type Table, type TableVertex } from '../geom/table';
import type { Ball, BallVariant } from '../physics/world';
import { checkParts, dirOf, newPartId, TURN_STEPS, type PartPreset, type TrayItem } from './placement';
import { rackBalls } from './rules';
import { settlePositions } from './settle';
import { TOY_PRESETS } from './toys';

/**
 * Free Play remix: every game a new table. A named shape, then a few twists drawn from a pool
 * (fussy pockets, odd rails, toys already on the felt, toys to put down, oddball balls), all from
 * the game's seed, so the same seed always deals the same table.
 */

interface Shape {
  name: string;
  /** Corners in order (positive area: interior on the left), pocket or not. */
  pts: readonly (readonly [number, number, boolean])[];
  /** Where the rack's apex and the cue ball go. */
  apex: Vec;
  cue: Vec;
}

export const SHAPES: readonly Shape[] = [
  {
    name: 'THE CLASSIC',
    pts: [
      [0, 0, true],
      [500, 0, true],
      [1000, 0, true],
      [1000, 500, true],
      [500, 500, true],
      [0, 500, true],
    ],
    apex: { x: 700, y: 250 },
    cue: { x: 250, y: 250 },
  },
  {
    name: 'THE LONG HALL',
    pts: [
      [-60, 110, true],
      [500, 110, true],
      [1060, 110, true],
      [1060, 390, true],
      [500, 390, true],
      [-60, 390, true],
    ],
    apex: { x: 720, y: 250 },
    cue: { x: 160, y: 250 },
  },
  {
    name: 'THE OCTAGON',
    pts: [
      [130, 0, true],
      [870, 0, true],
      [1000, 130, true],
      [1000, 370, true],
      [870, 500, true],
      [130, 500, true],
      [0, 370, true],
      [0, 130, true],
    ],
    apex: { x: 680, y: 250 },
    cue: { x: 240, y: 250 },
  },
  {
    name: 'THE DIAMOND',
    pts: [
      [500, -60, true],
      [780, 95, false],
      [1060, 250, true],
      [780, 405, false],
      [500, 560, true],
      [220, 405, false],
      [-60, 250, true],
      [220, 95, false],
    ],
    apex: { x: 600, y: 250 },
    cue: { x: 230, y: 250 },
  },
  {
    name: 'THE L',
    pts: [
      [0, 0, true],
      [560, 0, true],
      [560, 220, false],
      [1000, 220, true],
      [1000, 500, true],
      [500, 500, true],
      [0, 500, true],
    ],
    apex: { x: 720, y: 360 },
    cue: { x: 220, y: 250 },
  },
  {
    name: 'THE BOWTIE',
    pts: [
      [0, 0, true],
      [500, 90, false],
      [1000, 0, true],
      [1000, 500, true],
      [500, 410, false],
      [0, 500, true],
    ],
    apex: { x: 700, y: 250 },
    cue: { x: 220, y: 250 },
  },
  {
    name: 'THE WEDGE',
    pts: [
      [0, 80, true],
      [500, 30, true],
      [1000, -20, true],
      [1000, 520, true],
      [500, 470, true],
      [0, 420, true],
    ],
    apex: { x: 700, y: 250 },
    cue: { x: 200, y: 250 },
  },
  {
    name: 'THE ARENA',
    pts: [
      [200, 0, true],
      [800, 0, true],
      [1060, 250, true],
      [800, 500, true],
      [200, 500, true],
      [-60, 250, true],
    ],
    apex: { x: 680, y: 250 },
    cue: { x: 220, y: 250 },
  },
];

export interface Remix {
  name: string;
  /** The twists dealt, as their names. */
  twists: string[];
  table: Table;
  balls: Ball[];
  tray: TrayItem[];
}

interface Deal {
  rng: Rng;
  table: Table;
  balls: Ball[];
  tray: TrayItem[];
}

type Twist = (d: Deal) => string | null;

function pockets(d: Deal): TableVertex[] {
  return d.table.verts.filter((v) => v.pocket && !v.trait && !v.bolted);
}

function pickN<T>(rng: Rng, list: readonly T[], n: number): T[] {
  return rng.shuffle([...list]).slice(0, n);
}

function rails(d: Deal, mat: RailMaterial, n: number, label: string): string | null {
  const free = d.table.verts.filter((v) => !v.mat || v.mat === 'felt');
  if (free.length < n) return null;
  for (const v of pickN(d.rng, free, n)) v.mat = mat;
  return label;
}

/** Puts one toy down on the dealt table at a random good spot (not on a ball, not on anything). */
function scatter(d: Deal, preset: PartPreset): boolean {
  const t = d.table;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of t.verts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  const before = buildGeom(t);
  for (let tries = 0; tries < 40; tries++) {
    const x = Math.round(d.rng.range(minX + 60, maxX - 60));
    const y = Math.round(d.rng.range(minY + 60, maxY - 60));
    if (!pointInPolygon(x, y, before.poly)) continue;
    const nextId = t.nextId;
    const id = newPartId(t);
    const part = { ...structuredClone(preset), id, x, y } as Part;
    if ('dir' in part) part.dir = dirOf(d.rng.int(TURN_STEPS));
    if (part.kind === 'arc') {
      const k = d.rng.int(TURN_STEPS);
      part.from = dirOf(k);
      part.to = dirOf(k + TURN_STEPS / 4);
    }
    const added: Part[] = [part];
    if (part.kind === 'portal') {
      // The far end mirrors the near one through the middle of the table.
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const far = {
        ...part,
        id: newPartId(t),
        x: Math.round(2 * cx - x),
        y: Math.round(2 * cy - y),
        link: id,
      };
      part.link = far.id;
      added.push(far);
    }
    t.parts.push(...added);
    const geom = buildGeom(t);
    const ok =
      added.every((p) => checkParts(t, geom, { only: p.id }).ok) &&
      !coversBall(d, added) &&
      settles(d, geom, before);
    if (ok) return true;
    t.parts.splice(t.parts.length - added.length, added.length);
    t.nextId = nextId;
  }
  return false;
}

/** Belts, fans and pads must not start under a ball (a belt would carry it off before the shot). */
function coversBall(d: Deal, parts: Part[]): boolean {
  for (const p of parts) {
    if (p.kind !== 'felt' && p.kind !== 'booster') continue;
    const half = (p.kind === 'felt' ? Math.max(p.w, p.h) : Math.max(p.len, p.wid)) / 2 + R;
    for (const b of d.balls) if (Math.abs(b.x - p.x) < half && Math.abs(b.y - p.y) < half) return true;
  }
  return false;
}

/** The balls sit where they are: nothing landed on one, nothing pulls one at the start. */
function settles(d: Deal, geom: ReturnType<typeof buildGeom>, before: ReturnType<typeof buildGeom>): boolean {
  const pos = d.balls.map((b) => ({ x: b.x, y: b.y }));
  const s = settlePositions(
    pos,
    geom,
    pos.map((p) => ({ ...p })),
    before,
  );
  return s.ok && pos.every((p, i) => p.x === d.balls[i]!.x && p.y === d.balls[i]!.y);
}

const TOY_NAMES: Record<string, string> = {
  stub: 'WALLS',
  arc: 'CURVES',
  bumper: 'BUMPERS',
  glass: 'GLASS',
  gate: 'GATES',
  booster: 'ZOOM PADS',
  ice: 'ICE',
  mud: 'MUD',
  sand: 'SAND',
  conveyor: 'BELTS',
  fan: 'FANS',
  magnet: 'MAGNETS',
  repulsor: 'PUSHERS',
  blackhole: 'A BLACK HOLE',
  portal: 'PORTALS',
};

function toyKey(p: PartPreset): string {
  if (p.kind === 'felt') return p.felt;
  if (p.kind === 'magnet') return p.polarity > 0 ? 'magnet' : 'repulsor';
  return p.kind;
}

const ODDBALLS: readonly { variant: BallVariant; name: string }[] = [
  { variant: 'bowling', name: 'A BOWLING BALL' },
  { variant: 'egg', name: 'AN EGG' },
  { variant: 'bomb', name: 'A BOMB' },
  { variant: 'chicken', name: 'A CHICKEN' },
  { variant: 'ghost', name: 'A GHOST BALL' },
];

const TWISTS: readonly Twist[] = [
  (d) => {
    const ps = pockets(d);
    if (ps.length < 4) return null;
    for (const v of pickN(d.rng, ps, 1 + d.rng.int(2))) v.bolted = true;
    return 'BOLTED POCKETS';
  },
  (d) => {
    const ps = pockets(d);
    if (ps.length < 4) return null;
    pickN(d.rng, ps, 1)[0]!.trait = { kind: 'corked', strokes: 2 + d.rng.int(2) };
    return 'A CORKED POCKET';
  },
  (d) => {
    const ps = pockets(d);
    if (ps.length < 4) return null;
    const [a, b] = pickN(d.rng, ps, 2);
    a!.trait = { kind: 'picky', suit: 'warm' };
    b!.trait = { kind: 'picky', suit: 'cool' };
    return 'PICKY POCKETS';
  },
  (d) => {
    const ps = pockets(d);
    if (ps.length < 4) return null;
    pickN(d.rng, ps, 1 + d.rng.int(2)).forEach((v, i) => {
      v.trait = { kind: 'chomper', period: 1.6, open: 0.45, phase: i * 0.8 };
    });
    return 'CHOMPERS';
  },
  (d) => {
    const ps = pockets(d);
    if (ps.length < 4) return null;
    for (const v of pickN(d.rng, ps, 1 + d.rng.int(2))) v.trait = { kind: 'gentle', vmax: 320 };
    return 'GENTLE POCKETS';
  },
  (d) => rails(d, 'trampoline', 2, 'BOUNCY RAILS'),
  (d) => rails(d, 'dead', 2, 'DEAD RAILS'),
  (d) => rails(d, 'steel', 2, 'STEEL RAILS'),
  (d) => {
    // Toys already on the felt: one kind, one to three of them (portals and black holes come singly).
    const preset = TOY_PRESETS[d.rng.int(TOY_PRESETS.length)]!;
    const key = toyKey(preset);
    const n = key === 'portal' || key === 'blackhole' || preset.kind === 'felt' ? 1 : 1 + d.rng.int(3);
    let placed = 0;
    for (let i = 0; i < n; i++) if (scatter(d, preset)) placed++;
    return placed > 0 ? TOY_NAMES[key]! : null;
  },
  (d) => {
    // Toys to put down yourself.
    const picks = pickN(d.rng, TOY_PRESETS, 2 + d.rng.int(2));
    for (const preset of picks) d.tray.push({ preset: structuredClone(preset), count: 1 });
    return 'TOYS TO PLACE';
  },
  (d) => {
    const objects = d.balls.filter((b) => b.kind === 'object' && b.variant === 'normal');
    const odd = ODDBALLS[d.rng.int(ODDBALLS.length)]!;
    const b = objects[d.rng.int(objects.length)];
    if (!b) return null;
    b.variant = odd.variant;
    b.invMass = odd.variant === 'bowling' ? 1 / 3 : 1;
    b.hp = odd.variant === 'egg' ? 2 : 0;
    b.fuse = odd.variant === 'bomb' ? 3 : 0;
    return odd.name;
  },
];

/**
 * Deals a remix for `seed`. `level` is how many twists (0: the plain classic table, for a first
 * game).
 */
export function makeRemix(seed: number, level = 2): Remix {
  const rng = rngFor(seed, 'remix');
  const shape = level === 0 ? SHAPES[0]! : SHAPES[rng.int(SHAPES.length)]!;
  const table: Table = {
    verts: shape.pts.map(([x, y, pocket], id) => ({ id, x, y, pocket })),
    parts: [],
    nextId: shape.pts.length,
  };
  const balls = rackBalls(rngFor(seed, 'rack'), shape.apex, shape.cue);
  const d: Deal = { rng, table, balls, tray: [] };
  const twists: string[] = [];
  const order = rng.shuffle(TWISTS.map((_, i) => i));
  for (const i of order) {
    if (twists.length >= level) break;
    const name = TWISTS[i]!(d);
    if (name) twists.push(name);
  }
  return { name: [shape.name, ...twists].join(' · '), twists, table, balls, tray: d.tray };
}

/** Every remix shape must be a valid table (a test checks this; so does the dev build). */
export function shapeProblems(): string[] {
  const out: string[] = [];
  for (const s of SHAPES) {
    const t: Table = {
      verts: s.pts.map(([x, y, pocket], id) => ({ id, x, y, pocket })),
      parts: [],
      nextId: s.pts.length,
    };
    const v = validateTable(t, buildGeom(t));
    if (!v.ok) out.push(`${s.name}: ${v.reason}`);
  }
  return out;
}
