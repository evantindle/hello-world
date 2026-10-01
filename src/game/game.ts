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
} from '../config';
import { damp } from '../core/easing';
import { Emitter } from '../core/emitter';
import { randomSeed, rngFor } from '../core/rng';
import { clamp01, hyp, TAU, wrapTau } from '../core/vec';
import { ARROW_PARTS, type Dir, type Part } from '../geom/parts';
import { pointInPolygon } from '../geom/polygon';
import { castGuide, type Guide, type GuideSpin } from '../geom/raycast';
import { buildGeom, cloneTable, createTable, type Pocket, type Table, type TableGeom } from '../geom/table';
import { launchFrom } from '../physics/launch';
import { createWorld, stepWorld, type Ball, type PhysEvent, type World } from '../physics/world';
import { Previewer, PREVIEW_T, PREVIEW_T_DRAG, startShot, type Preview } from './preview';
import { History, type EditSnap } from './history';
import {
  canTurn,
  dirOf,
  hitPart,
  movePart,
  nearestDir,
  placePart,
  removeParts,
  TURN_STEPS,
  turnKnob,
  turnPart,
  type PartHandle,
  type PartPreset,
  type TrayItem,
} from './placement';
import {
  DragSession,
  hitHandle,
  listHandles,
  removeBend,
  type BlockReason,
  type Handle,
  type MoveResult,
  type ReshapeHost,
} from './reshape';
import { findRespawnSpot, loadBest, rackBalls, rankFor, saveBest, type Rank } from './rules';
import { cloneLog, type Edit, type TurnRecord } from './record';
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
  chargeCancel: { reason: 'cancel' };
  dial: { value: number };
  english: { x: number; y: number };
  strike: { power: number; x: number; y: number; dx: number; dy: number; speed: number };
  phys: PhysEvent;
  dragStart: { vid: number; inserted: boolean; x: number; y: number };
  drag: { vid: number; result: MoveResult; x: number; y: number };
  dragEnd: { vid: number; dropped: boolean };
  blocked: { vid: number; reason: BlockReason; x: number; y: number };
  bendRemoved: { x: number; y: number };
  undo: Record<string, never>;
  redo: Record<string, never>;
  reset: Record<string, never>;
  /** A toy was grabbed (to move it, or by its knob to turn it). */
  partGrab: { id: number; turn: boolean; x: number; y: number };
  partMove: { id: number; result: MoveResult; x: number; y: number };
  partTurn: { id: number; steps: number; x: number; y: number };
  /** A toy was let go of (back into the tray, if `stowed`). */
  partDrop: { id: number; stowed: boolean; x: number; y: number };
  partPlaced: { ids: number[]; item: number; x: number; y: number; pushed: MoveResult['pushed'] };
  /** A toy edit (or a placement, `id` null) was refused. */
  partBlocked: { id: number | null; reason: BlockReason; x: number; y: number };
  /** A grab token was spent. */
  tokenSpent: { left: number; x: number; y: number };
  poke: { x: number; y: number };
  turnResult: TurnResult;
  respawnStart: { fromX: number; fromY: number; toX: number; toY: number };
  respawnLand: { x: number; y: number };
  hunger: { level: number; prev: number };
  /** A scratch bolted this pocket down. */
  pocketBolted: { vid: number; x: number; y: number };
  /** A corked pocket popped open again. */
  uncorked: { vid: number; x: number; y: number };
  slowmo: { on: boolean };
  gameOver: GameOverInfo;
}

/** A toy being dragged or turned. */
interface PartSession {
  id: number;
  turn: boolean;
  /** Pointer-to-toy offset (moves) and where the toy was when grabbed. */
  gx: number;
  gy: number;
  ax: number;
  ay: number;
  /** Distance moved / steps turned so far. */
  moved: number;
  /** Free to move (put down from the tray this turn, or no limits at all). */
  free: boolean;
  lastBlocked: BlockReason | null;
}

/** Pointer positions are quantized like this as they arrive, so recorded edits replay exactly. */
const q64 = (v: number): number => Math.round(v * 64) / 64;

