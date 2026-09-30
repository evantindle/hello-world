import {
  BUDGET,
  CHARGE_TIME,
  H,
  MAX_HUNGER,
  PAR,
  RESOLVE_DELAY,
  RESPAWN_TIME,
  SLOWMO_MAX,
  SLOWMO_SCALE,
  STRIKE_HOLD,
  STRIKE_LUNGE,
  TAP_CANCEL,
} from '../config';
import { damp } from '../core/easing';
import { Emitter } from '../core/emitter';
import { randomSeed, rngFor, subSeed } from '../core/rng';
import { clamp01, hyp, TAU, wrapTau } from '../core/vec';
import { castGuide, type Guide } from '../geom/raycast';
import { buildGeom, cloneTable, createTable, type Pocket, type Table, type TableGeom } from '../geom/table';
import { launchFrom } from '../physics/launch';
import { createWorld, stepWorld, type Ball, type PhysEvent, type World } from '../physics/world';
import {
  DragSession,
  hitHandle,
  removeBend,
  type BlockReason,
  type Handle,
  type MoveResult,
  type ReshapeHost,
} from './reshape';
import { findRespawnSpot, loadBest, rackBalls, rankFor, saveBest, type Rank } from './rules';
import { cloneLog, type TurnRecord } from './record';
import { V1_RULES, type Ruleset } from './ruleset';
import { hashBoard, snapState } from './serialize';
import { quantizeShot, type ShotQ } from './shot';
import { Spin } from './spin';

export type Phase = 'title' | 'spin' | 'plan' | 'strike' | 'sim' | 'resolve' | 'respawn' | 'over';

export interface TurnResult {
  potted: Ball[];
  scratch: boolean;
  streak: number;
  timedOut: boolean;
  shots: number;
  score: number;
  left: number;
}

export interface GameOverInfo {
  score: number;
  shots: number;
  penalties: number;
  par: number;
  best: number | null;
  isBest: boolean;
  rank: Rank;
  bestStreak: number;
}

export interface GameEvents {
  newGame: { seed: number };
  phase: { from: Phase; to: Phase };
  spinTick: { speed: number; count: number };
  spinLand: { angle: number };
  chargeStart: { power: number };
  chargeCancel: { reason: 'tap' | 'drag' };
  strike: { power: number; x: number; y: number; dx: number; dy: number; speed: number };
  phys: PhysEvent;
  dragStart: { vid: number; inserted: boolean; x: number; y: number };
  drag: { vid: number; result: MoveResult; x: number; y: number };
  dragEnd: { vid: number; dropped: boolean };
  blocked: { vid: number; reason: BlockReason; x: number; y: number };
  bendRemoved: { x: number; y: number };
  undo: Record<string, never>;
  poke: { x: number; y: number };
  turnResult: TurnResult;
  respawnStart: { fromX: number; fromY: number; toX: number; toY: number };
  respawnLand: { x: number; y: number };
  hunger: { level: number; prev: number };
  slowmo: { on: boolean };
  gameOver: GameOverInfo;
}

interface Snapshot {
  table: Table;
  balls: { x: number; y: number; active: boolean }[];
}

export interface GameOptions {
  seed?: number;
  /** Read/write the best score in localStorage (off in tests). */
  persist?: boolean;
  /** Defaults to the original v1 rules. */
  rules?: Ruleset;
}

/** Everything a new game needs: its rules and seed, and optionally a starting table and balls. */
export interface GameSetup {
  rules: Ruleset;
  seed: number;
  /** Starting table (cloned); default: the v1 rectangle. */
  table?: Table;
  /** Starting balls (cloned); default: the v1 rack, shuffled by the seed. */
  balls?: Ball[];
  levelId?: string;
}

