import { PHYSICS_VERSION } from '../config';
import { suitOf, type Suit } from '../physics/ball';
import type { TurnLog } from '../physics/log';
import { Game, type GameSetup } from './game';
import { playStroke } from './levels/solution';
import type { TurnRecord } from './record';
import { simulateShot } from './record';
import { FREE_RULES } from './ruleset';
import { beats } from './scoring';

/**
 * Multiplayer foundations (see docs/multiplayer.md): the rules of a match, as pure functions over
 * plain data, so any transport (a link passed back and forth, a live room) can carry a match and
 * every client can check it the same way. Nothing here touches the network or the screen.
 *
 *  - Shared table: two players take turns on one table. The first ball potted decides who has
 *    which suit (warm 1,3,5,7,9; cool 2,4,6,8,10). Sinking one of your own keeps your turn; sinking
 *    only the other suit, missing, or scratching passes it. Clear your suit to win (if one shot
 *    clears both, the shooter wins).
 *  - Twin race: everyone plays their own game from the same seed (so the same table, the same
 *    spins stroke by stroke, the same respawns). Fewest strokes wins, then most style. Results
 *    stay covered until everyone has finished.
 */

export interface Player {
  id: string;
  name: string;
}

/** One stroke of a shared-table match, as the match remembers it. */
export interface MatchTurn {
  /** Index into `players`. */
  player: number;
  /** Object balls the shot sent off the table (pocketed, broken or blown up), in order. */
  gone: number[];
  scratch: boolean;
  /** hashBoard() of the table and balls after the shot: the checkpoint everyone agrees on. */
  postHash: number;
  /** The turn passed to the other player after this stroke. */
  passed: boolean;
}

export interface SharedMatch {
  kind: 'shared';
  v: 1;
  /** The physics version both clients must run (a different one may play shots out differently). */
  pv: number;
  seed: number;
  players: [Player, Player];
  /** Whose turn it is. */
  active: 0 | 1;
  /** Each player's suit, once the first ball has dropped. */
  owners: [Suit | null, Suit | null];
  /** Object balls still on the table, by suit. */
  left: Record<Suit, number[]>;
  /** Strokes taken by each player. */
  strokes: [number, number];
  turns: MatchTurn[];
  /** The board checkpoint after the last turn (null before the first). */
  lastHash: number | null;
  over: boolean;
  winner: 0 | 1 | null;
}

export interface RaceResult {
  /** Strokes (with penalties), and style points as the tiebreak. */
  score: number;
  style: number;
  /** hashBoard() of the final board: lets a verifier check the claimed game. */
  finalHash: number;
}

export interface RaceMatch {
  kind: 'race';
  v: 1;
  pv: number;
  seed: number;
  players: Player[];
  results: (RaceResult | null)[];
  over: boolean;
  /** The winner once everyone has finished; null for a dead heat (or before the end). */
  winner: number | null;
}

export type MatchState = SharedMatch | RaceMatch;

/** Why a move was refused. */
export type MatchError = 'over' | 'not-your-turn' | 'unknown-player' | 'already-finished' | 'version';

export type MatchResult<T> = { ok: true; match: T } | { ok: false; error: MatchError };

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);
const opposite = (s: Suit): Suit => (s === 'warm' ? 'cool' : 'warm');

// ---------------------------------------------------------------- shared table

/** A new shared-table match on a rack of these object balls (default 1-10). */
export function newSharedMatch(
  players: [Player, Player],
  seed: number,
  rack: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
): SharedMatch {
  const left: Record<Suit, number[]> = { warm: [], cool: [] };
  for (const n of rack) {
    const s = suitOf(n);
    if (s) left[s].push(n);
  }
  return {
    kind: 'shared',
    v: 1,
    pv: PHYSICS_VERSION,
    seed: seed >>> 0,
    players,
    active: 0,
    owners: [null, null],
    left,
    strokes: [0, 0],
    turns: [],
    lastHash: null,
    over: false,
    winner: null,
  };
}

/** The object balls a stroke took off the table, in the order they went. */
export function goneThisShot(log: TurnLog): number[] {
  const out: number[] = [];
  for (const p of log.pots) if (p.ball !== 0 && !out.includes(p.ball)) out.push(p.ball);
  for (const n of [...log.broken, ...log.exploded]) if (n !== 0 && !out.includes(n)) out.push(n);
  return out;
}

/**
 * Applies one stroke by `player` (its turn log and the resulting board's hash). Returns the new
 * match (the old one is left as it was), or why the stroke does not count.
 */
