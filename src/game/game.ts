import {
  BUDGET,
  CHARGE_TIME,
  FF_SCALE,
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
import { Previewer, PREVIEW_T, startShot, type Preview } from './preview';
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
import { makeRemix } from './remix';
import { findRespawnSpot, loadBest, loadBestStyle, rackBalls, rankFor, saveBest, type Rank } from './rules';
import { beats, styleOf } from './scoring';
import { judge, starsFor, type Verdict } from './goals';
import { loadProgress, recordWin } from './progress';
import { cloneLog, type Edit, type TurnRecord } from './record';
import { V1_RULES, VIEWER_RULES, type Ruleset } from './ruleset';
import { hashBoard, restoreState, snapState, type GameState } from './serialize';
import { quantizeShot, type ShotQ } from './shot';
import { Spin } from './spin';

export type Phase =
  | 'title'
  | 'spin'
  | 'plan'
  | 'strike'
  | 'sim'
  | 'resolve'
  | 'respawn'
  | 'over'
  /** A recorded shot playing again on the table as it was (then the game carries on). */
  | 'replay';

/** What a replay needs: the board before the shot, the shot, and where everything ended up. */
export interface ReplaySource {
  pre: TurnRecord['pre'];
  stroke: number;
  aim: number;
  shot: ShotQ;
  postHash: number;
}

export interface TurnResult {
  potted: Ball[];
  scratch: boolean;
  /** The scratch cost a stroke (not when a level asks for one). */
  penalty: boolean;
  /** Style points for this shot, and for the game so far. */
  style: number;
  totalStyle: number;
  streak: number;
  timedOut: boolean;
  shots: number;
  score: number;
  left: number;
}

export interface GameOverInfo {
  /** Free Play always ends in a win (the table is cleared); a Classic level can be lost. */
  result: 'win' | 'fail';
  /** Why a Classic level was lost. */
  reason: string | null;
  /** Classic: stars earned (0 on a loss), the stroke limit, and grabs used. */
  stars: number;
  levelId: string | null;
  shotLimit: number | null;
  tokensSpent: number;
  score: number;
  shots: number;
  penalties: number;
  par: number;
  best: number | null;
  isBest: boolean;
  style: number;
  bestStyle: number;
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
  /** A replay started, or finished (`ok`: it came to rest exactly as recorded). */
  replay: { on: boolean; ok: boolean | null };
  /** Toy Box: the last shot was taken back. */
  rewind: Record<string, never>;
  /** Toy Box: every toy went back in the box. */
  cleared: { count: number };
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
  /** Deal a remixed table every game (Free Play). */
  remix?: boolean;
  /** Twists on the first remix (0: the plain table, for a new player's first game). */
  remixLevel?: number;
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
  /** Deal a fresh remixed table from the seed (table, balls and tray, unless given). */
  remix?: boolean;
  /** How many twists the remix deals (default 2). */
  remixLevel?: number;
  /** The table's name (a level's), shown on the HUD. */
  name?: string;
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
  /** Style points of the best game (its tiebreaker). */
  bestStyle = 0;
  /** The table's name (remixes and levels), or null. */
  tableName: string | null = null;
  /** The live game set aside while a shot replays; null when nothing is replaying. */
  private replaying: {
    back: GameState;
    phase: Phase;
    aim: number;
    world: World;
    src: ReplaySource;
    loop: boolean;
    /** Seconds the finished replay has been held on screen. */
    hold: number;
  } | null = null;
  /** The last replay came to rest exactly where the recording did (null before any). */
  replayOk: boolean | null = null;
  /** Toy Box re-spins this stroke (each gets its own angle). */
  private respins = 0;
  /** Classic: every object ball potted so far, in order, and how the level ended. */
  pottedOrder: number[] = [];
  private verdict: Verdict | null = null;
  /** Style points this game. */
  style = 0;
  /** Fast-forward held: the sim runs FF_SCALE times faster (and skips the slow-mo). */
  ff = false;
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
  /** The shot preview (rules with preview 'chain'). */
  readonly previewer = new Previewer();
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
    if (this.persist) {
      this.best = loadBest();
      this.bestStyle = this.best === null ? 0 : loadBestStyle();
    }
    this.setup({
      rules: opts.rules ?? V1_RULES,
      seed: opts.seed ?? randomSeed(),
      tray: opts.tray,
      remix: opts.remix,
      remixLevel: opts.remixLevel,
    });
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
    // A first-game remix level applies once; new games deal the usual twists.
    this.lastSetup = { ...s, remixLevel: undefined };
    this.history = [];
    this.pending = null;
    this.rules = s.rules;
    this.levelId = s.levelId ?? null;
    this.seed = s.seed >>> 0;
    const rx = s.remix ? makeRemix(this.seed, s.remixLevel ?? 2) : null;
    this.tableName = s.name ?? (rx ? rx.name : null);
    this.table = s.table ? cloneTable(s.table) : rx ? rx.table : createTable();
    this.hunger = 0;
    this.geom = buildGeom(this.table, this.hunger);
    this.balls = s.balls
      ? s.balls.map((b) => ({ ...b }))
      : rx
        ? rx.balls
        : rackBalls(rngFor(this.seed, 'rack'));
    this.world = createWorld(this.balls, this.geom);
    const lim = this.rules.reshape;
    this.budget = lim.kind === 'budget' ? lim.perTurn : Infinity;
    this.tokens = lim.kind === 'tokens' ? lim.tokens : Infinity;
    this.shots = 0;
    this.penalties = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.style = 0;
    this.pottedOrder = [];
    this.verdict = null;
    this.replaying = null;
    this.replayOk = null;
    this.respins = 0;
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
    this.tray = structuredClone(s.tray ?? rx?.tray ?? []);
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

  /** A new game from the given setup that waits on the title phase (behind a level's intro card)
   * until start(). */
  prepare(s: GameSetup): void {
    this.setup(s);
    this.enter('title');
  }

  /** The same kind of game again (same rules and layout), with a new seed unless given one. A
   * Classic level keeps its own seed (its respawns and black holes are part of the puzzle). */
  restart(seed?: number): void {
    const last = this.lastSetup ?? { rules: this.rules, seed: 0 };
    const keep = this.rules.mode === 'classic';
    this.load({ ...last, seed: seed ?? (keep ? last.seed : randomSeed()) });
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
        this.shot = quantizeShot(
          this.aim,
          this.strikePower,
          eng ? this.englishX : 0,
          eng ? this.englishY : 0,
        );
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
    const fast = this.ff && this.simulating;
    const target = this.slowmo ? SLOWMO_SCALE : fast ? FF_SCALE : 1;
    this.timeScale = damp(this.timeScale, target, this.slowmo || fast ? 16 : 6, dtReal);
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
      case 'replay':
        this.phaseT += dt;
        this.updateReplay(dt, dtReal);
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
    const key = this.previewKey(PREVIEW_T);
    // Most previews finish well inside this; a big break may take a few frames. Less of each
    // frame when frames are already slow.
    const budget = dtReal > 1 / 50 ? 2.5 : 6;
    this.previewer.update(key, () => this.previewInput(key, PREVIEW_T), budget);
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

  /** The whole preview of the shot to come, worked out now (tests, tools). `exhaustive` follows
   * every ball to the end of the horizon. */
  previewNow(horizon = PREVIEW_T, exhaustive = false): Preview {
    return this.previewer.compute({ ...this.previewInput(this.previewKey(horizon), horizon), exhaustive });
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
    // No bullet time while the player is fast-forwarding.
    if (this.slowmoLeft > 0 && this.objectsLeft === 1 && !this.ff) {
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
    // A scratch costs a stroke, unless sinking the cue ball is the level's goal.
    const penalty = this.scratched && !this.scratchWanted();
    if (penalty) this.penalties++;
    const log = this.world.log;
    const style = styleOf(log);
    this.style = Math.max(0, this.style + style);
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
    // Classic: the judge calls it after every stroke.
    const goal = this.rules.goal;
    if (this.rules.mode === 'classic' && goal) {
      for (const b of potted) this.pottedOrder.push(b.num);
      const bullseyes = this.table.parts.flatMap((p) =>
        p.kind === 'bullseye' ? [{ id: p.id, x: p.x, y: p.y, r: p.r }] : [],
      );
      const v = judge(
        goal,
        {
          balls: this.balls,
          pottedOrder: this.pottedOrder,
          log,
          score: this.score,
          shotLimit: this.rules.shotLimit,
        },
        bullseyes,
      );
      if (v.result !== 'continue') this.verdict = v;
    }
    this.events.emit('turnResult', {
      potted,
      scratch: this.scratched,
      penalty,
      style,
      totalStyle: this.style,
      streak: this.streak,
      timedOut: this.timedOut,
      shots: this.shots,
      score: this.score,
      left: this.objectsLeft,
    });
    if (this.verdict) this.enter('over');
    else if (this.scratched && (this.rules.mode !== 'free' || this.objectsLeft > 0)) this.enter('respawn');
    else this.nextTurn();
  }

  private nextTurn(): void {
    // Free Play ends when the table is clear; a Classic level ends when the judge says so.
    // The Toy Box never ends.
    if (this.rules.mode === 'classic') this.enter(this.verdict ? 'over' : 'spin');
    else if (this.rules.mode === 'toybox') this.enter('spin');
    else this.enter(this.objectsLeft === 0 ? 'over' : 'spin');
  }

  /** This shot's scratch is what the level asked for (a Classic "scratch into..." goal). */
  private scratchWanted(): boolean {
    const goal = this.rules.goal;
    if (this.rules.mode !== 'classic' || goal?.kind !== 'scratch' || !this.scratchPocket) return false;
    return !goal.pockets || goal.pockets.includes(this.scratchPocket.vid);
  }

  /** Grab tokens used so far (Classic). */
  get tokensSpent(): number {
    const lim = this.rules.reshape;
    return lim.kind === 'tokens' ? lim.tokens - this.tokens : 0;
  }

  /** Back to the menus (the home screen), dropping whatever was going on. */
  quit(): void {
    this.stopReplay();
    this.endEdits();
    if (this.charging) this.cancelShot();
    if (this.slowmo) this.setSlowmo(false);
    this.enter('title');
  }

  // ------------------------------------------------------------------ replays

  /** The sim is running: a real shot, or a replay of one. */
  get simulating(): boolean {
    return this.phase === 'sim' || this.phase === 'replay';
  }

  /** The last shot can be watched again now. */
  get canReplay(): boolean {
    return (this.phase === 'plan' || this.phase === 'over') && !this.charging && this.history.length > 0;
  }

  /**
   * Plays a recorded shot again on the table as it was before it (the last shot, by default), with
   * all its sound and fury; afterwards the game is put back exactly as it was. `loop` plays it over
   * and over (the shared-shot viewer).
   */
  replay(src: ReplaySource | undefined = this.history[this.history.length - 1], loop = false): boolean {
    if (!src || this.phase === 'replay' || this.charging) return false;
    if (!loop && !this.canReplay) return false;
    this.endEdits();
    this.replaying = {
      back: snapState(this),
      phase: this.phase,
      aim: this.aim,
      world: this.world,
      src,
      loop,
      hold: 0,
    };
    this.events.emit('replay', { on: true, ok: null });
    this.startReplay();
    return true;
  }

  private startReplay(): void {
    const r = this.replaying!;
    restoreState(this, r.src.pre);
    this.aim = r.src.aim;
    this.shot = r.src.shot;
    r.hold = 0;
    const { world, dx, dy, speed } = startShot(
      this.balls,
      this.geom,
      r.src.pre.seed,
      r.src.stroke,
      r.src.shot,
    );
    this.world = world;
    this.acc = 0;
    this.enter('replay');
    const cue = this.cue;
    this.events.emit('strike', { power: r.src.shot.p / 1000, x: cue.x, y: cue.y, dx, dy, speed });
  }

  private updateReplay(dt: number, dtReal: number): void {
    const r = this.replaying;
    if (!r) return;
    if (this.world.stopped) {
      // Hold the last frame a moment, then go round again or put the game back.
      r.hold += dtReal;
      if (r.hold >= (r.loop ? 1.6 : 0.9)) {
        if (r.loop) this.startReplay();
        else this.stopReplay();
      }
      return;
    }
    this.acc += dt;
    for (let steps = 0; this.acc >= H && steps < 48; steps++) {
      this.evs.length = 0;
      stepWorld(this.world, H, this.evs);
      for (const e of this.evs) this.events.emit('phys', e);
      this.acc -= H;
      if (this.world.stopped) {
        this.replayOk = hashBoard(this.table, this.balls) === r.src.postHash;
        this.events.emit('replay', { on: true, ok: this.replayOk });
        return;
      }
    }
  }

  /** Ends a replay (early, or once it has played): the game is back exactly where it was. */
  stopReplay(): void {
    const r = this.replaying;
    if (!r) return;
    this.replaying = null;
    restoreState(this, r.back);
    this.aim = r.aim;
    this.world = r.world;
    this.acc = 0;
    const from = this.phase;
    this.phase = r.phase;
    // Past any intro animations of the phase it returns to.
    this.phaseT = 10;
    this.events.emit('phase', { from, to: r.phase });
    this.events.emit('replay', { on: false, ok: this.replayOk });
  }

  /** The shared-shot viewer: a table seen through one recorded shot, over and over. */
  watch(src: ReplaySource, name?: string): void {
    this.setup({ rules: VIEWER_RULES, seed: src.pre.seed, table: src.pre.table, balls: src.pre.balls, name });
    this.enter('title');
    this.replay(src, true);
  }

  // ------------------------------------------------------------------ Toy Box

  get canRewind(): boolean {
    return this.rules.rewind && this.canReshape && this.history.length > 0;
  }

  /** Toy Box: take the last shot back: the board as it was just before it, same aim, same dial. */
  rewind(): boolean {
    if (!this.canRewind) return false;
    this.endEdits();
    const rec = this.history.pop()!;
    restoreState(this, rec.pre);
    this.shots = rec.stroke - 1;
    this.aim = rec.aim;
    this.spinTarget = rec.aim;
    this.setDial(rec.shot.p / 1000);
    if (this.rules.english) this.setEnglish(rec.shot.ex / 100, rec.shot.ey / 100);
    this.world = createWorld(this.balls, this.geom);
    this.fresh.clear();
    this.edits = [];
    this.editHistory.clear();
    this.editHistory.begin(this.snapEdit());
    this.dirty = false;
    this.events.emit('rewind', {});
    return true;
  }

  get canRespin(): boolean {
    return this.rules.respin && this.canReshape;
  }

  /** Toy Box: spin the cue again, free (no stroke counted; the table stays as it is). */
  respin(): boolean {
    if (!this.canRespin) return false;
    this.endEdits();
    this.respins++;
    this.forcedAngle = rngFor(this.seed, 'respin', this.shots, this.respins).range(0, TAU);
    this.enter('spin');
    return true;
  }

  /** Toy Box: every toy on the table goes back in the box (one undoable edit). */
  clearToys(): boolean {
    if (!this.canReshape || this.rules.mode !== 'toybox') return false;
    this.endEdits();
    const before = this.snapEdit();
    let count = 0;
    for (const p of [...this.table.parts]) {
      if (p.placed === undefined || p.locked || !this.table.parts.includes(p)) continue;
      const item = this.tray[p.placed];
      if (!item) continue;
      for (const id of removeParts(this, p.id)) this.fresh.delete(id);
      item.count++;
      count++;
    }
    if (count === 0) return false;
    this.commitEdit(before, { op: 'clear' });
    this.events.emit('cleared', { count });
    return true;
  }

  private finish(): void {
    const score = this.score;
    const classic = this.rules.mode === 'classic';
    const v = this.verdict;
    const result: 'win' | 'fail' = classic && v?.result === 'fail' ? 'fail' : 'win';
    let stars = 0;
    let isBest = false;
    if (classic) {
      if (result === 'win' && this.rules.stars) {
        stars = starsFor(this.rules.stars, {
          score,
          tokensSpent: this.tokensSpent,
          scratched: this.penalties > 0,
          eggIntact: !this.balls.some((b) => b.variant === 'egg' && b.gone === 'broken'),
        });
        if (this.persist && this.levelId) {
          // A better result than before (more stars, or fewer strokes) is a new best.
          const before = loadProgress().levels[this.levelId];
          isBest = !!before && (stars > before.stars || score < before.best);
          recordWin(this.levelId, stars, score);
        }
      }
    } else {
      // Free Play bests: fewest strokes, then most style.
      isBest = beats(
        score,
        this.style,
        this.best === null ? null : { score: this.best, style: this.bestStyle },
      );
      if (isBest) {
        this.best = score;
        this.bestStyle = this.style;
        if (this.persist) saveBest(score, this.style);
      }
    }
    const info: GameOverInfo = {
      result,
      reason: v?.result === 'fail' ? v.reason : null,
      stars,
      levelId: this.levelId,
      shotLimit: this.rules.shotLimit,
      tokensSpent: this.tokensSpent,
      score,
      shots: this.shots,
      penalties: this.penalties,
      par: this.par,
      best: this.best,
      isBest,
      style: this.style,
      bestStyle: this.bestStyle,
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
        if (e.edge !== undefined)
          h = listHandles(this.table).find((q) => q.kind === 'edge' && q.index === e.edge);
        else {
          const i = this.table.verts.findIndex((v) => v.id === e.vid);
          const v = this.table.verts[i];
          if (v)
            h = { kind: 'vertex', index: i, x: v.x, y: v.y, pocket: v.pocket, locked: v.bolted === true };
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
      case 'clear':
        return this.clearToys();
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
    this.curEdit = {
      op: 'grab',
      vid: s.vid,
      ...(h.kind === 'edge' ? { edge: h.index } : {}),
      path: [px, py],
    };
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

  hitPart(
    x: number,
    y: number,
    radius: number,
    knobs: readonly number[] = this.turnable(),
  ): PartHandle | null {
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
    this.partDrag = {
      id,
      turn,
      gx: p.x - px,
      gy: p.y - py,
      ax: p.x,
      ay: p.y,
      moved: 0,
      free,
      lastBlocked: null,
    };
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
    if (
      stow &&
      p.placed !== undefined &&
      this.tray[p.placed] &&
      (s.free || !this.tokenMode || this.tokens >= 1)
    ) {
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
    const host = {
      table: cloneTable(this.table),
      geom: this.geom,
      balls: this.balls.map((b) => ({ ...b })),
      hunger: this.hunger,
    };
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