export class Game implements ReshapeHost {
  readonly events = new Emitter<GameEvents>();
  rules: Ruleset = V1_RULES;
  levelId: string | null = null;
  seed = 0;
  phase: Phase = 'title';
  /** Seconds in the current phase (world time during the sim, real time otherwise). */
  phaseT = 0;
  table: Table = createTable();
  geom: TableGeom = buildGeom(this.table);
  balls: Ball[] = [];
  world: World;
  budget = BUDGET;
  /** Grab tokens left (token-limited rulesets); Infinity otherwise. */
  tokens = Infinity;
  /** Pocket hunger 0..MAX_HUNGER: grows with every dry shot, resets when a ball drops. */
  hunger = 0;
  readonly spin = new Spin();
  /** Shot direction in radians; the stick sits on the opposite side of the cue ball. */
  aim = Math.PI;
  /** Where the current spin will land, in [0, TAU): the aim is set to exactly this. */
  spinTarget = Math.PI;
  charging = false;
  chargeT = 0;
  strikePower = 0;
  /** The last shot, quantized (what replays and shared links store). */
  shot: ShotQ | null = null;
  /** Every stroke of this game so far, recorded. */
  history: TurnRecord[] = [];
  private pending: Omit<TurnRecord, 'log' | 'postHash'> | null = null;
  shots = 0;
  penalties = 0;
  streak = 0;
  bestStreak = 0;
  best: number | null = null;
  /** Balls pocketed during the current shot. */
  potted: Ball[] = [];
  scratched = false;
  scratchPocket: Pocket | null = null;
  timedOut = false;
  respawn: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
  timeScale = 1;
  slowmo = false;
  slowmoLeft = SLOWMO_MAX;
  /** Debug/test hook: the next spin lands here instead of at random. */
  forcedAngle: number | null = null;
  drag: DragSession | null = null;
  lastOver: GameOverInfo | null = null;
  private snapshot: Snapshot | null = null;
  /** Budget and tokens at the start of the plan phase (undo restores them). */
  private planBudget = BUDGET;
  private planTokens = Infinity;
  /** Something was bent since the plan phase began (or since the last undo). */
  private edited = false;
  private lastSetup: GameSetup | null = null;
  private acc = 0;
  private evs: PhysEvent[] = [];
  private readonly persist: boolean;

  constructor(opts: GameOptions = {}) {
    this.persist = opts.persist ?? false;
    if (this.persist) this.best = loadBest();
    this.setup({ rules: opts.rules ?? V1_RULES, seed: opts.seed ?? randomSeed() });
    this.world = createWorld(this.balls, this.geom);
  }

  // ------------------------------------------------------------------ queries

  get cue(): Ball {
    return this.balls[0]!;
  }

  get score(): number {
    return this.shots + this.penalties;
  }

  get par(): number {
    return this.rules.par ?? PAR;
  }

  /** The angle the NEXT stroke will spin to, when the rules make it knowable (Classic). */
  get nextAngle(): number | null {
    return this.angleFor(this.shots + 1, false);
  }

  get objectsLeft(): number {
    let n = 0;
    for (const b of this.balls) if (b.kind === 'object' && b.active) n++;
    return n;
  }

  /** Charge level 0..1 while holding the shot. */
  get power(): number {
    return clamp01(this.chargeT / CHARGE_TIME);
  }

  get canReshape(): boolean {
    return this.phase === 'plan' && !this.charging;
  }

  get canUndo(): boolean {
    return this.canReshape && this.snapshot !== null && this.edited;
  }

  guide(): Guide {
    return castGuide(this.geom, this.balls, this.cue, Math.cos(this.aim), Math.sin(this.aim));
  }

  // ------------------------------------------------------------------ flow

  private setup(s: GameSetup): void {
    // Wind down anything in flight so listeners (sounds, vignette) are told it stopped.
    if (this.drag) this.endDrag();
    if (this.charging) this.cancelCharge();
    if (this.slowmo) this.setSlowmo(false);
    this.lastSetup = s;
    this.history = [];
    this.pending = null;
    this.rules = s.rules;
    this.levelId = s.levelId ?? null;
    this.seed = s.seed >>> 0;
    this.table = s.table ? cloneTable(s.table) : createTable();
    this.hunger = 0;
    this.geom = buildGeom(this.table, this.hunger);
    this.balls = s.balls ? s.balls.map((b) => ({ ...b })) : rackBalls(rngFor(this.seed, 'rack'));
    this.world = createWorld(this.balls, this.geom);
    const lim = this.rules.reshape;
    this.budget = lim.kind === 'budget' ? lim.perTurn : Infinity;
    this.tokens = lim.kind === 'tokens' ? lim.tokens : Infinity;
    this.shots = 0;
    this.penalties = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.potted = [];
    this.scratched = false;
    this.respawn = null;
    this.slowmo = false;
    this.timeScale = 1;
    this.slowmoLeft = SLOWMO_MAX;
    this.charging = false;
    this.chargeT = 0;
    this.drag = null;
    this.snapshot = null;
    this.aim = Math.PI;
    this.lastOver = null;
    this.events.emit('newGame', { seed: this.seed });
  }

