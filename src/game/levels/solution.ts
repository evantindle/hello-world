import { Game } from '../game';
import type { Edit, TurnRecord } from '../record';
import { setupFromLevel } from './setup';
import type { LevelDef } from './types';

/** One stroke of a recorded solution: the edits, then the dial (thousandths) and the English. */
export interface SolutionStroke {
  edits: Edit[];
  dial: number;
  ex: number;
  ey: number;
}

/** A recorded way through a level (kept with the tests; CI replays every one). */
export interface Solution {
  level: string;
  /** Stars the recording earned. */
  stars: number;
  strokes: SolutionStroke[];
}

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 120): boolean {
  for (let t = 0; t < maxSeconds && !pred(); t += DT) {
    if (g.phase === 'spin') g.skipSpin();
    g.update(DT);
  }
  return pred();
}

/** Runs a fresh game of `def` up to its first plan phase. */
export function startLevel(def: LevelDef, game = new Game()): Game {
  game.load(setupFromLevel(def));
  runUntil(game, () => game.phase === 'plan');
  return game;
}

/** Plays one stroke: edits, dial, English, shoot; then on to the next plan phase (or the end). */
export function playStroke(game: Game, s: SolutionStroke): void {
  for (const e of s.edits) game.applyEdit(e);
  game.setDial(s.dial / 1000);
  if (game.rules.english) game.setEnglish(s.ex, s.ey);
  const n = game.shots + 1;
  game.shoot();
  runUntil(
    game,
    () => game.phase === 'over' || (game.phase === 'plan' && !game.charging && game.shots === n),
  );
}

/** Plays a recorded solution through the real game; returns the game where it ended. */
export function playSolution(def: LevelDef, sol: Solution, game = new Game()): Game {
  startLevel(def, game);
  for (const s of sol.strokes) {
    if (game.phase === 'over') break;
    playStroke(game, s);
  }
  return game;
}

/** The strokes of a game so far, as a solution (what the dev tools dump after a win). */
export function solutionFrom(levelId: string, history: readonly TurnRecord[], stars: number): Solution {
  return {
    level: levelId,
    stars,
    strokes: history.map((r) => ({
      edits: structuredClone(r.edits),
      dial: r.shot.p,
      ex: r.shot.ex / 100,
      ey: r.shot.ey / 100,
    })),
  };
}