/** Radians per turning step (5 degrees), for charging stretch budget on knob travel. */
const TURN_STEP_RAD = 0.08726646259971647;

export interface GameOptions {
  seed?: number;
  /** Read/write the best score in localStorage (off in tests). */
  persist?: boolean;
  /** Defaults to the original v1 rules. */
  rules?: Ruleset;
  /** Toys the player can put down. */
  tray?: TrayItem[];
}

/** Everything a new game needs: its rules and seed, and optionally a starting table and balls. */
export interface GameSetup {
  rules: Ruleset;
  seed: number;
  /** Starting table (cloned); default: the v1 rectangle. */
  table?: Table;
  /** Starting balls (cloned); default: the v1 rack, shuffled by the seed. */
  balls?: Ball[];
  /** Toys the player can put down (cloned); default none. */
  tray?: TrayItem[];
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
  /** The auto-windup after SHOOT (the stick pulls back to the dial's power, then strikes). */
  charging = false;
  chargeT = 0;
  strikePower = 0;
  /** Power dial in thousandths (exact, so shots quantize without rounding surprises). */
  dialQ = 600;
  /** English on the cue ball: x + is right of the aim line, y + is draw. Within the unit disc. */
  englishX = 0;
  englishY = 0;
  /** Seconds the current windup takes. */
  private windup = 1;
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
  /** A toy being dragged or turned. */
  partDrag: PartSession | null = null;
  /** Toys waiting in the tray. */
  tray: TrayItem[] = [];
  /** Toys put down from the tray this turn: moving them (or taking them back) is free. */
  fresh = new Set<number>();
  /** This turn's undo history. */
  readonly editHistory = new History();
  /** This turn's edits so far, as replayable data (recorded with the stroke). */
  edits: Edit[] = [];
  /** The chain preview of the shot to come (rules with preview 'chain'). */
  readonly previewer = new Previewer();
  /** Real seconds in the plan phase, and when the last preview was started (to pace them while
   * something is being dragged). */
  private previewClock = 0;
  private previewStarted = -1;
  lastOver: GameOverInfo | null = null;
  /** The state just before the edit in progress, and the edit being recorded. */
  private editBefore: EditSnap | null = null;
  private curEdit: Edit | null = null;
  /** The table differs from the start of the turn (RESET has something to do). */
  private dirty = false;
  private lastSetup: GameSetup | null = null;
  private acc = 0;
  private evs: PhysEvent[] = [];
  private readonly persist: boolean;

