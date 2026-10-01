import { H } from '../config';
import { subSeed } from '../core/rng';
import type { TableGeom } from '../geom/table';
import { launchFrom, type ShotQ } from '../physics/launch';
import { createWorld, stepWorld, type Ball, type PhysEvent, type World } from '../physics/world';

/**
 * The chain preview: the next shot, played out ahead of time with the real physics on copies of
 * the balls, so a player can see where everything would go (Free Play and the Toy Box). It runs a
 * few milliseconds per frame and keeps the last few results, so turning the dial back and forth or
 * undoing an edit shows the answer at once.
 */

/**
 * Starts a shot exactly the way the game does (shared by the game, the preview and replays, so they
 * all agree): a fresh world seeded for this stroke, then the cue ball launched.
 */
export function startShot(
  balls: Ball[],
  geom: TableGeom,
  seed: number,
  stroke: number,
  shot: ShotQ,
): { world: World; dx: number; dy: number; speed: number } {
  const world = createWorld(balls, geom, subSeed(seed, 'world', stroke));
  const launch = launchFrom(
    balls.find((b) => b.kind === 'cue')!,
    shot,
  );
  return { world, ...launch };
}

/** Seconds of the shot the preview shows: the whole first act, or less while something is dragged. */
export const PREVIEW_T = 1.5;
export const PREVIEW_T_DRAG = 0.8;
/** Path points are kept this far apart. */
const STEP_DIST = 4;
/** Deepest collision generation that gets a path (the cue ball is 0, a ball it hits is 1...). */
export const PREVIEW_GEN = 3;
const CACHE = 4;

export interface PreviewTrack {
  id: number;
  num: number;
  color: string;
  /** Collision generation: 0 for the cue ball, k+1 for a ball hit by generation k, 255 if only a
   * toy moved it. */
  gen: number;
  /** Polylines as flat x, y lists (a portal hop or a black hole starts a new one). */
  segs: number[][];
  /** Where the ball is when the preview stops (where it rests, or the hole it dropped into). */
  end: { x: number; y: number };
  /** Pocket vertex id it dropped into, if it did. */
  drop: number | null;
  /** Still rolling when the preview stops. */
  moving: boolean;
}

export interface Preview {
  key: string;
  tracks: PreviewTrack[];
  /** Ball-on-ball contacts (the generation of the deeper ball). */
  contacts: { x: number; y: number; gen: number }[];
  /** Object balls that would drop, by pocket vertex id. */
  drops: { num: number; pocket: number }[];
  /** The cue ball would drop. */
  scratch: boolean;
  /** Seconds of the shot covered. */
  horizon: number;
  done: boolean;
}

/** What the preview needs to know about the shot to come. */
export interface PreviewInput {
  key: string;
  geom: TableGeom;
  balls: readonly Ball[];
  seed: number;
  /** The stroke number the shot will have (the world's random stream is seeded with it). */
  stroke: number;
  shot: ShotQ;
  horizon: number;
}

interface Job {
  preview: Preview;
  world: World;
  balls: Ball[];
  /** Where each ball was when the shot began. */
  starts: { x: number; y: number }[];
  tracks: (PreviewTrack | null)[];
  /** Per ball: an open polyline to add points to. */
  open: (number[] | null)[];
  events: PhysEvent[];
}

export class Previewer {
  /** Most recently used last. */
  private cache: Preview[] = [];
  private job: Job | null = null;
  /** The preview to show: the finished one for the current shot, or the last one while a new one runs. */
  current: Preview | null = null;
  /** Timing, for the performance budget: milliseconds spent on the last finished preview. */
  lastCostMs = 0;
  private cost = 0;

  /** The shot the preview is being worked out for (null when idle). */
  get pendingKey(): string | null {
    return this.job?.preview.key ?? null;
  }

  /**
   * Works on the preview for `input` (built only when needed) for at most `budgetMs`. Returns what
   * to show.
   */
  update(key: string, make: () => PreviewInput, budgetMs: number): Preview | null {
    if (this.current?.key !== key || !this.current.done) {
      const hit = this.cache.find((p) => p.key === key);
      if (hit) {
        this.touch(hit);
        this.current = hit;
        this.job = null;
      } else if (this.job?.preview.key !== key) {
        this.job = this.begin(make());
        this.cost = 0;
      }
    }
    if (this.job) {
      const t0 = performance.now();
      this.run(this.job, () => performance.now() - t0 < budgetMs);
      this.cost += performance.now() - t0;
      if (this.job.preview.done) {
        this.finish(this.job);
        this.lastCostMs = this.cost;
      }
    }
    return this.current;
  }

  /** The whole preview at once (tests, tools). */
  compute(input: PreviewInput): Preview {
    const job = this.begin(input);
    this.run(job, () => true);
    this.finish(job);
    return job.preview;
  }

  clear(): void {
    this.cache = [];
    this.job = null;
    this.current = null;
  }

  private touch(p: Preview): void {
    this.cache = this.cache.filter((q) => q !== p);
    this.cache.push(p);
  }