export function applySharedTurn(
  m: SharedMatch,
  t: { player: number; log: TurnLog; postHash: number },
): MatchResult<SharedMatch> {
  if (m.over) return { ok: false, error: 'over' };
  if (t.player !== 0 && t.player !== 1) return { ok: false, error: 'unknown-player' };
  if (t.player !== m.active) return { ok: false, error: 'not-your-turn' };
  const next = structuredClone(m);
  const me = next.active;
  const gone = goneThisShot(t.log);
  const scratch = t.log.scratch !== null;
  for (const s of ['warm', 'cool'] as const) next.left[s] = next.left[s].filter((n) => !gone.includes(n));
  // The first ball to drop on a clean stroke decides the suits.
  if (next.owners[me] === null && !scratch) {
    const first = gone.map(suitOf).find((s): s is Suit => s !== null);
    if (first) {
      next.owners[me] = first;
      next.owners[other(me)] = opposite(first);
    }
  }
  next.strokes[me]++;
  // A player whose suit is all gone has won; if one stroke clears both, the shooter has.
  const cleared = (p: 0 | 1) => {
    const s = next.owners[p];
    return s === null ? next.left.warm.length + next.left.cool.length === 0 : next.left[s].length === 0;
  };
  const mine = cleared(me);
  const theirs = cleared(other(me));
  if (mine || theirs) {
    next.over = true;
    next.winner = mine ? me : other(me);
  }
  const own = next.owners[me];
  const keep = !scratch && own !== null && gone.some((n) => suitOf(n) === own);
  const passed = !next.over && !keep;
  if (passed) next.active = other(me);
  next.turns.push({ player: me, gone, scratch, postHash: t.postHash, passed });
  next.lastHash = t.postHash;
  return { ok: true, match: next };
}

// ---------------------------------------------------------------- twin race

export function newRaceMatch(players: Player[], seed: number): RaceMatch {
  return {
    kind: 'race',
    v: 1,
    pv: PHYSICS_VERSION,
    seed: seed >>> 0,
    players,
    results: players.map(() => null),
    over: false,
    winner: null,
  };
}

/** The game every racer plays: the same remixed table and the same spins, from the match seed. */
export function raceSetup(m: RaceMatch): GameSetup {
  return { rules: FREE_RULES, seed: m.seed, remix: true };
}

/** A racer has finished. Once everyone has, the match is over and the results are revealed. */
export function submitRace(m: RaceMatch, player: number, r: RaceResult): MatchResult<RaceMatch> {
  if (m.over) return { ok: false, error: 'over' };
  if (!Number.isInteger(player) || player < 0 || player >= m.players.length)
    return { ok: false, error: 'unknown-player' };
  if (m.results[player]) return { ok: false, error: 'already-finished' };
  const next = structuredClone(m);
  next.results[player] = { ...r };
  if (next.results.every((x) => x !== null)) {
    next.over = true;
    next.winner = raceLeader(next.results as RaceResult[]);
  }
  return { ok: true, match: next };
}

/** The best result (fewest strokes, then most style), or null if the best is shared. */
function raceLeader(results: readonly RaceResult[]): number | null {
  let best = 0;
  for (let i = 1; i < results.length; i++) {
    const r = results[i]!;
    if (beats(r.score, r.style, results[best]!)) best = i;
  }
  const b = results[best]!;
  const tied = results.some((r, i) => i !== best && r.score === b.score && r.style === b.style);
  return tied ? null : best;
}

/** What `viewer` may see: their own result always, everyone else's only once all are in. */
export function raceView(m: RaceMatch, viewer: number): (RaceResult | 'finished' | null)[] {
  return m.results.map((r, i) => (m.over || i === viewer || r === null ? r : 'finished'));
}

// ---------------------------------------------------------------- checking

/** Both clients run the same physics (else shots may play out differently). */
export function sameVersion(m: MatchState): boolean {
  return m.pv === PHYSICS_VERSION;
}

/** One recorded stroke replays, from its own starting board, to exactly the board it claims. */
export function verifyTurn(rec: TurnRecord): boolean {
  return simulateShot(rec.pre, rec.shot).hash === rec.postHash;
}

/**
 * The headless verifier: replays a whole claimed game from its setup through the real game, stroke
 * by stroke (the spin each stroke lands on comes from the seed, the edits and the shot from the
 * records), and checks every stroke came to rest where the record says. A race server, or a
 * suspicious opponent, can run this on a submitted result.
 */
export function verifyGame(
  setup: GameSetup,
  records: readonly TurnRecord[],
): { ok: boolean; stroke: number | null; score: number; style: number } {
  const g = new Game();
  g.load(setup);
  const DT = 1 / 60;
  for (let t = 0; t < 30 && g.phase !== 'plan'; t += DT) {
    if (g.phase === 'spin') g.skipSpin();
    g.update(DT);
  }
  const fail = (i: number) => ({ ok: false, stroke: i + 1, score: g.score, style: g.style });
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    // The aim is not the player's to choose: it must be the spin the seed gave this stroke.
    if (g.phase !== 'plan' || rec.aim !== g.aim) return fail(i);
    playStroke(g, { edits: rec.edits, dial: rec.shot.p, ex: rec.shot.ex / 100, ey: rec.shot.ey / 100 });
    if (g.history[i]?.postHash !== rec.postHash) return fail(i);
  }
  return { ok: true, stroke: null, score: g.score, style: g.style };
}
