import { BLACKHOLE_CORE, R } from '../config';
import { hyp } from '../core/vec';
import {
  ARROW_PARTS,
  arcPoints,
  compileFloor,
  compileParts,
  THICK,
  type Dir,
  type Part,
  type Zone,
} from '../geom/parts';
import { closestOnSegment, distToSegment, pointInPolygon } from '../geom/polygon';
import { buildGeom, type Table, type TableGeom } from '../geom/table';
import type { Ball } from '../physics/world';
import { settlePositions, type BlockReason, type MoveResult } from './reshape';

/**
 * Toys on the table: finding them under the pointer, checking where they may go, and moving,
 * turning, placing and stowing them. Like bending, every move sweeps in small steps and keeps the
 * longest valid stretch, shoving balls aside as solid toys pass.
 *
 * Simulation geometry depends on what this writes, so it sticks to + - * / and sqrt: turning
 * snaps to a table of 5-degree directions written out as integers.
 */

/** Anything toys can be edited on (the game). */
export interface ArenaHost {
  table: Table;
  geom: TableGeom;
  balls: Ball[];
  hunger: number;
}

/** A part with its position left out: what a tray hands out. */
export type PartPreset = Part extends infer P ? (P extends Part ? Omit<P, 'id' | 'x' | 'y'> : never) : never;

/** Toys waiting to be put down: a Classic level's tray, the remix's handout, the Toy Box. */
export interface TrayItem {
  preset: PartPreset;
  count: number;
}

/** cos/sin * 1000 of every multiple of 5 degrees (y down): the directions toys can turn to. */
export const DIRS: readonly (readonly [number, number])[] = [
  [1000, 0], [996, 87], [985, 174], [966, 259], [940, 342], [906, 423],
  [866, 500], [819, 574], [766, 643], [707, 707], [643, 766], [574, 819],
  [500, 866], [423, 906], [342, 940], [259, 966], [174, 985], [87, 996],
  [0, 1000], [-87, 996], [-174, 985], [-259, 966], [-342, 940], [-423, 906],
  [-500, 866], [-574, 819], [-643, 766], [-707, 707], [-766, 643], [-819, 574],
  [-866, 500], [-906, 423], [-940, 342], [-966, 259], [-985, 174], [-996, 87],
  [-1000, 0], [-996, -87], [-985, -174], [-966, -259], [-940, -342], [-906, -423],
  [-866, -500], [-819, -574], [-766, -643], [-707, -707], [-643, -766], [-574, -819],
  [-500, -866], [-423, -906], [-342, -940], [-259, -966], [-174, -985], [-87, -996],
  [0, -1000], [87, -996], [174, -985], [259, -966], [342, -940], [423, -906],
  [500, -866], [574, -819], [643, -766], [707, -707], [766, -643], [819, -574],
  [866, -500], [906, -423], [940, -342], [966, -259], [985, -174], [996, -87],
]; // prettier-ignore

export const TURN_STEPS = DIRS.length;