  private begin(input: PreviewInput): Job {
    const balls = input.balls.map((b) => ({ ...b }));
    const { world } = startShot(balls, input.geom, input.seed, input.stroke, input.shot);
    const preview: Preview = {
      key: input.key,
      tracks: [],
      contacts: [],
      drops: [],
      scratch: false,
      horizon: input.horizon,
      done: false,
    };
    return {
      preview,
      world,
      balls,
      starts: balls.map((b) => ({ x: b.x, y: b.y })),
      tracks: balls.map(() => null),
      open: balls.map(() => null),
      events: [],
    };
  }

  private run(job: Job, more: () => boolean): void {
    const { world, balls, preview } = job;
    // Check the clock every few steps (a step is far cheaper than a clock read on some machines).
    while (!preview.done) {
      for (let k = 0; k < 4 && !preview.done; k++) {
        job.events.length = 0;
        stepWorld(world, H, job.events);
        for (const e of job.events) this.note(job, e);
        balls.forEach((b, i) => {
          if (b.active) this.record(job, b, i);
        });
        if (world.stopped || world.t >= preview.horizon - 1e-9) preview.done = true;
      }
      if (!more()) break;
    }
  }

  private trackFor(job: Job, b: Ball, i: number): PreviewTrack {
    let tr = job.tracks[i];
    if (!tr) {
      tr = {
        id: b.id,
        num: b.num,
        color: b.color,
        gen: b.gen,
        segs: [],
        end: { x: b.x, y: b.y },
        drop: null,
        moving: true,
      };
      job.tracks[i] = tr;
    }
    return tr;
  }

  /** Adds the ball's position to its path once it has moved far enough. */
  private record(job: Job, b: Ball, i: number): void {
    let seg = job.open[i];
    if (!seg) {
      // A ball that has not moved has no path yet; one that just started begins where it was. (A
      // path that ended, in a black hole, picks up again when the ball comes back out.)
      if (job.tracks[i]) return;
      const s = job.starts[i]!;
      if (b.x === s.x && b.y === s.y) return;
      seg = [s.x, s.y];
      job.open[i] = seg;
      this.trackFor(job, b, i).segs.push(seg);
    }
    const lx = seg[seg.length - 2]!;
    const ly = seg[seg.length - 1]!;
    const dx = b.x - lx;
    const dy = b.y - ly;
    if (dx * dx + dy * dy >= STEP_DIST * STEP_DIST) seg.push(b.x, b.y);
  }

  private note(job: Job, e: PhysEvent): void {
    const idx = (b: Ball) => job.balls.indexOf(b);
    switch (e.type) {
      case 'ballHit': {
        const gen = Math.max(e.a.gen === 255 ? 0 : e.a.gen, e.b.gen === 255 ? 0 : e.b.gen);
        if (gen <= PREVIEW_GEN) job.preview.contacts.push({ x: e.x, y: e.y, gen });
        break;
      }
      case 'pocketed': {
        const i = idx(e.ball);
        const tr = this.trackFor(job, e.ball, i);
        const seg = job.open[i];
        if (seg) seg.push(e.pocket.x, e.pocket.y);
        job.open[i] = null;
        tr.drop = e.pocket.vid;
        tr.end = { x: e.pocket.x, y: e.pocket.y };
        if (e.ball.kind === 'cue') job.preview.scratch = true;
        else job.preview.drops.push({ num: e.ball.num, pocket: e.pocket.vid });
        break;
      }
      case 'warp': {
        const i = idx(e.ball);
        const seg = job.open[i];
        if (seg) seg.push(e.fromX, e.fromY);
        const next = [e.x, e.y];
        job.open[i] = next;
        this.trackFor(job, e.ball, i).segs.push(next);
        break;
      }
      case 'swallowed': {
        const i = idx(e.ball);
        const seg = job.open[i];
        if (seg) seg.push(e.x, e.y);
        job.open[i] = null;
        break;
      }
      case 'bloop': {
        const i = idx(e.ball);
        const next = [e.x, e.y];
        job.open[i] = next;
        this.trackFor(job, e.ball, i).segs.push(next);
        break;
      }
      default:
        break;
    }
  }

  private finish(job: Job): void {
    const { preview, balls, world } = job;
    preview.done = true;
    job.tracks.forEach((tr, i) => {
      if (!tr) return;
      const b = balls[i]!;
      tr.gen = b.gen;
      if (tr.drop === null) {
        tr.end = { x: b.x, y: b.y };
        tr.moving = b.active && !world.stopped && (b.vx !== 0 || b.vy !== 0);
        const seg = job.open[i];
        if (seg && (seg[seg.length - 2] !== b.x || seg[seg.length - 1] !== b.y)) seg.push(b.x, b.y);
      } else tr.moving = false;
      tr.segs = tr.segs.filter((s) => s.length >= 4);
      if (tr.segs.length > 0 || tr.drop !== null) preview.tracks.push(tr);
    });
    this.current = preview;
    this.cache.push(preview);
    if (this.cache.length > CACHE) this.cache.shift();
    this.job = null;
  }
}