  /** Title screen -> first spin. */
  start(): void {
    if (this.phase === 'title') this.enter('spin');
  }

  /** A new game from the given setup, straight into the first spin. */
  load(s: GameSetup): void {
    this.setup(s);
    this.enter('spin');
  }

  /** The same kind of game again (same rules and layout), with a new seed unless given one. */
  restart(seed?: number): void {
    const last = this.lastSetup ?? { rules: this.rules, seed: 0 };
    this.load({ ...last, seed: seed ?? randomSeed() });
  }

  /** Stroke `k`'s landing angle: a level's sequence, or one independent random draw per stroke. */
  private angleFor(k: number, draw = true): number | null {
    const a = this.rules.angles;
    if (a.kind === 'sequence' && a.deg.length > 0) {
      const deg = a.deg[k % a.deg.length]!;
      return wrapTau((deg * Math.PI) / 180);
    }
    return draw ? rngFor(this.seed, 'spin', k).range(0, TAU) : null;
  }

  private enter(to: Phase): void {
    const from = this.phase;
    this.phase = to;
    this.phaseT = 0;
    switch (to) {
      case 'spin': {
        // One independent draw per stroke: forcing an angle (tests) or scratching never shifts
        // the spins that follow.
        const drawn = this.angleFor(this.shots)!;
        const target = this.forcedAngle ?? drawn;
        this.forcedAngle = null;
        this.spinTarget = wrapTau(target);
        this.spin.start(this.aim, this.spinTarget, 3 + rngFor(this.seed, 'turns', this.shots).int(3));
        break;
      }
      case 'plan':
        if (this.rules.reshape.kind === 'budget') this.budget = this.rules.reshape.perTurn;
        this.planBudget = this.budget;
        this.planTokens = this.tokens;
        this.edited = false;
        this.charging = false;
        this.chargeT = 0;
        this.snapshot = this.takeSnapshot();
        break;
      case 'strike':
        this.shots++;
        break;
      case 'sim': {
        this.world = createWorld(this.balls, this.geom, subSeed(this.seed, 'world', this.shots));
        this.acc = 0;
        this.potted = [];
        this.scratched = false;
        this.scratchPocket = null;
        this.timedOut = false;
        const cue = this.cue;
        this.shot = quantizeShot(this.aim, this.strikePower);
        this.pending = { stroke: this.shots, aim: this.aim, shot: this.shot, pre: snapState(this) };
        const { dx, dy, speed } = launchFrom(cue, this.shot);
        this.events.emit('strike', { power: this.strikePower, x: cue.x, y: cue.y, dx, dy, speed });
        break;
      }
      case 'respawn': {
        const cue = this.cue;
        const hole = this.scratchPocket ?? { x: cue.x, y: cue.y };
        const spot = findRespawnSpot(rngFor(this.seed, 'respawn', this.shots), this.geom, this.balls, cue.id);
        this.respawn = { fromX: hole.x, fromY: hole.y, toX: spot.x, toY: spot.y };
        cue.x = spot.x;
        cue.y = spot.y;
        cue.vx = 0;
        cue.vy = 0;
        this.events.emit('respawnStart', this.respawn);
        break;
      }
      case 'over':
        this.finish();
        break;
      default:
        break;
    }
    this.events.emit('phase', { from, to });
  }

