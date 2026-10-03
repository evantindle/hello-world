import type { TurnLog } from '../physics/log';

/** Banks multiply a ball's points by this much each... */
const BANK_MULT = 1.5;
/** ...up to this much in all. */
const BANK_CAP = 3;

/**
 * Style points for one shot: Free Play's tiebreaker and a brag on the scorecard. Each object ball
 * dropped scores 100 x (1 + its collision generation), so a ball knocked in by a ball knocked in
 * by the cue ball is worth more; x1.5 for every cushion it banked off (at most x3); +150 for each
 * portal or black hole it went through and +100 for each speed pad or bumper. The shot's total is
 * multiplied by the number of balls dropped (combos pay), and a scratch costs 200.
 */
export function styleOf(log: TurnLog): number {
  const pots = log.pots.filter((p) => p.ball !== 0);
  let total = 0;
  for (const p of pots) {
    // A ball no other ball touched (a belt or a magnet put it in) scores like a direct hit.
    const gen = p.gen >= 255 ? 1 : Math.min(p.gen, 6);
    let pts = 100 * (1 + gen);
    let mult = 1;
    for (let k = 0; k < p.banks && mult < BANK_CAP; k++) mult = Math.min(BANK_CAP, mult * BANK_MULT);
    pts *= mult;
    pts += 150 * p.warps + 100 * (p.via - p.warps);
    total += pts;
  }
  total *= pots.length;
  if (log.scratch) total -= 200;
  return Math.round(total);
}

/** Free Play bests compare by score (fewer strokes), then by style. */
export function beats(score: number, style: number, best: { score: number; style: number } | null): boolean {
  return best === null || score < best.score || (score === best.score && style > best.style);
}
