import { SIM_TIMEOUT } from '../src/config';
import { hyp } from '../src/core/vec';
import type { Game } from '../src/game/game';
import { judge } from '../src/game/goals';
import {
  playSolution,
  playStroke,
  startLevel,
  type Solution,
  type SolutionStroke,
} from '../src/game/levels/solution';
import type { LevelDef } from '../src/game/levels/types';
import { canTurn, DIRS } from '../src/game/placement';
import type { Edit } from '../src/game/record';
import { listHandles } from '../src/game/reshape';
import type { Goal } from '../src/game/ruleset';
import { pointInPolygon } from '../src/geom/polygon';
import type { Ball } from '../src/physics/ball';
import type { TurnLog } from '../src/physics/log';

/**
 * The level solver: a beam search over strokes. For each stroke it tries no edit, putting toys
 * down from the tray (with a few facings), and single grabs of every knob and "+" (16 directions,
 * three distances), then pairs of the most promising grabs; each at a spread of dial settings (and
 * English, where the level allows it). Every candidate is scored with an exhaustive preview, which
 * is exactly the real shot; a win is then confirmed by replaying it through the real game.
 */

export interface SolveLimits {
  /** Grab tokens and strokes the solution may use. */
  tokens: number;
  strokes: number;
  /** Only accept solutions earning at least this many stars. */
  stars?: number;
}

export interface SolveOpts {
  dials?: number[];
  english?: [number, number][];
  /** Nodes kept between strokes, and single-grab edits extended with a second grab. */
  beam?: number;
  pairs?: number;
  log?: (s: string) => void;
}

interface Node {
  strokes: SolutionStroke[];
  score: number;
}

interface Outcome {
  win: boolean;
  fail: boolean;
  score: number;
}

const DEFAULT_DIALS = [250, 350, 450, 550, 650, 750, 850, 950];
const DEFAULT_ENGLISH: [number, number][] = [
  [0, 0],
  [0.7, 0],
  [-0.7, 0],
  [0, 0.7],
  [0, -0.7],
];

function replay(def: LevelDef, strokes: SolutionStroke[]): Game | null {
  const g = startLevel(def);
  for (const s of strokes) {
    if (g.phase !== 'plan') return null;
    playStroke(g, s);
  }
  return g.phase === 'plan' ? g : null;
}

function bullseyes(g: Game) {
  return g.table.parts.flatMap((p) => (p.kind === 'bullseye' ? [{ id: p.id, x: p.x, y: p.y, r: p.r }] : []));
}

/** How close a stroke's outcome comes to the goal (bigger is better), when it is not a win. */
function progress(goal: Goal, g: Game, balls: Ball[], log: TurnLog, order: number[]): number {
  const open = g.geom.pockets.filter((p) => p.open);
  const near = (b: Ball) => Math.min(...open.map((p) => hyp(p.x - b.x, p.y - b.y)));
  const objects = balls.filter((b) => b.kind === 'object');
  const live = objects.filter((b) => b.gone === null);
  const cue = balls.find((b) => b.kind === 'cue')!;
  let s = 0;
  switch (goal.kind) {
    case 'clearAll':
      s = 1000 * (objects.length - live.length) - live.reduce((a, b) => a + near(b), 0) / 4;
      break;
    case 'sink': {
      const t = objects.find((b) => b.num === goal.ball);
      s = t ? -near(t) : 0;
      break;
    }
    case 'order': {
      let k = 0;
      while (k < goal.balls.length && order.filter((n) => goal.balls.includes(n))[k] === goal.balls[k]) k++;
      const next = objects.find((b) => b.num === goal.balls[k]);
      s = 1000 * k - (next ? near(next) : 0);
      break;
    }
    case 'combo':
      s = 1000 * log.pots.filter((p) => p.ball !== 0).length - live.reduce((a, b) => a + near(b), 0) / 4;
      break;
    case 'bank': {
      const best = Math.max(0, ...log.pots.filter((p) => p.ball !== 0).map((p) => p.banks));
      s = 300 * best + 200 * Math.max(0, ...live.map((b) => b.banks)) - Math.min(...live.map(near), 999) / 2;
      break;
    }
    case 'spare': {
      const others = live.filter((b) => b.num !== goal.ball);
      s = 1000 * (objects.length - 1 - others.length) - others.reduce((a, b) => a + near(b), 0) / 4;
      break;
    }
    case 'scratch': {
      const targets = g.geom.pockets.filter((p) => !goal.pockets || goal.pockets.includes(p.vid));
      s = -Math.min(...targets.map((p) => hyp(p.x - cue.x, p.y - cue.y)));
      break;
    }
    case 'park': {
      const t = bullseyes(g).find((b) => b.id === goal.bullseye);
      s = t ? -hyp(cue.x - t.x, cue.y - t.y) : 0;
      break;
    }
  }
  if (log.scratch && goal.kind !== 'scratch') s -= 400;
  return s;
}