  /** Advance by one frame of real time. */
  update(dtReal: number): void {
    const target = this.slowmo ? SLOWMO_SCALE : 1;
    this.timeScale = damp(this.timeScale, target, this.slowmo ? 16 : 6, dtReal);
    if (Math.abs(this.timeScale - target) < 0.003) this.timeScale = target;
    const dt = dtReal * this.timeScale;

    switch (this.phase) {
      case 'spin': {
        this.phaseT += dtReal;
        const ticks = this.spin.update(dtReal);
        this.aim = this.spin.angle;
        if (ticks > 0) this.events.emit('spinTick', { speed: this.spin.speed, count: ticks });
        if (this.spin.done) {
          this.aim = this.spinTarget;
          this.events.emit('spinLand', { angle: this.aim });
          this.enter('plan');
        }
        break;
      }
      case 'plan':
        this.phaseT += dtReal;
        if (this.charging) this.chargeT += dtReal;
        break;
      case 'strike':
        this.phaseT += dtReal;
        if (this.phaseT >= STRIKE_HOLD + STRIKE_LUNGE) this.enter('sim');
        break;
      case 'sim':
        this.phaseT += dt;
        this.updateSim(dt, dtReal);
        break;
      case 'resolve':
        this.phaseT += dtReal;
        if (this.phaseT >= RESOLVE_DELAY) this.resolveTurn();
        break;
      case 'respawn':
        this.phaseT += dtReal;
        if (this.phaseT >= RESPAWN_TIME) {
          const cue = this.cue;
          cue.active = true;
          this.respawn = null;
          this.events.emit('respawnLand', { x: cue.x, y: cue.y });
          this.nextTurn();
        }
        break;
      default:
        this.phaseT += dtReal;
        break;
    }
  }

