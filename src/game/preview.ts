import { H, R } from '../config';
import { subSeed } from '../core/rng';
import type { TableGeom } from '../geom/table';
import { launchFrom, type ShotQ } from '../physics/launch';
import { createWorld, stepWorld, type Ball, type PhysEvent, type World } from '../physics/world';

/**
 * The shot preview: the next shot, played out ahead of time with the real physics on copies of
 * the balls (Free Play and the Toy Box). It shows just enough to plan with: the cue ball's path to
 * its first hit and a little beyond, and where each ball it hits heads off to (and whether it
 * drops). It stops simulating as soon as that much is known, so it usually finishes within the
 * frame the shot changed in, and keeps the last few results for instant answers.
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

/** Never look further ahead than this (seconds of the shot). */
export const PREVIEW_T = 1.5;
/** How far the cue ball's path goes after its first hit, and before any hit at all. */
export const CUE_AFTER = 170;
export const CUE_FREE = 1500;
/** How far the path of each ball the cue ball hits goes. */
export const HIT_LEN = 520;
/** Path points are kept this far apart. */
const STEP_DIST = 4;
const CACHE = 4;

export interface PreviewTrack {
  id: number;
  num: number;
  color: string;
  /** 0 for the cue ball, 1 for a ball it hit (other balls only show up in exhaustive previews). */
  gen: number;
  /** Polylines as flat x, y lists (a portal hop or a black hole starts a new one). */
  segs: number[][];
  /** Index of the first polyline after the cue ball's first hit (segs.length if none). */
  after: number;
  /** Where the path ends (where the ball rests, the hole it dropped into, or where the view stops). */
  end: { x: number; y: number };
  /** Pocket vertex id it dropped into, if it did. */
  drop: number | null;
  /** The path was cut short with the ball still rolling. */
  moving: boolean;
}

export interface Preview {
  key: string;
  tracks: PreviewTrack[];
  /** Where the cue ball is when it first touches a ball (the ghost ball), if it does. */
  contact: { x: number; y: number } | null;
  /** Object balls that would drop (while the preview was watching), with their generation. */
  drops: { num: number; pocket: number; gen: number }[];
  /** The cue ball would drop (along its shown path). */
  scratch: boolean;
  /** Seconds of the shot simulated. */
  span: number;
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
  /** Seconds to look ahead at most. */
  horizon: number;
  /** Follow every ball to the end of the horizon, with no limits (tests and tools). */
  exhaustive?: boolean;
}

/** One ball being followed. */
interface Rec {
  track: PreviewTrack;
  /** The polyline being added to (null between a black hole and its exit). */
  seg: number[] | null;
  /** Path length so far, and how long it may get. */
  len: number;
  limit: number;
  done: boolean;
}

interface Job {
  preview: Preview;
  world: World;
  balls: Ball[];
  starts: { x: number; y: number }[];
  recs: (Rec | null)[];
  exhaustive: boolean;
  horizon: number;
  events: PhysEvent[];
}

export class Previewer {
  /** Most recently used last. */
  private cache: Preview[] = [];
  private job: Job | null = null;
  /** The preview to show: the finished one for the current shot, or the last one while a new one runs. */
  current: Preview | null = null;
  /** Milliseconds spent on the last finished preview. */
  lastCostMs = 0;
  private cost = 0;

  /** The shot a preview is being worked out for (null when idle). */
  get pendingKey(): string | null {
    return this.job?.preview.key ?? null;
  }