/** The table direction nearest to (x, y). */
export function nearestDir(x: number, y: number): number {
  let best = 0;
  let bd = -Infinity;
  for (let k = 0; k < DIRS.length; k++) {
    const d = DIRS[k]![0] * x + DIRS[k]![1] * y;
    if (d > bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

export function dirOf(k: number): Dir {
  const d = DIRS[((k % TURN_STEPS) + TURN_STEPS) % TURN_STEPS]!;
  return { x: d[0], y: d[1] };
}

/** Max distance a toy moves per validated step. */
const PART_STEP = 12;

/** Toys that block balls (as opposed to toys that lie flat on the felt). */
export function isSolid(p: Part): boolean {
  return (
    p.kind === 'stub' || p.kind === 'arc' || p.kind === 'glass' || p.kind === 'gate' || p.kind === 'bumper'
  );
}

/** Toys with a direction a player could turn. */
export function hasDir(p: Part): boolean {
  return 'dir' in p || p.kind === 'arc';
}

/** Whether rules allowing `arrows` let a player turn this toy (arrows only in the Toy Box). */
export function canTurn(p: Part, arrows: 'fixed' | 'random' | 'free'): boolean {
  if (p.locked || !hasDir(p)) return false;
  return arrows === 'free' || !ARROW_PARTS.includes(p.kind);
}

// ---------------------------------------------------------------- shapes

type Seg = [number, number, number, number];

function wallSegs(p: Part): Seg[] {
  return compileParts([p], 1, 1).walls.map((w) => [w.ax, w.ay, w.bx, w.by]);
}

function zoneOf(p: Part): Zone | null {
  return compileFloor([p]).zones[0] ?? null;
}

/** Half-length along the toy's direction, for the turning knob. */
function reachOf(p: Part): number {
  switch (p.kind) {
    case 'stub':
    case 'glass':
    case 'gate':
      return p.len / 2;
    case 'booster':
      return p.len / 2;
    case 'felt':
      return p.w / 2;
    case 'arc':
      return p.r;
    default:
      return 0;
  }
}

function segSegDist(a: Seg, b: Seg): number {
  if (segmentsCross(a, b)) return 0;
  return Math.min(
    distToSegment(a[0], a[1], b[0], b[1], b[2], b[3]),
    distToSegment(a[2], a[3], b[0], b[1], b[2], b[3]),
    distToSegment(b[0], b[1], a[0], a[1], a[2], a[3]),
    distToSegment(b[2], b[3], a[0], a[1], a[2], a[3]),
  );
}

function segmentsCross(a: Seg, b: Seg): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = o(a[0], a[1], a[2], a[3], b[0], b[1]);
  const d2 = o(a[0], a[1], a[2], a[3], b[2], b[3]);
  const d3 = o(b[0], b[1], b[2], b[3], a[0], a[1]);
  const d4 = o(b[0], b[1], b[2], b[3], a[2], a[3]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segsDist(a: Seg[], b: Seg[]): number {
  let d = Infinity;
  for (const s of a) for (const t of b) d = Math.min(d, segSegDist(s, t));
  return d;
}

function pointSegsDist(x: number, y: number, segs: Seg[]): number {
  let d = Infinity;
  for (const s of segs) d = Math.min(d, distToSegment(x, y, s[0], s[1], s[2], s[3]));
  return d;
}

/** Distance from (x, y) to zone z's rectangle (0 inside). */
function pointZoneDist(z: Zone, x: number, y: number): number {
  const dx = x - z.cx;
  const dy = y - z.cy;
  const a = Math.abs(dx * z.ux + dy * z.uy) - z.hl;
  const b = Math.abs(-dx * z.uy + dy * z.ux) - z.hw;
  const ox = a > 0 ? a : 0;
  const oy = b > 0 ? b : 0;
  return Math.sqrt(ox * ox + oy * oy);
}

function zonesOverlap(a: Zone, b: Zone): boolean {
  // Separating axis test over both rectangles' axes.
  const axes: [number, number][] = [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ];
  const radius = (z: Zone, ax: number, ay: number) =>
    Math.abs(z.ux * ax + z.uy * ay) * z.hl + Math.abs(-z.uy * ax + z.ux * ay) * z.hw;
  for (const [ax, ay] of axes) {
    const d = Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay);
    if (d >= radius(a, ax, ay) + radius(b, ax, ay)) return false;
  }
  return true;
}

/** Distance from (x, y) to the nearest polygon edge. */
function edgeDist(geom: TableGeom, x: number, y: number): number {
  const poly = geom.poly;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y));
  }
  return d;
}

/** A toy's footprint, for clearance checks. */
interface Footprint {
  part: Part;
  /** Wall segments (stub, arc, glass, gate). */
  segs: Seg[] | null;
  /** Round things: bumper (its body), portal (its disc), black hole (its core). */
  disc: { x: number; y: number; r: number } | null;
  zone: Zone | null;
}

function footprint(p: Part): Footprint {
  const f: Footprint = { part: p, segs: null, disc: null, zone: null };
  if (p.kind === 'stub' || p.kind === 'arc' || p.kind === 'glass' || p.kind === 'gate') f.segs = wallSegs(p);
  else if (p.kind === 'bumper') f.disc = { x: p.x, y: p.y, r: p.r };
  else if (p.kind === 'portal') f.disc = { x: p.x, y: p.y, r: p.r };
  else if (p.kind === 'blackhole') f.disc = { x: p.x, y: p.y, r: BLACKHOLE_CORE };
  else if (p.kind === 'booster' || p.kind === 'felt') f.zone = zoneOf(p);
  return f;
}