  private updateSim(dt: number, dtReal: number): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= H && steps < 48) {
      this.evs.length = 0;
      stepWorld(this.world, H, this.evs);
      for (const e of this.evs) this.onPhys(e);
      this.acc -= H;
      steps++;
      if (this.world.stopped) {
        if (this.slowmo) this.setSlowmo(false);
        if (this.pending) {
          const postHash = hashBoard(this.table, this.balls);
          this.history.push({ ...this.pending, log: cloneLog(this.world.log), postHash });
          this.pending = null;
        }
        this.enter('resolve');
        return;
      }
    }
    this.updateSlowmo(dtReal);
  }

  private onPhys(e: PhysEvent): void {
    if (e.type === 'pocketed') {
      this.potted.push(e.ball);
      if (e.ball.kind === 'cue') {
        this.scratched = true;
        this.scratchPocket = e.pocket;
      }
    } else if (e.type === 'stopped' && e.timedOut) {
      this.timedOut = true;
    }
    this.events.emit('phys', e);
  }

  /**
   * Bullet time when the very last object ball is about to drop: its straight-line path passes
   * through a hole it will reach within half a second (or it is already being slurped).
   */
  private updateSlowmo(dtReal: number): void {
    let want = false;
    if (this.slowmoLeft > 0 && this.objectsLeft === 1) {
      const b = this.balls.find((o) => o.kind === 'object' && o.active)!;
      const sp = hyp(b.vx, b.vy);
      if (sp > 25) {
        for (const p of this.geom.pockets) {
          if (!p.open) continue;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const along = (dx * b.vx + dy * b.vy) / sp;
          if (along <= 0) continue;
          const perp = Math.abs(dx * b.vy - dy * b.vx) / sp;
          const soon = along / sp < 0.5 && along < 480;
          const slurping = hyp(dx, dy) < p.sr;
          if ((perp < p.r * 1.3 && soon) || slurping) {
            want = true;
            break;
          }
        }
      }
    }
    if (want) this.slowmoLeft -= dtReal;
    if (want !== this.slowmo) this.setSlowmo(want);
  }

  private setSlowmo(on: boolean): void {
    this.slowmo = on;
    this.events.emit('slowmo', { on });
  }

  private resolveTurn(): void {
    const potted = this.potted.filter((b) => b.kind === 'object');
    if (potted.length > 0) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }
    if (this.scratched) this.penalties++;
    const prevHunger = this.hunger;
    if (this.rules.hunger) this.hunger = potted.length > 0 ? 0 : Math.min(MAX_HUNGER, this.hunger + 1);
    if (this.hunger !== prevHunger) {
      this.geom = buildGeom(this.table, this.hunger);
      this.events.emit('hunger', { level: this.hunger, prev: prevHunger });
    }
    this.events.emit('turnResult', {
      potted,
      scratch: this.scratched,
      streak: this.streak,
      timedOut: this.timedOut,
      shots: this.shots,
      score: this.score,
      left: this.objectsLeft,
    });
    if (this.scratched && this.objectsLeft > 0) this.enter('respawn');
    else this.nextTurn();
  }

  private nextTurn(): void {
    this.enter(this.objectsLeft === 0 ? 'over' : 'spin');
  }

  private finish(): void {
    const score = this.score;
    const isBest = this.best === null || score < this.best;
    if (isBest) {
      this.best = score;
      if (this.persist) saveBest(score);
    }
    const info: GameOverInfo = {
      score,
      shots: this.shots,
      penalties: this.penalties,
      par: this.par,
      best: this.best,
      isBest,
      rank: rankFor(score, this.par),
      bestStreak: this.bestStreak,
    };
    this.lastOver = info;
    this.events.emit('gameOver', info);
  }

  // ------------------------------------------------------------------ player input

  skipSpin(): void {
    if (this.phase === 'spin') this.spin.fastForward();
  }

  beginCharge(): boolean {
    if (this.phase !== 'plan' || this.charging) return false;
    if (this.drag) this.endDrag();
    this.charging = true;
    this.chargeT = 0;
    this.events.emit('chargeStart', { power: 0 });
    return true;
  }

  releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    if (this.chargeT < TAP_CANCEL) {
      this.chargeT = 0;
      this.events.emit('chargeCancel', { reason: 'tap' });
      return;
    }
    this.strikePower = this.power;
    this.enter('strike');
  }

  /** Abort a charge without shooting (pointer cancelled, window lost focus). */
  cancelCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    this.chargeT = 0;
    this.events.emit('chargeCancel', { reason: 'drag' });
  }

  /** Test/demo helper: charge to `power` (0..1) and let rip. */
  shoot(power: number): boolean {
    if (!this.beginCharge()) return false;
    this.chargeT = Math.max(TAP_CANCEL, clamp01(power) * CHARGE_TIME);
    this.releaseCharge();
    return true;
  }

  undo(): boolean {
    if (!this.canReshape || !this.snapshot) return false;
    if (this.drag) this.endDrag();
    const s = this.snapshot;
    this.table = cloneTable(s.table);
    this.geom = buildGeom(this.table, this.hunger);
    this.balls.forEach((b, i) => {
      const p = s.balls[i]!;
      b.x = p.x;
      b.y = p.y;
      b.active = p.active;
      b.vx = 0;
      b.vy = 0;
    });
    this.budget = this.planBudget;
    this.tokens = this.planTokens;
    this.edited = false;
    this.events.emit('undo', {});
    return true;
  }

  hitHandle(x: number, y: number, radius: number): Handle | null {
    return this.canReshape ? hitHandle(this.table, x, y, radius) : null;
  }

  beginDrag(h: Handle, px: number, py: number): boolean {
    if (!this.canReshape || this.drag) return false;
    const s = DragSession.begin(this, h, px, py);
    if (!s) return false;
    this.drag = s;
    this.events.emit('dragStart', { vid: s.vid, inserted: s.inserted, x: px, y: py });
    return true;
  }

  dragTo(px: number, py: number): MoveResult | null {
    const s = this.drag;
    if (!s) return null;
    const r = s.move(this, px, py);
    if (r.applied > 0) this.edited = true;
    const v = this.table.verts.find((q) => q.id === s.vid);
    if (v) {
      if (r.applied > 0) this.events.emit('drag', { vid: s.vid, result: r, x: v.x, y: v.y });
      if (r.blocked) this.events.emit('blocked', { vid: s.vid, reason: r.blocked, x: v.x, y: v.y });
    }
    return r;
  }

  endDrag(): void {
    const s = this.drag;
    if (!s) return;
    this.drag = null;
    const dropped = s.end(this);
    this.events.emit('dragEnd', { vid: s.vid, dropped });
  }

  removeBendAt(vid: number): boolean {
    if (!this.canReshape) return false;
    const v = this.table.verts.find((q) => q.id === vid);
    if (!v || v.pocket) return false;
    const x = v.x;
    const y = v.y;
    const r = removeBend(this, vid);
    if (r.removed) {
      this.edited = true;
      this.events.emit('bendRemoved', { x, y });
    }
    else if (r.blocked) this.events.emit('blocked', { vid, reason: r.blocked, x, y });
    return r.removed;
  }

  poke(x: number, y: number): void {
    this.events.emit('poke', { x, y });
  }

  private takeSnapshot(): Snapshot {
    return {
      table: cloneTable(this.table),
      balls: this.balls.map((b) => ({ x: b.x, y: b.y, active: b.active })),
    };
  }
}
