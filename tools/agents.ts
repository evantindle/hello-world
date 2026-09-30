import { H } from '../src/config';
import type { Rng } from '../src/core/rng';
import { moveVertex, type ReshapeHost } from '../src/game/reshape';
import type { Game } from '../src/game/game';
import { quantizeShot } from '../src/game/shot';
import { castGuide } from '../src/geom/raycast';
import { buildGeom, cloneTable, type Table } from '../src/geom/table';
import { launchFrom } from '../src/physics/launch';
import { createWorld, stepWorld, type Ball, type PhysEvent } from '../src/physics/world';

/** A bend: vertex id and where to drag it. */
export type Move = [vid: number, x: number, y: number];

export interface Plan {
  moves: Move[];
  power: number;
  ex: number;
  ey: number;
}

/** Plays out a shot headless and scores it: balls potted, minus a scratch. */
export function evalShot(
  table: Table,
  balls: Ball[],
  hunger: number,
  aim: number,
  power: number,
  ex = 0,
  ey = 0,
): number {
  const geom = buildGeom(table, hunger);
  const bs = balls.map((b) => ({ ...b }));
  const cue = bs.find((b) => b.kind === 'cue')!;
  launchFrom(cue, quantizeShot(aim, power, ex, ey));
  const w = createWorld(bs, geom);
  const ev: PhysEvent[] = [];
  for (let i = 0; i < 4000 && !w.stopped; i++) stepWorld(w, H, ev);
  let pots = 0;
  let scratch = false;
  for (const p of w.log.pots) if (p.ball === 0) scratch = true;
  else pots++;
  return pots - (scratch ? 1.2 : 0);
}

function hostOf(g: Game): ReshapeHost {
  return {
    table: cloneTable(g.table),
    geom: g.geom,
    balls: g.balls.map((b) => ({ ...b })),
    budget: g.budget,
    hunger: g.hunger,
  };
}

function randomBends(host: ReshapeHost, rng: Rng, count: number, reach: number): Move[] {
  const moves: Move[] = [];
  for (let k = 0; k < count; k++) {
    const v = host.table.verts[rng.int(host.table.verts.length)]!;
    const tx = v.x + rng.range(-reach, reach);
    const ty = v.y + rng.range(-reach, reach);
    moveVertex(host, v.id, tx, ty);
    moves.push([v.id, tx, ty]);
  }
  return moves;
}

const ENGLISH: [number, number][] = [
  [0, 0],
  [0, 0.9],
  [0, -0.9],
  [0.9, 0],
  [-0.9, 0],
];

/** Sees the future: tries bends x powers (x English, if allowed) with full physics rollouts. */
export function planOracle(g: Game, rng: Rng, candidates: number, english: boolean): Plan {
  let best: Plan & { v: number } = { v: -Infinity, moves: [], power: 0.6, ex: 0, ey: 0 };
  for (let c = 0; c < candidates; c++) {
    const host = hostOf(g);
    const moves = c === 0 ? [] : randomBends(host, rng, 1 + rng.int(2), 250);
    for (const p of [0.35, 0.65, 1]) {
      for (const [ex, ey] of english ? ENGLISH : [[0, 0] as [number, number]]) {
        const v = evalShot(host.table, host.balls, g.hunger, g.aim, p, ex, ey);
        if (v > best.v) best = { v, moves, power: p, ex, ey };
      }
    }
  }
  return best;
}

/** A thoughtful human: reads only the on-screen guide, tries a few bends, keeps the best-looking. */
export function planGuide(g: Game, rng: Rng, candidates: number): Plan {
  let best = { v: -Infinity, moves: [] as Move[] };
  for (let c = 0; c < candidates; c++) {
    const host = hostOf(g);
    const moves = c === 0 ? [] : randomBends(host, rng, 1 + rng.int(2), 250);
    const cue = host.balls[0]!;
    const gd = castGuide(host.geom, host.balls, cue, Math.cos(g.aim), Math.sin(g.aim));
    let v = rng.range(0, 0.25); // humans misjudge
    if (gd.kind === 'hole' || gd.bounceKind === 'hole') v -= 1;
    if (gd.target) {
      v += 0.4;
      const t = gd.target;
      const g2 = castGuide(host.geom, host.balls, t.ball, t.dx, t.dy);
      if (g2.kind === 'hole') v += 1;
      else if (g2.bounceKind === 'hole') v += 0.5;
    } else if (gd.bounceKind === 'ball') v += 0.2;
    if (v > best.v) best = { v, moves };
  }
  return { moves: best.moves, power: rng.range(0.45, 0.95), ex: 0, ey: 0 };
}

/** Acts a plan out through the real game API: drag each vertex, set dial and English, shoot. */
export function perform(g: Game, plan: Plan): void {
  for (const [vid, tx, ty] of plan.moves) {
    const v = g.table.verts.find((q) => q.id === vid);
    if (!v) continue;
    const h = g.hitHandle(v.x, v.y, 5);
    if (h && g.beginDrag(h, v.x, v.y)) {
      g.dragTo(tx, ty);
      g.endDrag();
    }
  }
  g.setEnglish(plan.ex, plan.ey);
  g.shoot(plan.power);
}