/** Gap needed between two toys (surface to surface), or null if they may overlap freely. */
function gapBetween(a: Footprint, b: Footprint): number | null {
  const solidA = isSolid(a.part);
  const solidB = isSolid(b.part);
  if (solidA && solidB) return R;
  const holeish = (f: Footprint) => f.part.kind === 'portal' || f.part.kind === 'blackhole';
  if ((holeish(a) && (solidB || holeish(b))) || (holeish(b) && solidA)) return R;
  return null;
}

/** Surface distance between two footprints (negative or 0 when they overlap). */
function surfaceDist(a: Footprint, b: Footprint): number {
  const ra = a.segs ? THICK : (a.disc?.r ?? 0);
  const rb = b.segs ? THICK : (b.disc?.r ?? 0);
  if (a.segs && b.segs) return segsDist(a.segs, b.segs) - ra - rb;
  if (a.segs && b.disc) return pointSegsDist(b.disc.x, b.disc.y, a.segs) - ra - rb;
  if (b.segs && a.disc) return pointSegsDist(a.disc.x, a.disc.y, b.segs) - ra - rb;
  if (a.disc && b.disc) return hyp(a.disc.x - b.disc.x, a.disc.y - b.disc.y) - ra - rb;
  return Infinity;
}

export interface PartCheck {
  ok: boolean;
  reason?: BlockReason;
  /** The toy at fault. */
  part?: number;
}

/**
 * Where toys may be: solids inside the table with at least R between them and any rail or other
 * solid; flat toys with their centre at least R inside (a portal's whole disc); nothing over a
 * pocket's pull; pads and patches not overlapping; portals and black holes clear of solids and of
 * each other. `only` limits the checks to one toy (the one being moved); `pairs: false` skips
 * toy-against-toy checks (a bend cannot change those).
 */