/** Shoots (in preview) with the current edits at one setting, and judges the result. */
function evaluate(g: Game, def: LevelDef, dial: number, ex: number, ey: number): Outcome {
  g.setDial(dial / 1000);
  if (def.english) g.setEnglish(ex, ey);
  const p = g.previewNow(SIM_TIMEOUT, true);
  const { balls, log } = p.final!;
  const order = [...g.pottedOrder, ...log.pots.filter((q) => q.ball !== 0).map((q) => q.ball)];
  const score = g.score + 1 + (log.scratch ? 1 : 0);
  const v = judge(def.goal, { balls, pottedOrder: order, log, score, shotLimit: def.shots }, bullseyes(g));
  if (v.result === 'win') return { win: true, fail: false, score: 1e9 };
  if (v.result === 'fail') return { win: false, fail: true, score: -1e9 };
  return { win: false, fail: false, score: progress(def.goal, g, balls, log, order) };
}

/** Edit lists for one stroke that add at most one grab (or a toy) to `base`. */
function* moreEdits(g: Game, tokensLeft: number): Generator<Edit> {
  // Toys from the tray (free); facings are tried afterwards for the promising ones.
  for (let item = 0; item < g.tray.length; item++) {
    if (g.tray[item]!.count <= 0) continue;
    const xs = g.table.verts.map((v) => v.x);
    const ys = g.table.verts.map((v) => v.y);
    for (let x = Math.min(...xs) + 60; x <= Math.max(...xs) - 60; x += 70) {
      for (let y = Math.min(...ys) + 60; y <= Math.max(...ys) - 60; y += 70) {
        if (pointInPolygon(x, y, g.geom.poly) && g.canPlace(item, x, y)) yield { op: 'place', item, x, y };
      }
    }
  }
  if (tokensLeft < 1) return;
  for (const h of listHandles(g.table)) {
    if (h.locked) continue;
    const vid = h.kind === 'vertex' ? g.table.verts[h.index]!.id : -1;
    for (const f of [0.35, 0.7, 1]) {
      const r = f * g.reach;
      for (let k = 0; k < DIRS.length; k += 4) {
        const d = DIRS[k]!;
        const path = [h.x, h.y, h.x + (d[0] * r) / 1000, h.y + (d[1] * r) / 1000];
        yield h.kind === 'edge' ? { op: 'grab', vid, edge: h.index, path } : { op: 'grab', vid, path };
      }
    }
  }
}

/** Facings to try for a toy just put down. */
function* turnsFor(g: Game, id: number): Generator<Edit> {
  const p = g.table.parts.find((q) => q.id === id);
  if (!p || !canTurn(p)) return;
  for (let k = 0; k < DIRS.length; k += 9) yield { op: 'turn', id, ks: [k] };
}