  /**
   * Works on the preview for the shot `key` (built only when needed) for at most `budgetMs`.
   * Returns what to show.
   */
  update(key: string, make: () => PreviewInput, budgetMs: number): Preview | null {
    if (this.current?.key !== key) {
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
    const starts = balls.map((b) => ({ x: b.x, y: b.y }));
    const { world } = startShot(balls, input.geom, input.seed, input.stroke, input.shot);
    const preview: Preview = {
      key: input.key,
      tracks: [],
      contact: null,
      drops: [],
      scratch: false,
      span: 0,
      done: false,
    };
    const job: Job = {
      preview,
      world,
      balls,
      starts,
      recs: balls.map(() => null),
      exhaustive: input.exhaustive === true,
      horizon: input.horizon,
      events: [],
    };
    const cue = balls.findIndex((b) => b.kind === 'cue');
    if (cue >= 0) this.follow(job, cue, job.exhaustive ? Infinity : CUE_FREE);
    return job;
  }

  /** Start following ball i from where it is (or where it started, if it has not moved yet). */
  private follow(job: Job, i: number, limit: number): Rec {
    const b = job.balls[i]!;
    const s = job.starts[i]!;
    // A ball just set moving (by a hit this step) has its path begin where it was resting.
    const near = Math.abs(b.x - s.x) + Math.abs(b.y - s.y) < 2 * R;
    const track: PreviewTrack = {
      id: b.id,
      num: b.num,
      color: b.color,
      gen: b.kind === 'cue' ? 0 : 1,
      segs: [],
      after: Infinity,
      end: { x: b.x, y: b.y },
      drop: null,
      moving: false,
    };
    const seg = near ? [s.x, s.y] : [b.x, b.y];
    track.segs.push(seg);
    const rec: Rec = { track, seg, len: 0, limit, done: false };
    job.recs[i] = rec;
    return rec;
  }

  private run(job: Job, more: () => boolean): void {
    const { world, balls, preview } = job;
    while (!preview.done) {
      // Check the clock every few steps (a step is cheaper than reading the clock on some machines).
      for (let k = 0; k < 4 && !preview.done; k++) {
        job.events.length = 0;
        stepWorld(world, H, job.events);
        for (const e of job.events) this.note(job, e);
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i]!;
          if (
            job.exhaustive &&
            !job.recs[i] &&
            b.active &&
            (b.x !== job.starts[i]!.x || b.y !== job.starts[i]!.y)
          ) {
            this.follow(job, i, Infinity).track.gen = b.gen;
          }
          const rec = job.recs[i];
          if (rec && !rec.done && b.active) this.record(rec, b, job.exhaustive);
        }
        preview.span = world.t;
        if (world.stopped || world.t >= job.horizon - 1e-9 || this.seenEnough(job)) preview.done = true;
      }
      if (!more()) break;
    }
  }

  /** Everything the preview shows is settled: the cue ball's path is done, and so is each hit ball's. */
  private seenEnough(job: Job): boolean {
    if (job.exhaustive) return false;
    for (const rec of job.recs) if (rec && !rec.done) return false;
    return true;
  }

  /**
   * Adds the ball's position to its path once it has moved far enough, up to the path's limit. In
   * the focused view a ball that comes to rest ends its path there (being knocked on later is
   * more than the view shows); an exhaustive preview keeps following it.
   */
  private record(rec: Rec, b: Ball, exhaustive: boolean): void {
    const seg = rec.seg;
    if (!seg) return;
    const lx = seg[seg.length - 2]!;
    const ly = seg[seg.length - 1]!;
    const dx = b.x - lx;
    const dy = b.y - ly;
    const d2 = dx * dx + dy * dy;
    if (d2 < STEP_DIST * STEP_DIST) {
      // At rest within the view: the path ends here.
      if (!exhaustive && b.vx === 0 && b.vy === 0) {
        if (d2 > 0) seg.push(b.x, b.y);
        rec.done = true;
        rec.track.end = { x: b.x, y: b.y };
      }
      return;
    }
    const d = Math.sqrt(d2);
    if (rec.len + d >= rec.limit) {
      const f = (rec.limit - rec.len) / d;
      const x = lx + dx * f;
      const y = ly + dy * f;
      seg.push(x, y);
      rec.len = rec.limit;
      rec.done = true;
      rec.track.moving = true;
      rec.track.end = { x, y };
      return;
    }
    seg.push(b.x, b.y);
    rec.len += d;
  }

  private note(job: Job, e: PhysEvent): void {
    const idx = (b: Ball) => job.balls.indexOf(b);
    switch (e.type) {
      case 'ballHit': {
        const cueA = e.a.kind === 'cue';
        const cueB = e.b.kind === 'cue';
        if (!cueA && !cueB) break;
        const ci = idx(cueA ? e.a : e.b);
        const cue = job.recs[ci];
        // Only hits the cue ball makes while it is still being watched count.
        if (!cue || cue.done) break;
        const other = cueA ? e.b : e.a;
        const oi = idx(other);
        if (!job.recs[oi] && other.kind === 'object')
          this.follow(job, oi, job.exhaustive ? Infinity : HIT_LEN);
        if (!job.preview.contact) {
          // The first hit: mark where the cue ball is, and give its path a short tail from here.
          const s = cueA ? 1 : -1;
          const x = e.x - s * e.nx * R;
          const y = e.y - s * e.ny * R;
          job.preview.contact = { x, y };
          if (cue.seg) cue.seg.push(x, y);
          const tail = [x, y];
          cue.seg = tail;
          cue.track.after = cue.track.segs.length;
          cue.track.segs.push(tail);
          if (!job.exhaustive) cue.limit = cue.len + CUE_AFTER;
        }
        break;
      }
      case 'pocketed': {
        const i = idx(e.ball);
        const rec = job.recs[i];
        if (rec && !rec.done) {
          if (rec.seg) rec.seg.push(e.pocket.x, e.pocket.y);
          rec.done = true;
          rec.track.drop = e.pocket.vid;
          rec.track.end = { x: e.pocket.x, y: e.pocket.y };
          if (e.ball.kind === 'cue') job.preview.scratch = true;
        }
        if (e.ball.kind === 'object')
          job.preview.drops.push({ num: e.ball.num, pocket: e.pocket.vid, gen: e.ball.gen });
        break;
      }
      case 'warp': {
        const rec = job.recs[idx(e.ball)];
        if (!rec || rec.done) break;
        if (rec.seg) rec.seg.push(e.fromX, e.fromY);
        rec.seg = [e.x, e.y];
        rec.track.segs.push(rec.seg);
        break;
      }
      case 'swallowed': {
        const rec = job.recs[idx(e.ball)];
        if (!rec || rec.done) break;
        if (rec.seg) rec.seg.push(e.x, e.y);
        rec.seg = null;
        break;
      }
      case 'bloop': {
        const rec = job.recs[idx(e.ball)];
        if (!rec || rec.done) break;
        rec.seg = [e.x, e.y];
        rec.track.segs.push(rec.seg);
        break;
      }
      default:
        break;
    }
  }

  private finish(job: Job): void {
    const { preview, balls, world } = job;
    preview.done = true;
    job.recs.forEach((rec, i) => {
      if (!rec) return;
      const tr = rec.track;
      const b = balls[i]!;
      if ((!rec.done || job.exhaustive) && tr.drop === null) {
        // The view ran out (horizon, or the shot ended) before the path's own limit.
        if (rec.seg && (rec.seg[rec.seg.length - 2] !== b.x || rec.seg[rec.seg.length - 1] !== b.y))
          rec.seg.push(b.x, b.y);
        tr.end = { x: b.x, y: b.y };
        tr.moving = b.active && !world.stopped && (b.vx !== 0 || b.vy !== 0);
      }
      if (job.exhaustive) tr.gen = b.gen;
      // Drop empty polylines, keeping `after` pointing at the same place.
      const kept: number[][] = [];
      let after = Infinity;
      tr.segs.forEach((seg, k) => {
        if (k === tr.after) after = kept.length;
        if (seg.length >= 4) kept.push(seg);
      });
      tr.segs = kept;
      tr.after = Math.min(after, kept.length);
      if (tr.segs.length > 0 || tr.drop !== null) preview.tracks.push(tr);
    });
    this.current = preview;
    this.cache.push(preview);
    if (this.cache.length > CACHE) this.cache.shift();
    this.job = null;
  }
}
