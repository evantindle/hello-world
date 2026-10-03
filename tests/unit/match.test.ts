import { describe, expect, it } from 'vitest';
import { Game } from '../../src/game/game';
import {
  applySharedTurn,
  goneThisShot,
  newRaceMatch,
  newSharedMatch,
  raceSetup,
  raceView,
  sameVersion,
  submitRace,
  verifyGame,
  verifyTurn,
  type SharedMatch,
} from '../../src/game/match';
import { FREE_RULES } from '../../src/game/ruleset';
import { newLog, type Pot, type TurnLog } from '../../src/physics/log';

const ANN = { id: 'a', name: 'ANN' };
const BOB = { id: 'b', name: 'BOB' };

function log(pots: number[], extra: Partial<TurnLog> = {}): TurnLog {
  const p = (ball: number): Pot => ({ ball, pocket: 2, t: 1, gen: 1, banks: 0, via: 0, warps: 0 });
  return { ...newLog(), pots: pots.map(p), ...extra };
}

/** Plays strokes in turn (whoever is up), asserting each one counts. */
function play(m: SharedMatch, ...shots: TurnLog[]): SharedMatch {
  for (const [i, l] of shots.entries()) {
    const r = applySharedTurn(m, { player: m.active, log: l, postHash: 1000 + i });
    if (!r.ok) throw new Error(r.error);
    m = r.match;
  }
  return m;
}

describe('shared table', () => {
  it('the first ball down decides the suits; your own ball keeps your turn', () => {
    let m = newSharedMatch([ANN, BOB], 7);
    m = play(m, log([]));
    expect(m.active).toBe(1);
    expect(m.owners).toEqual([null, null]);
    // Bob sinks the 4 (cool): cool is his, warm is Ann's, and he goes again.
    m = play(m, log([4]));
    expect(m.owners).toEqual(['warm', 'cool']);
    expect(m.active).toBe(1);
    expect(m.left.cool).toEqual([2, 6, 8, 10]);
    // Sinking only Ann's ball passes the turn to her.
    m = play(m, log([3]));
    expect(m.active).toBe(0);
    // A mix with one of your own keeps it.
    m = play(m, log([2, 5]));
    expect(m.active).toBe(0);
    expect(m.strokes).toEqual([2, 2]);
    expect(m.turns.map((t) => t.passed)).toEqual([true, false, true, false]);
    expect(m.lastHash).toBe(m.turns[m.turns.length - 1]!.postHash);
  });

  it('a scratch passes the turn and never decides the suits', () => {
    let m = newSharedMatch([ANN, BOB], 7);
    m = play(m, log([1, 0], { scratch: { pocket: 0 } }));
    expect(m.owners).toEqual([null, null]);
    expect(m.active).toBe(1);
    expect(m.left.warm).toEqual([3, 5, 7, 9]);
    m = play(m, log([6]));
    m = play(m, log([8, 0], { scratch: { pocket: 2 } }));
    expect(m.active).toBe(0);
  });

  it('clearing your suit wins; clearing theirs hands them the win; both at once goes to the shooter', () => {
    const base = play(newSharedMatch([ANN, BOB], 7, [1, 2, 3, 4]), log([1]));
    expect(base.owners).toEqual(['warm', 'cool']);
    const win = play(base, log([3]));
    expect([win.over, win.winner]).toEqual([true, 0]);
    const oops = play(base, log([2, 4]));
    expect([oops.over, oops.winner]).toEqual([true, 1]);
    const both = play(base, log([2, 3, 4]));
    expect([both.over, both.winner]).toEqual([true, 0]);
    // Balls broken or blown up are gone too.
    const boom = play(base, log([], { exploded: [3] }));
    expect([boom.over, boom.winner]).toEqual([true, 0]);
    expect(applySharedTurn(win, { player: 1, log: log([]), postHash: 1 })).toEqual({
      ok: false,
      error: 'over',
    });
  });

  it('only the player whose turn it is may shoot, and the old state is left alone', () => {
    const m = newSharedMatch([ANN, BOB], 7);
    expect(applySharedTurn(m, { player: 1, log: log([2]), postHash: 1 })).toEqual({
      ok: false,
      error: 'not-your-turn',
    });
    expect(applySharedTurn(m, { player: 2, log: log([]), postHash: 1 })).toEqual({
      ok: false,
      error: 'unknown-player',
    });
    const r = applySharedTurn(m, { player: 0, log: log([2]), postHash: 1 });
    expect(r.ok).toBe(true);
    expect(m.turns).toHaveLength(0);
    expect(m.owners).toEqual([null, null]);
    expect(sameVersion(m)).toBe(true);
    expect(goneThisShot(log([0, 3, 3], { broken: [5] }))).toEqual([3, 5]);
  });
});