export function checkParts(
  t: Table,
  geom: TableGeom,
  opts: { only?: number; pairs?: boolean } = {},
): PartCheck {
  const parts = t.parts;
  const feet = parts.map(footprint);
  for (const f of feet) {
    const p = f.part;
    if (opts.only !== undefined && p.id !== opts.only) continue;
    const bad = (reason: BlockReason): PartCheck => ({ ok: false, reason, part: p.id });
    if (f.segs) {
      for (const s of f.segs) {
        if (!pointInPolygon(s[0], s[1], geom.poly) || !pointInPolygon(s[2], s[3], geom.poly))
          return bad('off-table');
        for (const r of geom.rails)
          if (segSegDist(s, [r.ax, r.ay, r.bx, r.by]) < THICK + R) return bad('off-table');
      }
    } else if (p.kind === 'bumper') {
      if (!pointInPolygon(p.x, p.y, geom.poly)) return bad('off-table');
      for (const r of geom.rails)
        if (distToSegment(p.x, p.y, r.ax, r.ay, r.bx, r.by) < p.r + R) return bad('off-table');
    } else {
      const inset = p.kind === 'portal' ? p.r : R;
      if (!pointInPolygon(p.x, p.y, geom.poly) || edgeDist(geom, p.x, p.y) < inset) return bad('off-table');
    }
    for (const pk of geom.pockets) {
      let d: number;
      if (f.segs) d = pointSegsDist(pk.x, pk.y, f.segs) - THICK;
      else if (f.zone) d = pointZoneDist(f.zone, pk.x, pk.y);
      else if (f.disc) d = hyp(pk.x - f.disc.x, pk.y - f.disc.y) - f.disc.r;
      else d = hyp(pk.x - p.x, pk.y - p.y) - (p.kind === 'magnet' ? 24 : 0);
      if (d < pk.sr) return bad('on-pocket');
    }
    if (opts.pairs === false) continue;
    for (const g of feet) {
      if (g === f) continue;
      // Each pair once when checking everything; every partner when checking one toy.
      if (opts.only === undefined && parts.indexOf(g.part) < parts.indexOf(p)) continue;
      if (f.zone && g.zone) {
        if (zonesOverlap(f.zone, g.zone)) return bad('overlap');
        continue;
      }
      const gap = gapBetween(f, g);
      if (gap !== null && surfaceDist(f, g) < gap) return bad('overlap');
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- finding toys

export interface PartHandle {
  kind: 'part' | 'part-rot';
  id: number;
  x: number;
  y: number;
  locked: boolean;
}

/** Where a toy's turning knob sits: just past its end, along its direction. */
export function turnKnob(p: Part): { x: number; y: number } | null {
  if (!hasDir(p)) return null;
  if (p.kind === 'arc') {
    const pts = arcPoints(p.x, p.y, p.r, p.from, p.to);
    const m = pts[Math.floor(pts.length / 2)]!;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const l = hyp(dx, dy) || 1;
    return { x: p.x + (dx / l) * (p.r + 30), y: p.y + (dy / l) * (p.r + 30) };
  }
  const d = (p as { dir: Dir }).dir;
  const l = hyp(d.x, d.y) || 1;
  const k = reachOf(p) + 30;
  return { x: p.x + (d.x / l) * k, y: p.y + (d.y / l) * k };
}

/** How far (x, y) is from grabbing toy p's body. */
export function partDistance(p: Part, x: number, y: number): number {
  switch (p.kind) {
    case 'stub':
    case 'glass':
    case 'gate':
    case 'arc':
      return Math.max(0, pointSegsDist(x, y, wallSegs(p)) - THICK);
    case 'booster':
    case 'felt': {
      const z = zoneOf(p);
      return z ? pointZoneDist(z, x, y) : Infinity;
    }
    case 'bumper':
    case 'portal':
    case 'bullseye':
      return Math.max(0, hyp(x - p.x, y - p.y) - p.r);
    case 'magnet':
      return Math.max(0, hyp(x - p.x, y - p.y) - 26);
    case 'blackhole':
      return Math.max(0, hyp(x - p.x, y - p.y) - BLACKHOLE_CORE - 10);
  }
}

/**
 * The toy (or turning knob) under the pointer: knobs first (only for toys in `knobs`), then the
 * nearest toy body within `radius`. Flat toys lose ties to solid ones lying on top of them.
 */
export function hitPart(
  t: Table,
  x: number,
  y: number,
  radius: number,
  knobs: readonly number[],
): PartHandle | null {
  for (const p of t.parts) {
    if (!knobs.includes(p.id)) continue;
    const k = turnKnob(p);
    if (k && hyp(k.x - x, k.y - y) < radius)
      return { kind: 'part-rot', id: p.id, x: k.x, y: k.y, locked: !!p.locked };
  }
  let best: PartHandle | null = null;
  let bd = Infinity;
  for (const p of t.parts) {
    const d = partDistance(p, x, y) + (isSolid(p) ? 0 : 0.5);
    if (d < radius && d < bd) {
      bd = d;
      best = { kind: 'part', id: p.id, x: p.x, y: p.y, locked: !!p.locked };
    }
  }
  return best;
}

// ---------------------------------------------------------------- editing

/** A fresh id above every vertex and toy id in use. */
export function newPartId(t: Table): number {
  let id = t.nextId;
  for (const p of t.parts) if (p.id >= id) id = p.id + 1;
  t.nextId = id + 1;
  return id;
}

/**
 * Validates the arena after toys `ids` changed (geometry already rebuilt), settling balls from
 * `cur` (positions under `prevGeom`). Returns the settled positions, or why it failed (and which
 * toy was at fault, if one was).
 */
function settleAfter(
  host: ArenaHost,
  geom: TableGeom,
  ids: readonly number[],
  cur: { x: number; y: number }[],
  prevGeom: TableGeom,
): { ok: true; pos: { x: number; y: number }[] } | { ok: false; reason: BlockReason; part?: number } {
  for (const id of ids) {
    const c = checkParts(host.table, geom, { only: id });
    if (!c.ok) return { ok: false, reason: c.reason ?? 'overlap', part: id };
  }
  const trial = cur.map((p) => ({ ...p }));
  const s = settlePositions(trial, geom, cur, prevGeom);
  if (!s.ok) return { ok: false, reason: s.reason ?? 'crushed' };
  return { ok: true, pos: trial };
}

function shoveResult(
  active: Ball[],
  start: { x: number; y: number }[],
  cur: { x: number; y: number }[],
): MoveResult['pushed'] {
  const out: MoveResult['pushed'] = [];
  active.forEach((b, i) => {
    const dx = cur[i]!.x - start[i]!.x;
    const dy = cur[i]!.y - start[i]!.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) out.push({ id: b.id, dx, dy });
    b.x = cur[i]!.x;
    b.y = cur[i]!.y;
  });
  return out;
}

/** Slide toy `id` toward (tx, ty) in small steps, keeping the longest valid stretch. */
export function movePart(host: ArenaHost, id: number, tx: number, ty: number): MoveResult {
  const res: MoveResult = { applied: 0, blocked: null, pushed: [] };
  const p = host.table.parts.find((q) => q.id === id);
  if (!p) return res;
  if (p.locked) return { ...res, blocked: 'locked' };
  const fromX = p.x;
  const fromY = p.y;
  const dx = tx - fromX;
  const dy = ty - fromY;
  const L = hyp(dx, dy);
  if (L < 1e-6) return res;
  const steps = Math.max(1, Math.ceil(L / PART_STEP));
  const active = host.balls.filter((b) => b.active);
  const start = active.map((b) => ({ x: b.x, y: b.y }));
  let cur = start.map((q) => ({ ...q }));
  let prevGeom = host.geom;
  let goodX = fromX;
  let goodY = fromY;
  for (let k = 1; k <= steps; k++) {
    p.x = fromX + (dx * k) / steps;
    p.y = fromY + (dy * k) / steps;
    const geom = buildGeom(host.table, host.hunger);
    const s = settleAfter(host, geom, [id], cur, prevGeom);
    if (!s.ok) {
      res.blocked = s.reason;
      break;
    }
    cur = s.pos;
    prevGeom = geom;
    goodX = p.x;
    goodY = p.y;
  }
  p.x = goodX;
  p.y = goodY;
  host.geom = prevGeom;
  res.pushed = shoveResult(active, start, cur);
  res.applied = hyp(goodX - fromX, goodY - fromY);
  return res;
}

/** The toy's orientation as a table direction index (its arrow, or the middle of an arc). */
export function partTurn(p: Part): number {
  if (p.kind === 'arc') {
    const k = turnKnob(p)!;
    return nearestDir(k.x - p.x, k.y - p.y);
  }
  const d = (p as { dir: Dir }).dir;
  return nearestDir(d.x, d.y);
}

function setTurn(p: Part, k: number, base: { from: Dir; to: Dir; k: number } | null): void {
  if (p.kind === 'arc' && base) {
    const shift = k - base.k;
    p.from = dirOf(nearestDir(base.from.x, base.from.y) + shift);
    p.to = dirOf(nearestDir(base.to.x, base.to.y) + shift);
  } else if ('dir' in p) {
    p.dir = dirOf(k);
  }
}

/**
 * Turn toy `id` toward direction index `k` one 5-degree step at a time, keeping the last valid
 * step. Returns how many steps it turned.
 */
export function turnPart(
  host: ArenaHost,
  id: number,
  k: number,
): { steps: number; blocked: BlockReason | null; pushed: MoveResult['pushed'] } {
  const p = host.table.parts.find((q) => q.id === id);
  if (!p || !hasDir(p)) return { steps: 0, blocked: null, pushed: [] };
  if (p.locked) return { steps: 0, blocked: 'locked', pushed: [] };
  const k0 = partTurn(p);
  let delta = (((k - k0) % TURN_STEPS) + TURN_STEPS) % TURN_STEPS;
  if (delta > TURN_STEPS / 2) delta -= TURN_STEPS;
  if (delta === 0) return { steps: 0, blocked: null, pushed: [] };
  const base = p.kind === 'arc' ? { from: { ...p.from }, to: { ...p.to }, k: k0 } : null;
  const saved = p.kind === 'arc' ? null : { ...(p as { dir: Dir }).dir };
  const active = host.balls.filter((b) => b.active);
  const start = active.map((b) => ({ x: b.x, y: b.y }));
  let cur = start.map((q) => ({ ...q }));
  let prevGeom = host.geom;
  const sign = delta > 0 ? 1 : -1;
  let good = 0;
  let blocked: BlockReason | null = null;
  for (let s = 1; s <= Math.abs(delta); s++) {
    setTurn(p, k0 + sign * s, base);
    const geom = buildGeom(host.table, host.hunger);
    const r = settleAfter(host, geom, [id], cur, prevGeom);
    if (!r.ok) {
      blocked = r.reason;
      break;
    }
    cur = r.pos;
    prevGeom = geom;
    good = s;
  }
  if (good === 0) {
    if (base && p.kind === 'arc') {
      p.from = base.from;
      p.to = base.to;
    } else if (saved && 'dir' in p) {
      p.dir = saved;
    }
  } else {
    setTurn(p, k0 + sign * good, base);
  }
  host.geom = prevGeom;
  return { steps: good, blocked, pushed: shoveResult(active, start, cur) };
}

/**
 * Drop a new toy at (x, y). It must fit as it lands (balls may be shoved, not crushed). Returns
 * the toy's id, or why it would not fit.
 */
export function placePart(
  host: ArenaHost,
  preset: PartPreset,
  x: number,
  y: number,
  extra: Partial<Part> = {},
): Placed {
  if (preset.kind === 'portal') return placePortalPair(host, preset, x, y, extra);
  const t = host.table;
  const nextId = t.nextId;
  const id = newPartId(t);
  const part = { ...structuredClone(preset), ...extra, id, x, y } as Part;
  t.parts.push(part);
  const geom = buildGeom(t, host.hunger);
  const active = host.balls.filter((b) => b.active);
  const start = active.map((b) => ({ x: b.x, y: b.y }));
  const s = settleAfter(host, geom, [id], start, host.geom);
  if (!s.ok) {
    // Leave no trace (not even a used-up id), so recorded games replay exactly.
    t.parts.pop();
    t.nextId = nextId;
    return { ids: [], blocked: s.reason };
  }
  host.geom = geom;
  return { ids: [id], pushed: shoveResult(active, start, s.pos) };
}

export type Placed = { ids: number[]; pushed: MoveResult['pushed'] } | { ids: []; blocked: BlockReason };

/** A portal comes in pairs: the near end at (x, y), the far end wherever it first fits. */
function placePortalPair(
  host: ArenaHost,
  preset: PartPreset & { kind: 'portal' },
  x: number,
  y: number,
  extra: Partial<Part>,
): Placed {
  const t = host.table;
  const nextId = t.nextId;
  const a = newPartId(t);
  const b = newPartId(t);
  const active = host.balls.filter((q) => q.active);
  const start = active.map((q) => ({ x: q.x, y: q.y }));
  let blocked: BlockReason = 'overlap';
  for (const spot of portalPartnerSpots(host.geom, x, y)) {
    t.parts.push(
      { ...preset, ...extra, id: a, x, y, link: b } as Part,
      { ...preset, ...extra, id: b, x: spot.x, y: spot.y, link: a } as Part,
    );
    const geom = buildGeom(t, host.hunger);
    const s = settleAfter(host, geom, [a, b], start, host.geom);
    if (s.ok) {
      host.geom = geom;
      return { ids: [a, b], pushed: shoveResult(active, start, s.pos) };
    }
    t.parts.splice(t.parts.length - 2, 2);
    blocked = s.reason;
    // The near end itself does not fit: no far end will help.
    if (s.part === a) break;
  }
  t.nextId = nextId;
  return { ids: [], blocked };
}

/** Take a toy off the table (both ends of a portal go together). Returns the ids removed. */
export function removeParts(host: ArenaHost, id: number): number[] {
  const t = host.table;
  const p = t.parts.find((q) => q.id === id);
  if (!p) return [];
  const ids = p.kind === 'portal' ? [p.id, p.link] : [p.id];
  t.parts = t.parts.filter((q) => !ids.includes(q.id));
  host.geom = buildGeom(t, host.hunger);
  return ids;
}

/** Spots to try for a portal's far end: through the table's centre, then around the near end. */
export function portalPartnerSpots(geom: TableGeom, x: number, y: number): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const q of geom.poly) {
    cx += q.x;
    cy += q.y;
  }
  cx /= geom.poly.length;
  cy /= geom.poly.length;
  const out = [{ x: 2 * cx - x, y: 2 * cy - y }];
  for (let k = 0; k < TURN_STEPS; k += 6) {
    const d = DIRS[k]!;
    out.push({ x: x + d[0] * 0.32, y: y + d[1] * 0.32 });
  }
  return out;
}

/** Closest point on a toy to (x, y): where a pointer that grabbed it is holding it. */
export function grabPoint(p: Part, x: number, y: number): { x: number; y: number } {
  if (p.kind === 'stub' || p.kind === 'glass' || p.kind === 'gate') {
    const s = wallSegs(p)[0]!;
    return closestOnSegment(x, y, s[0], s[1], s[2], s[3]);
  }
  return { x: p.x, y: p.y };
}