  constructor(opts: GameOptions = {}) {
    this.persist = opts.persist ?? false;
    if (this.persist) this.best = loadBest();
    this.setup({ rules: opts.rules ?? V1_RULES, seed: opts.seed ?? randomSeed(), tray: opts.tray });
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

  /** The dial setting, 0..1. */
  get dial(): number {
    return this.dialQ / 1000;
  }

  /** Power on show: rises to the dial during the windup, otherwise the dial itself. */
  get power(): number {
    return this.charging ? this.dial * clamp01(this.chargeT / this.windup) : this.dial;
  }

  get canReshape(): boolean {
    return this.phase === 'plan' && !this.charging;
  }

  get canUndo(): boolean {
    return this.canReshape && this.editHistory.canUndo;
  }

  get canRedo(): boolean {
    return this.canReshape && this.editHistory.canRedo;
  }

  get canReset(): boolean {
    return this.canReshape && this.dirty;
  }

  /** Grab tokens are what limits bending (Classic). */
  get tokenMode(): boolean {
    return this.rules.reshape.kind === 'tokens';
  }

  /** How far one grab may move a knob or a toy (Infinity unless grab tokens are in play). */
  get reach(): number {
    const lim = this.rules.reshape;
    return lim.kind === 'tokens' ? lim.reach : Infinity;
  }

  guide(): Guide {
    let spin: GuideSpin | undefined;
    if (this.rules.english && (this.englishX !== 0 || this.englishY !== 0)) {
      // Launch a copy of the cue ball to read off the exact spin the real shot will have.
      const probe = { ...this.cue };
      const { speed } = launchFrom(probe, quantizeShot(this.aim, this.dial, this.englishX, this.englishY));
      spin = { speed, sx: probe.sx, sy: probe.sy, bank: probe.bank };
    }
    return castGuide(this.geom, this.balls, this.cue, Math.cos(this.aim), Math.sin(this.aim), 360, spin);
  }

  // ------------------------------------------------------------------ flow

  private setup(s: GameSetup): void {
    // Wind down anything in flight so listeners (sounds, vignette) are told it stopped.
    if (this.drag) this.endDrag();
    if (this.partDrag) this.endPartDrag();
    if (this.charging) this.cancelShot();
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
    this.partDrag = null;
    this.tray = structuredClone(s.tray ?? []);
    this.fresh.clear();
    this.editHistory.clear();
    this.edits = [];
    this.dirty = false;
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
        this.charging = false;
        this.chargeT = 0;
        this.fresh.clear();
        this.edits = [];
        this.dirty = false;
        this.editHistory.begin(this.snapEdit());
        break;
      case 'strike':
        this.shots++;
        break;
      case 'sim': {
        this.acc = 0;
        this.potted = [];
        this.scratched = false;
        this.scratchPocket = null;
        this.timedOut = false;
        const cue = this.cue;
        const eng = this.rules.english;
        this.shot = quantizeShot(this.aim, this.strikePower, eng ? this.englishX : 0, eng ? this.englishY : 0);
        this.pending = {
          stroke: this.shots,
          aim: this.aim,
          shot: this.shot,
          edits: this.edits.slice(),
          pre: snapState(this),
        };
        const { world, dx, dy, speed } = startShot(this.balls, this.geom, this.seed, this.shots, this.shot);
        this.world = world;
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
        if (this.rules.preview === 'chain') this.updatePreview(dtReal);
        if (this.charging) {
          this.chargeT += dtReal;
          if (this.chargeT >= this.windup) {
            this.charging = false;
            this.strikePower = this.dial;
            this.enter('strike');
          }
        }
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

  // ------------------------------------------------------------------ chain preview

  /** What decides the next shot's outcome, as a cache key. */
  private previewKey(horizon: number): string {
    return [
      hashBoard(this.table, this.balls),
      this.hunger,
      this.seed,
      this.shots,
      this.aim,
      this.dialQ,
      this.rules.english ? this.englishX : 0,
      this.rules.english ? this.englishY : 0,
      horizon,
    ].join('|');
  }

  /** The chain preview to draw right now (null if this game does not show one). */
  get preview(): Preview | null {
    return this.rules.preview === 'chain' && this.phase === 'plan' ? this.previewer.current : null;
  }

  private updatePreview(dtReal: number): void {
    this.previewClock += dtReal;
    const dragging = this.drag !== null || this.partDrag !== null;
    const horizon = dragging ? PREVIEW_T_DRAG : PREVIEW_T;
    const key = this.previewKey(horizon);
    // While something is being dragged the shot changes every frame: start a fresh preview at most
    // every 50 ms (the last one stays up meanwhile).
    const stale = this.previewer.current?.key !== key && this.previewer.pendingKey !== key;
    if (stale && dragging && this.previewClock - this.previewStarted < 0.05) return;
    const before = this.previewer.pendingKey;
    // A smaller slice of each frame when frames are already slow.
    const budget = dtReal > 1 / 50 ? 1.5 : 3;
    this.previewer.update(key, () => this.previewInput(key, horizon), budget);
    if (this.previewer.pendingKey !== before) this.previewStarted = this.previewClock;
  }

  private previewInput(key: string, horizon: number) {
    const eng = this.rules.english;
    return {
      key,
      geom: this.geom,
      balls: this.balls,
      seed: this.seed,
      stroke: this.shots + 1,
      shot: quantizeShot(this.aim, this.dial, eng ? this.englishX : 0, eng ? this.englishY : 0),
      horizon,
    };
  }

  /** The whole preview of the shot to come, worked out now (tests, tools). */
  previewNow(horizon = PREVIEW_T): Preview {
    return this.previewer.compute(this.previewInput(this.previewKey(horizon), horizon));
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
    const log = this.world.log;
    // A broken egg costs a stroke in Free Play (Classic levels judge eggs through their goals).
    if (this.rules.mode === 'free') this.penalties += log.broken.length;
    let rebuild = false;
    // Glass remembers its cracks; a shattered pane is gone for good.
    for (const [src, hp] of Object.entries(log.glassHp)) {
      const i = this.table.parts.findIndex((q) => q.id === Number(src));
      const part = this.table.parts[i];
      if (!part || part.kind !== 'glass') continue;
      if (hp <= 0) this.table.parts.splice(i, 1);
      else part.hp = hp;
      rebuild = true;
    }
    // The pocket that swallowed the cue ball gets bolted down for the rest of the game.
    if (this.scratched && this.scratchPocket && this.rules.boltOnScratch) {
      const v = this.table.verts.find((q) => q.id === this.scratchPocket!.vid);
      if (v && !v.bolted) {
        v.bolted = true;
        this.events.emit('pocketBolted', { vid: v.id, x: v.x, y: v.y });
      }
    }
    // Corks count down one stroke at a time, then pop.
    for (const v of this.table.verts) {
      if (v.trait?.kind !== 'corked') continue;
      v.trait.strokes--;
      if (v.trait.strokes <= 0) {
        delete v.trait;
        rebuild = true;
        this.events.emit('uncorked', { vid: v.id, x: v.x, y: v.y });
      }
    }
    const prevHunger = this.hunger;
    if (this.rules.hunger) this.hunger = potted.length > 0 ? 0 : Math.min(MAX_HUNGER, this.hunger + 1);
    if (this.hunger !== prevHunger || rebuild) this.geom = buildGeom(this.table, this.hunger);
    if (this.hunger !== prevHunger) this.events.emit('hunger', { level: this.hunger, prev: prevHunger });
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

  setDial(v: number): void {
    const q = Math.round(clamp01(v) * 1000);
    if (q === this.dialQ) return;
    this.dialQ = q;
    this.events.emit('dial', { value: this.dial });
  }

  nudgeDial(d: number): void {
    this.setDial(this.dial + d);
  }

  /** English from the spin widget: x + right of the aim line, y + draw. Clamped to the disc. */
  setEnglish(x: number, y: number): void {
    const m = hyp(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    if (x === this.englishX && y === this.englishY) return;
    this.englishX = x;
    this.englishY = y;
    this.events.emit('english', { x, y });
  }

  /**
   * SHOOT: the stick winds up to the dial's power (bigger shots take longer to wind up) and
   * strikes. `power`, if given, sets the dial first.
   */
  shoot(power?: number): boolean {
    if (this.phase !== 'plan' || this.charging) return false;
    if (power !== undefined) this.setDial(power);
    this.endEdits();
    this.charging = true;
    this.chargeT = 0;
    this.windup = Math.max(0.25, Math.min(CHARGE_TIME, CHARGE_TIME * this.dial));
    this.events.emit('chargeStart', { power: this.dial });
    return true;
  }

  /** Stop a windup before it strikes (Escape, focus lost, a new game). */
  cancelShot(): void {
    if (!this.charging) return;
    this.charging = false;
    this.chargeT = 0;
    this.events.emit('chargeCancel', { reason: 'cancel' });
  }

  // ------------------------------------------------------------------ edits: undo, redo, reset

  /** Everything an edit can change, as a snapshot (for undo, redo and reset). */
  private snapEdit(): EditSnap {
    return {
      table: cloneTable(this.table),
      balls: this.balls.map((b) => ({ x: b.x, y: b.y })),
      budget: this.budget,
      tokens: this.tokens,
      tray: this.tray.map((t) => t.count),
      fresh: [...this.fresh],
    };
  }

  private restoreEdit(s: EditSnap): void {
    this.table = cloneTable(s.table);
    this.geom = buildGeom(this.table, this.hunger);
    this.balls.forEach((b, i) => {
      const p = s.balls[i];
      if (!p) return;
      b.x = p.x;
      b.y = p.y;
      b.vx = 0;
      b.vy = 0;
    });
    this.budget = s.budget;
    this.tokens = s.tokens;
    s.tray.forEach((n, i) => {
      if (this.tray[i]) this.tray[i].count = n;
    });
    this.fresh = new Set(s.fresh);
  }

  private editKey(s: EditSnap): string {
    return JSON.stringify([s.table, s.balls, s.budget, s.tokens, s.tray]);
  }

  private refreshDirty(): void {
    const start = this.editHistory.start;
    this.dirty = start !== null && this.editKey(this.snapEdit()) !== this.editKey(start);
  }

  /** An edit finished and changed something: remember it for undo, and record it. */
  private commitEdit(before: EditSnap, edit: Edit): void {
    this.editHistory.commit(before);
    this.edits.push(edit);
    this.refreshDirty();
  }

  private endEdits(): void {
    if (this.drag) this.endDrag();
    if (this.partDrag) this.endPartDrag();
  }

  /** Step back one edit. */
  undo(): boolean {
    if (!this.canReshape) return false;
    this.endEdits();
    const s = this.editHistory.undo(this.snapEdit());
    if (!s) return false;
    this.restoreEdit(s);
    this.edits.push({ op: 'undo' });
    this.refreshDirty();
    this.events.emit('undo', {});
    return true;
  }

  redo(): boolean {
    if (!this.canReshape) return false;
    this.endEdits();
    const s = this.editHistory.redo(this.snapEdit());
    if (!s) return false;
    this.restoreEdit(s);
    this.edits.push({ op: 'redo' });
    this.refreshDirty();
    this.events.emit('redo', {});
    return true;
  }

  /** Back to how the table was when the turn began (itself undoable). */
  reset(): boolean {
    if (!this.canReshape) return false;
    this.endEdits();
    const start = this.editHistory.start;
    if (!start || !this.dirty) return false;
    this.editHistory.commit(this.snapEdit());
    this.restoreEdit(start);
    this.edits.push({ op: 'reset' });
    this.refreshDirty();
    this.events.emit('reset', {});
    return true;
  }

  /** Replays one recorded edit through the same paths a player's input takes. */
  applyEdit(e: Edit): boolean {
    switch (e.op) {
      case 'grab': {
        let h: Handle | undefined;
        if (e.edge !== undefined) h = listHandles(this.table).find((q) => q.kind === 'edge' && q.index === e.edge);
        else {
          const i = this.table.verts.findIndex((v) => v.id === e.vid);
          const v = this.table.verts[i];
          if (v) h = { kind: 'vertex', index: i, x: v.x, y: v.y, pocket: v.pocket, locked: v.bolted === true };
        }
        if (!h || !this.beginDrag(h, e.path[0]!, e.path[1]!)) return false;
        for (let i = 2; i + 1 < e.path.length; i += 2) this.dragTo(e.path[i]!, e.path[i + 1]!);
        this.endDrag();
        return true;
      }
      case 'unbend':
        return this.removeBendAt(e.vid);
      case 'place':
        return this.placeFromTray(e.item, e.x, e.y);
      case 'move': {
        if (!this.beginPartDrag(e.id, e.path[0]!, e.path[1]!, false)) return false;
        for (let i = 2; i + 1 < e.path.length; i += 2) this.partDragTo(e.path[i]!, e.path[i + 1]!);
        this.endPartDrag(e.stow === true);
        return true;
      }
      case 'turn': {
        const p = this.table.parts.find((q) => q.id === e.id);
        if (!p || !this.beginPartDrag(e.id, p.x, p.y, true)) return false;
        for (const k of e.ks) this.turnPartTo(k);
        this.endPartDrag();
        return true;
      }
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'reset':
        return this.reset();
    }
  }

  // ------------------------------------------------------------------ edits: bending

  hitHandle(x: number, y: number, radius: number): Handle | null {
    return this.canReshape ? hitHandle(this.table, x, y, radius) : null;
  }

  /** A grab token is needed (and there are none left): say so. */
  private outOfTokens(x: number, y: number, vid: number | null): boolean {
    if (!this.tokenMode || this.tokens >= 1) return false;
    if (vid === null) this.events.emit('partBlocked', { id: null, reason: 'tokens', x, y });
    else this.events.emit('blocked', { vid, reason: 'tokens', x, y });
    return true;
  }

  private spendToken(x: number, y: number): void {
    if (!this.tokenMode) return;
    this.tokens = Math.max(0, this.tokens - 1);
    this.events.emit('tokenSpent', { left: this.tokens, x, y });
  }

  beginDrag(h: Handle, px: number, py: number): boolean {
    if (!this.canReshape || this.drag || this.partDrag) return false;
    px = q64(px);
    py = q64(py);
    if (h.kind === 'vertex' && h.locked) {
      const v = this.table.verts[h.index];
      if (v) this.events.emit('blocked', { vid: v.id, reason: 'bolted', x: v.x, y: v.y });
      return false;
    }
    const v0 = h.kind === 'vertex' ? this.table.verts[h.index] : null;
    if (this.outOfTokens(h.x, h.y, v0 ? v0.id : -1)) return false;
    const before = this.snapEdit();
    const s = DragSession.begin(this, h, px, py, this.reach);
    if (!s) return false;
    this.drag = s;
    this.editBefore = before;
    this.curEdit = { op: 'grab', vid: s.vid, ...(h.kind === 'edge' ? { edge: h.index } : {}), path: [px, py] };
    this.events.emit('dragStart', { vid: s.vid, inserted: s.inserted, x: px, y: py });
    return true;
  }

  dragTo(px: number, py: number): MoveResult | null {
    const s = this.drag;
    if (!s) return null;
    px = q64(px);
    py = q64(py);
    if (this.curEdit?.op === 'grab') this.curEdit.path.push(px, py);
    const r = s.move(this, px, py);
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
    const before = this.editBefore!;
    const edit = this.curEdit!;
    this.editBefore = null;
    this.curEdit = null;
    // A bend inserted but never really moved goes away again, leaving no trace at all.
    const dropped = s.inserted && s.applied < 2;
    if (dropped) this.restoreEdit(before);
    else if (s.applied > 0) {
      const v = this.table.verts.find((q) => q.id === s.vid);
      if (this.tokenMode && s.applied >= 2) this.spendToken(v?.x ?? 0, v?.y ?? 0);
      this.commitEdit(before, edit);
    }
    this.events.emit('dragEnd', { vid: s.vid, dropped });
  }

  removeBendAt(vid: number): boolean {
    if (!this.canReshape) return false;
    const v = this.table.verts.find((q) => q.id === vid);
    if (!v || v.pocket) return false;
    const x = v.x;
    const y = v.y;
    if (this.outOfTokens(x, y, vid)) return false;
    const before = this.snapEdit();
    const r = removeBend(this, vid);
    if (r.removed) {
      this.spendToken(x, y);
      this.commitEdit(before, { op: 'unbend', vid });
      this.events.emit('bendRemoved', { x, y });
    } else if (r.blocked) this.events.emit('blocked', { vid, reason: r.blocked, x, y });
    return r.removed;
  }

  poke(x: number, y: number): void {
    this.events.emit('poke', { x, y });
  }

  // ------------------------------------------------------------------ edits: toys

  /** Toys that show a turning knob right now: the ones a player could turn. */
  turnable(): number[] {
    return this.table.parts.filter((p) => canTurn(p)).map((p) => p.id);
  }

  hitPart(x: number, y: number, radius: number, knobs: readonly number[] = this.turnable()): PartHandle | null {
    return this.canReshape ? hitPart(this.table, x, y, radius, knobs) : null;
  }

  /** Grab toy `id` at (px, py): to slide it, or (turn) by its knob to turn it. */
  beginPartDrag(id: number, px: number, py: number, turn: boolean): boolean {
    if (!this.canReshape || this.drag || this.partDrag) return false;
    px = q64(px);
    py = q64(py);
    const p = this.table.parts.find((q) => q.id === id);
    if (!p) return false;
    if (p.locked || (turn && !canTurn(p))) {
      this.events.emit('partBlocked', { id, reason: 'locked', x: p.x, y: p.y });
      return false;
    }
    const free = this.fresh.has(id) || this.rules.reshape.kind === 'free';
    if (!free && this.outOfTokens(p.x, p.y, null)) return false;
    this.editBefore = this.snapEdit();
    this.partDrag = { id, turn, gx: p.x - px, gy: p.y - py, ax: p.x, ay: p.y, moved: 0, free, lastBlocked: null };
    this.curEdit = turn ? { op: 'turn', id, ks: [] } : { op: 'move', id, path: [px, py] };
    this.events.emit('partGrab', { id, turn, x: p.x, y: p.y });
    return true;
  }

  /** Drag the grabbed toy toward the pointer (or, by its knob, turn it toward the pointer). */
  partDragTo(px: number, py: number): MoveResult | null {
    const s = this.partDrag;
    if (!s) return null;
    px = q64(px);
    py = q64(py);
    const p = this.table.parts.find((q) => q.id === s.id);
    if (!p) return null;
    if (s.turn) {
      this.turnPartTo(nearestDir(px - p.x, py - p.y));
      return null;
    }
    if (this.curEdit?.op === 'move') this.curEdit.path.push(px, py);
    let tx = px + s.gx;
    let ty = py + s.gy;
    let clipped: BlockReason | null = null;
    if (!s.free && this.reach < Infinity) {
      const dx = tx - s.ax;
      const dy = ty - s.ay;
      const d = hyp(dx, dy);
      if (d > this.reach) {
        tx = s.ax + (dx * this.reach) / d;
        ty = s.ay + (dy * this.reach) / d;
        clipped = 'reach';
      }
    }
    if (!s.free && this.rules.reshape.kind === 'budget') {
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = hyp(dx, dy);
      if (d > this.budget) {
        if (this.budget < 0.5) {
          this.events.emit('partBlocked', { id: s.id, reason: 'budget', x: p.x, y: p.y });
          return { applied: 0, blocked: 'budget', pushed: [] };
        }
        tx = p.x + (dx * this.budget) / d;
        ty = p.y + (dy * this.budget) / d;
        clipped = 'budget';
      }
    }
    const r = movePart(this, s.id, tx, ty);
    if (!r.blocked && clipped) r.blocked = clipped;
    if (!s.free && this.rules.reshape.kind === 'budget') this.budget = Math.max(0, this.budget - r.applied);
    s.moved += r.applied;
    s.lastBlocked = r.blocked;
    if (r.applied > 0) this.events.emit('partMove', { id: s.id, result: r, x: p.x, y: p.y });
    if (r.blocked) this.events.emit('partBlocked', { id: s.id, reason: r.blocked, x: p.x, y: p.y });
    return r;
  }

  /** Turn the grabbed toy toward direction index k (5-degree steps). */
  turnPartTo(k: number): void {
    const s = this.partDrag;
    if (!s || !s.turn) return;
    const p = this.table.parts.find((q) => q.id === s.id);
    if (!p) return;
    k = ((k % TURN_STEPS) + TURN_STEPS) % TURN_STEPS;
    if (this.curEdit?.op === 'turn') this.curEdit.ks.push(k);
    let target = k;
    if (!s.free && this.rules.reshape.kind === 'budget') {
      // Turning costs stretch too: the knob's travel.
      const r = this.turnRadius(p);
      const afford = Math.floor(this.budget / (TURN_STEP_RAD * r) + 1e-9);
      const k0 = partTurnIndex(p);
      let delta = (((k - k0) % TURN_STEPS) + TURN_STEPS) % TURN_STEPS;
      if (delta > TURN_STEPS / 2) delta -= TURN_STEPS;
      if (Math.abs(delta) > afford) {
        target = k0 + Math.sign(delta) * afford;
        if (afford === 0) {
          this.events.emit('partBlocked', { id: s.id, reason: 'budget', x: p.x, y: p.y });
          return;
        }
      }
    }
    const r = turnPart(this, s.id, target);
    if (r.steps > 0) {
      if (!s.free && this.rules.reshape.kind === 'budget') {
        this.budget = Math.max(0, this.budget - r.steps * TURN_STEP_RAD * this.turnRadius(p));
      }
      s.moved += r.steps;
      this.events.emit('partTurn', { id: s.id, steps: r.steps, x: p.x, y: p.y });
    }
    s.lastBlocked = r.blocked;
    if (r.blocked) this.events.emit('partBlocked', { id: s.id, reason: r.blocked, x: p.x, y: p.y });
  }

  private turnRadius(p: Part): number {
    const k = turnKnob(p);
    return k ? Math.max(30, hyp(k.x - p.x, k.y - p.y)) : 60;
  }

  /** Let go of the grabbed toy; with `stow`, a toy from the tray goes back into it. */
  endPartDrag(stow = false): void {
    const s = this.partDrag;
    if (!s) return;
    this.partDrag = null;
    const before = this.editBefore!;
    const edit = this.curEdit!;
    this.editBefore = null;
    this.curEdit = null;
    const p = this.table.parts.find((q) => q.id === s.id);
    if (!p) return;
    let stowed = false;
    if (stow && p.placed !== undefined && this.tray[p.placed] && (s.free || !this.tokenMode || this.tokens >= 1)) {
      const item = this.tray[p.placed]!;
      for (const id of removeParts(this, s.id)) this.fresh.delete(id);
      item.count++;
      stowed = true;
    } else if (stow && p.placed === undefined) {
      this.events.emit('partBlocked', { id: s.id, reason: 'locked', x: p.x, y: p.y });
    }
    const changed = stowed || s.moved > 0;
    if (changed) {
      if (!s.free && (stowed || (s.turn ? s.moved > 0 : s.moved >= 2))) this.spendToken(p.x, p.y);
      if (edit.op === 'move' && stowed) edit.stow = true;
      this.commitEdit(before, edit);
    }
    this.events.emit('partDrop', { id: s.id, stowed, x: p.x, y: p.y });
  }

  /** The direction a toy from tray item `item` would be put down facing. */
  placementDir(item: number): Dir | null {
    const it = this.tray[item];
    if (!it || !('dir' in it.preset)) return null;
    if (this.rules.arrows === 'random' && ARROW_PARTS.includes(it.preset.kind)) {
      // Spun at random, but the same spin again after an undo: no re-rolling.
      return dirOf(rngFor(this.seed, 'place', this.shots, item, it.count).int(TURN_STEPS));
    }
    return { ...it.preset.dir };
  }

  /** The toy tray item `item` would become if put down now (direction settled). */
  private presetFor(item: number): PartPreset | null {
    const it = this.tray[item];
    if (!it || it.count <= 0) return null;
    const preset = structuredClone(it.preset);
    const dir = this.placementDir(item);
    if (dir && 'dir' in preset) preset.dir = dir;
    return preset;
  }

  /** Whether tray item `item` would fit at (x, y) (for the ghost while dragging it out). */
  canPlace(item: number, x: number, y: number): boolean {
    const preset = this.presetFor(item);
    if (!preset || !this.canReshape || !pointInPolygon(x, y, this.geom.poly)) return false;
    const host = { table: cloneTable(this.table), geom: this.geom, balls: this.balls.map((b) => ({ ...b })), hunger: this.hunger };
    return placePart(host, preset, q64(x), q64(y)).ids.length > 0;
  }

  /** Put tray item `item` down at (x, y). Free; the toy can be moved freely until the shot. */
  placeFromTray(item: number, x: number, y: number): boolean {
    if (!this.canReshape) return false;
    this.endEdits();
    x = q64(x);
    y = q64(y);
    const preset = this.presetFor(item);
    if (!preset) return false;
    const before = this.snapEdit();
    const r = placePart(this, preset, x, y, { placed: item });
    if ('blocked' in r) {
      this.events.emit('partBlocked', { id: null, reason: r.blocked, x, y });
      return false;
    }
    this.tray[item]!.count--;
    for (const id of r.ids) this.fresh.add(id);
    this.commitEdit(before, { op: 'place', item, x, y });
    this.events.emit('partPlaced', { ids: r.ids, item, x, y, pushed: r.pushed });
    return true;
  }
}

function partTurnIndex(p: Part): number {
  if (p.kind === 'arc') {
    const k = turnKnob(p)!;
    return nearestDir(k.x - p.x, k.y - p.y);
  }
  const d = (p as { dir: Dir }).dir;
  return nearestDir(d.x, d.y);
}