describe('twin race', () => {
  it('fewest strokes wins, then style; results stay covered until everyone is in', () => {
    let m = newRaceMatch([ANN, BOB, { id: 'c', name: 'CAT' }], 99);
    const sub = (p: number, score: number, style: number) => {
      const r = submitRace(m, p, { score, style, finalHash: 1 });
      if (!r.ok) throw new Error(r.error);
      m = r.match;
    };
    sub(1, 9, 400);
    expect(raceView(m, 0)).toEqual([null, 'finished', null]);
    expect(raceView(m, 1)[1]).toEqual({ score: 9, style: 400, finalHash: 1 });
    expect(submitRace(m, 1, { score: 1, style: 0, finalHash: 1 })).toEqual({
      ok: false,
      error: 'already-finished',
    });
    sub(0, 9, 650);
    expect(m.over).toBe(false);
    sub(2, 11, 9000);
    expect(m.over).toBe(true);
    expect(m.winner).toBe(0);
    expect(raceView(m, 2)[0]).toEqual({ score: 9, style: 650, finalHash: 1 });
  });

  it('a dead heat has no winner', () => {
    let m = newRaceMatch([ANN, BOB], 5);
    for (const p of [0, 1]) {
      const r = submitRace(m, p, { score: 12, style: 300, finalHash: p });
      if (r.ok) m = r.match;
    }
    expect([m.over, m.winner]).toEqual([true, null]);
  });

  it('everyone gets the same game: same table, same spins, stroke by stroke', () => {
    const m = newRaceMatch([ANN, BOB], 4242);
    const games = [0, 1].map(() => {
      const g = new Game();
      g.load(raceSetup(m));
      return g;
    });
    const aims: number[][] = [[], []];
    for (const [i, g] of games.entries()) {
      for (let k = 0; k < 3; k++) {
        runUntil(g, () => g.phase === 'plan');
        aims[i]!.push(g.aim);
        // Different players play differently...
        g.shoot(i === 0 ? 0.4 : 0.9);
        runUntil(g, () => g.phase !== 'plan' || g.shots === k + 1);
        runUntil(g, () => g.shots === k + 1 && (g.phase === 'plan' || g.phase === 'over'));
      }
    }
    // ...but every stroke spins to the same angle, on the same table.
    expect(aims[0]).toEqual(aims[1]);
    expect(games[0]!.tableName).toBe(games[1]!.tableName);
  });
});

const DT = 1 / 60;
function runUntil(g: Game, pred: () => boolean, maxSeconds = 90) {
  for (let t = 0; t < maxSeconds && !pred(); t += DT) {
    if (g.phase === 'spin') g.skipSpin();
    g.update(DT);
  }
  expect(pred()).toBe(true);
}

describe('the headless verifier', () => {
  it('replays a claimed game stroke by stroke, and catches a doctored one', () => {
    const setup = { rules: FREE_RULES, seed: 777, remix: true };
    const g = new Game();
    g.load(setup);
    runUntil(g, () => g.phase === 'plan');
    // Stroke 1: a bend, then a firm shot. Stroke 2: a soft one.
    const v = g.table.verts[0]!;
    g.beginDrag({ kind: 'vertex', index: 0, x: v.x, y: v.y, pocket: v.pocket }, v.x, v.y);
    g.dragTo(v.x + 30, v.y + 40);
    g.endDrag();
    g.shoot(0.85);
    runUntil(g, () => g.shots === 1 && (g.phase === 'plan' || g.phase === 'over'));
    if (g.phase === 'plan') {
      g.shoot(0.3);
      runUntil(g, () => g.shots === 2 && (g.phase === 'plan' || g.phase === 'over'));
    }
    const records = structuredClone(g.history);
    expect(records.every(verifyTurn)).toBe(true);
    const ok = verifyGame(setup, records);
    expect(ok).toEqual({ ok: true, stroke: null, score: g.score, style: g.style });
    // A different shot than the one claimed...
    const fudged = structuredClone(records);
    fudged[0]!.shot.p = fudged[0]!.shot.p === 1000 ? 999 : fudged[0]!.shot.p + 1;
    expect(verifyTurn(fudged[0]!)).toBe(false);
    expect(verifyGame(setup, fudged).stroke).toBe(1);
    // ...or a hand-picked aim, are caught.
    const aimed = structuredClone(records);
    aimed[aimed.length - 1]!.aim += 0.01;
    expect(verifyGame(setup, aimed).stroke).toBe(aimed.length);
  });
});