export function solve(def: LevelDef, limits: SolveLimits, opts: SolveOpts = {}): Solution | null {
  const dials = opts.dials ?? DEFAULT_DIALS;
  const english = def.english ? (opts.english ?? DEFAULT_ENGLISH) : ([[0, 0]] as [number, number][]);
  const beamSize = opts.beam ?? 8;
  const pairs = opts.pairs ?? 12;
  const log = opts.log ?? (() => {});
  let beam: Node[] = [{ strokes: [], score: 0 }];
  for (let k = 0; k < limits.strokes; k++) {
    const next: Node[] = [];
    for (const node of beam) {
      const g = replay(def, node.strokes);
      if (!g) continue;
      const tokensLeft = limits.tokens - g.tokensSpent;
      // Tries one edit list at every setting; returns the best outcome (and a win, if any).
      const tryEdits = (
        edits: Edit[],
      ): { best: number; win: SolutionStroke | null; stroke: SolutionStroke | null } => {
        g.reset();
        // Only this candidate's own edits (not the resets between candidates).
        const mark = g.edits.length;
        for (const e of edits) g.applyEdit(e);
        const recorded = structuredClone(g.edits.slice(mark));
        const extra = g.tokensSpent > limits.tokens;
        let best = -Infinity;
        let bestStroke: SolutionStroke | null = null;
        if (!extra) {
          for (const dial of dials) {
            for (const [ex, ey] of english) {
              const o = evaluate(g, def, dial, ex, ey);
              const stroke = { edits: recorded, dial, ex, ey };
              if (o.win) return { best: Infinity, win: stroke, stroke };
              if (o.score > best) {
                best = o.score;
                bestStroke = stroke;
              }
            }
          }
        }
        return { best, win: null, stroke: bestStroke };
      };
      const scored: { edits: Edit[]; best: number; stroke: SolutionStroke | null }[] = [];
      const consider = (edits: Edit[]): Solution | null => {
        const r = tryEdits(edits);
        if (r.win) {
          const sol: Solution = { level: def.id, stars: 0, strokes: [...node.strokes, r.win] };
          const end = playSolution(def, sol);
          if (end.phase === 'over' && end.lastOver?.result === 'win') {
            sol.stars = end.lastOver.stars;
            if (sol.stars >= (limits.stars ?? 1)) return sol;
          } else log(`  a predicted win did not replay (stroke ${k + 1}); carrying on`);
        }
        scored.push({ edits, best: r.best, stroke: r.stroke });
        return null;
      };
      const found = consider([]);
      if (found) return found;
      // Single edits, then facings for placed toys and pairs of the best ones.
      const singles: Edit[] = [...moreEdits(g, tokensLeft)];
      g.reset();
      for (const e of singles) {
        const s = consider([e]);
        if (s) return s;
      }
      const top = [...scored].sort((a, b) => b.best - a.best).slice(0, pairs);
      for (const t of top) {
        if (t.edits.length !== 1) continue;
        g.reset();
        for (const e of t.edits) g.applyEdit(e);
        const placedId =
          t.edits[0]!.op === 'place' ? (g.table.parts[g.table.parts.length - 1]?.id ?? -1) : -1;
        const followUps: Edit[] = placedId >= 0 ? [...turnsFor(g, placedId)] : [];
        followUps.push(...moreEdits(g, limits.tokens - g.tokensSpent));
        for (const e of followUps) {
          const s = consider([...t.edits, e]);
          if (s) return s;
        }
      }
      for (const sc of scored)
        if (sc.stroke) next.push({ strokes: [...node.strokes, sc.stroke], score: sc.best });
      log(`  stroke ${k + 1}: ${scored.length} candidates from a node scoring ${node.score.toFixed(0)}`);
    }
    // Keep the best few, skipping near-duplicates.
    next.sort((a, b) => b.score - a.score);
    const kept: Node[] = [];
    for (const n of next) {
      if (kept.length >= beamSize) break;
      if (kept.some((q) => Math.abs(q.score - n.score) < 0.5)) continue;
      kept.push(n);
    }
    beam = kept;
    if (!beam.length) break;
  }
  return null;
}
