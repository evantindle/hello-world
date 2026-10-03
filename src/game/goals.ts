import { hyp } from '../core/vec';
import type { Ball } from '../physics/ball';
import type { TurnLog } from '../physics/log';
import type { Goal, StarCond } from './ruleset';

/** What the judge needs to know after a stroke. */
export interface JudgeState {
  balls: readonly Ball[];
  /** Every ball potted so far this game, in order (ball numbers), and this stroke's log. */
  pottedOrder: readonly number[];
  log: TurnLog;
  /** Strokes used (shots plus penalties) and allowed. */
  score: number;
  shotLimit: number | null;
}

export type Verdict = { result: 'win' } | { result: 'fail'; reason: string } | { result: 'continue' };

const CONTINUE: Verdict = { result: 'continue' };

/** How a goal reads on the intro card and the goal chip. */
export function goalText(goal: Goal): string {
  switch (goal.kind) {
    case 'clearAll':
      return 'CLEAR THE TABLE';
    case 'sink':
      return `SINK THE ${goal.ball}`;
    case 'order':
      return `SINK ${goal.balls.join(' THEN ')}`;
    case 'combo':
      return `SINK ${goal.n} IN ONE SHOT`;
    case 'bank':
      return `BANK A BALL IN OFF ${goal.cushions} CUSHIONS`;
    case 'spare':
      return `CLEAR THE TABLE BUT SPARE THE ${goal.ball}`;
    case 'scratch':
      return goal.pockets?.length ? 'SCRATCH INTO A CHOMPER' : 'SCRATCH ON PURPOSE';
    case 'park':
      return 'PARK THE CUE BALL ON THE TARGET';
  }
}

/**
 * Calls a Classic stroke: won, lost, or play on. Some things lose at once (an egg breaks, a ball
 * that had to be spared drops, balls go down out of order); otherwise running out of strokes does.
 */
export function judge(
  goal: Goal,
  s: JudgeState,
  bullseyes: readonly { id: number; x: number; y: number; r: number }[],
): Verdict {
  const { log, balls } = s;
  const objects = balls.filter((b) => b.kind === 'object');
  // Eggs must survive every goal (they cannot be pocketed once broken).
  if (log.broken.length > 0) return { result: 'fail', reason: 'THE EGG BROKE' };
  let verdict: Verdict = CONTINUE;
  switch (goal.kind) {
    case 'clearAll':
      if (objects.every((b) => b.gone !== null)) verdict = { result: 'win' };
      break;
    case 'sink': {
      const b = objects.find((q) => q.num === goal.ball);
      if (b?.gone === 'pocketed') verdict = { result: 'win' };
      else if (b && b.gone !== null) return { result: 'fail', reason: `THE ${goal.ball} IS GONE` };
      break;
    }
    case 'order': {
      const listed = s.pottedOrder.filter((n) => goal.balls.includes(n));
      for (let i = 0; i < listed.length; i++) {
        if (listed[i] !== goal.balls[i]) return { result: 'fail', reason: 'WRONG ORDER' };
      }
      if (listed.length === goal.balls.length) verdict = { result: 'win' };
      break;
    }
    case 'combo':
      if (log.pots.filter((p) => p.ball !== 0).length >= goal.n) verdict = { result: 'win' };
      break;
    case 'bank':
      if (log.pots.some((p) => p.ball !== 0 && p.banks >= goal.cushions)) verdict = { result: 'win' };
      break;
    case 'spare': {
      const keep = objects.find((q) => q.num === goal.ball);
      if (!keep || keep.gone !== null) return { result: 'fail', reason: `THE ${goal.ball} WENT DOWN` };
      if (objects.every((b) => b === keep || b.gone !== null)) verdict = { result: 'win' };
      break;
    }
    case 'scratch':
      if (log.scratch && (!goal.pockets || goal.pockets.includes(log.scratch.pocket)))
        verdict = { result: 'win' };
      break;
    case 'park': {
      const target = bullseyes.find((b) => b.id === goal.bullseye);
      const rest = log.cueRest;
      if (target && rest && hyp(rest.x - target.x, rest.y - target.y) <= target.r)
        verdict = { result: 'win' };
      break;
    }
  }
  if (verdict.result === 'win') return verdict;
  if (s.shotLimit !== null && s.score >= s.shotLimit) return { result: 'fail', reason: 'OUT OF STROKES' };
  return CONTINUE;
}

/** What a win was worth: 1 star, plus the two- and three-star conditions. */
export interface StarFacts {
  score: number;
  tokensSpent: number;
  scratched: boolean;
  eggIntact: boolean;
}

export function meets(c: StarCond, f: StarFacts): boolean {
  if (c.score !== undefined && f.score > c.score) return false;
  if (c.tokens !== undefined && f.tokensSpent > c.tokens) return false;
  if (c.flag === 'noScratch' && f.scratched) return false;
  if (c.flag === 'eggIntact' && !f.eggIntact) return false;
  return true;
}

export function starsFor(stars: { three: StarCond; two: StarCond }, f: StarFacts): number {
  return meets(stars.three, f) ? 3 : meets(stars.two, f) ? 2 : 1;
}

/** A star condition as words, for the intro card. */
export function starText(c: StarCond): string {
  const parts: string[] = [];
  if (c.score !== undefined) parts.push(c.score === 1 ? 'in 1 stroke' : `in ${c.score} strokes or fewer`);
  if (c.tokens !== undefined)
    parts.push(c.tokens === 0 ? 'no grabs' : c.tokens === 1 ? '1 grab at most' : `${c.tokens} grabs at most`);
  if (c.flag === 'noScratch') parts.push('no scratches');
  if (c.flag === 'eggIntact') parts.push('egg unbroken');
  return parts.join(', ') || 'win';
}
