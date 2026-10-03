import { beforeEach, describe, expect, it } from 'vitest';
import { goalText, judge, meets, starsFor, starText, type JudgeState } from '../../src/game/goals';
import { loadProgress, recordWin, resetProgress } from '../../src/game/progress';
import type { Goal } from '../../src/game/ruleset';
import { makeBall, type Ball } from '../../src/physics/ball';
import { newLog, type Pot, type TurnLog } from '../../src/physics/log';

function balls(...gone: [num: number, gone: Ball['gone']][]): Ball[] {
  return [
    makeBall({ id: 0, x: 100, y: 100 }),
    ...gone.map(([num, g]) => ({ ...makeBall({ id: num, num, x: 300, y: 100 }), gone: g })),
  ];
}

function pot(ball: number, extra: Partial<Pot> = {}): Pot {
  return { ball, pocket: 2, t: 1, gen: 1, banks: 0, via: 0, warps: 0, ...extra };
}

function state(b: Ball[], log: Partial<TurnLog> = {}, more: Partial<JudgeState> = {}): JudgeState {
  return { balls: b, pottedOrder: [], log: { ...newLog(), ...log }, score: 1, shotLimit: 3, ...more };
}

const call = (goal: Goal, s: JudgeState, bullseyes: { id: number; x: number; y: number; r: number }[] = []) =>
  judge(goal, s, bullseyes);

describe('the judge', () => {
  it('clear the table: wins once every object ball is gone, else plays on until the strokes run out', () => {
    const goal: Goal = { kind: 'clearAll' };
    expect(call(goal, state(balls([1, 'pocketed'], [2, null])))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls([1, 'pocketed'], [2, 'exploded'])))).toEqual({ result: 'win' });
    expect(call(goal, state(balls([1, null]), {}, { score: 3 }))).toEqual({
      result: 'fail',
      reason: 'OUT OF STROKES',
    });
    // Winning on the last stroke is still a win.
    expect(call(goal, state(balls([1, 'pocketed']), {}, { score: 3 }))).toEqual({ result: 'win' });
  });

  it('sink: wins when that ball drops; losing it any other way fails', () => {
    const goal: Goal = { kind: 'sink', ball: 5 };
    expect(call(goal, state(balls([5, 'pocketed'], [3, null])))).toEqual({ result: 'win' });
    expect(call(goal, state(balls([5, 'exploded'])))).toEqual({ result: 'fail', reason: 'THE 5 IS GONE' });
    expect(call(goal, state(balls([5, null], [3, 'pocketed'])))).toEqual({ result: 'continue' });
  });

  it('order: balls on the list must drop in order (others do not matter)', () => {
    const goal: Goal = { kind: 'order', balls: [3, 5] };
    expect(call(goal, state(balls(), {}, { pottedOrder: [3] }))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls(), {}, { pottedOrder: [1, 3, 2, 5] }))).toEqual({ result: 'win' });
    expect(call(goal, state(balls(), {}, { pottedOrder: [5] }))).toEqual({
      result: 'fail',
      reason: 'WRONG ORDER',
    });
  });

  it('combo: that many object balls in one stroke', () => {
    const goal: Goal = { kind: 'combo', n: 2 };
    expect(call(goal, state(balls(), { pots: [pot(1), pot(0)] }))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls(), { pots: [pot(1), pot(4)] }))).toEqual({ result: 'win' });
  });

  it('bank: an object ball in off enough cushions', () => {
    const goal: Goal = { kind: 'bank', cushions: 2 };
    expect(call(goal, state(balls(), { pots: [pot(3, { banks: 1 })] }))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls(), { pots: [pot(3, { banks: 2 })] }))).toEqual({ result: 'win' });
    expect(call(goal, state(balls(), { pots: [pot(0, { banks: 4 })] }))).toEqual({ result: 'continue' });
  });

  it('spare: clear everything else; losing the spared ball fails at once', () => {
    const goal: Goal = { kind: 'spare', ball: 1 };
    expect(call(goal, state(balls([1, null], [2, 'pocketed'], [3, null])))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls([1, null], [2, 'pocketed'], [3, 'exploded'])))).toEqual({ result: 'win' });
    expect(call(goal, state(balls([1, 'pocketed'], [2, null])))).toEqual({
      result: 'fail',
      reason: 'THE 1 WENT DOWN',
    });
  });

  it('scratch: the cue ball into one of the named pockets', () => {
    const goal: Goal = { kind: 'scratch', pockets: [2, 3] };
    expect(call(goal, state(balls(), { scratch: { pocket: 0 } }))).toEqual({ result: 'continue' });
    expect(call(goal, state(balls(), { scratch: { pocket: 3 } }))).toEqual({ result: 'win' });
    expect(call({ kind: 'scratch' }, state(balls(), { scratch: { pocket: 0 } }))).toEqual({ result: 'win' });
  });

  it('park: the cue ball comes to rest on the bullseye', () => {
    const goal: Goal = { kind: 'park', bullseye: 7 };
    const eye = [{ id: 7, x: 500, y: 300, r: 40 }];
    expect(call(goal, state(balls(), { cueRest: { x: 530, y: 320 } }), eye)).toEqual({ result: 'win' });
    expect(call(goal, state(balls(), { cueRest: { x: 560, y: 300 } }), eye)).toEqual({ result: 'continue' });
    expect(call(goal, state(balls(), { cueRest: null }), eye)).toEqual({ result: 'continue' });
  });

  it('a broken egg loses any level, even a stroke that would have won', () => {
    expect(call({ kind: 'clearAll' }, state(balls([3, 'broken']), { broken: [3] }))).toEqual({
      result: 'fail',
      reason: 'THE EGG BROKE',
    });
  });

  it('describes every goal', () => {
    expect(goalText({ kind: 'order', balls: [3, 5] })).toBe('SINK 3 THEN 5');
    expect(goalText({ kind: 'bank', cushions: 2 })).toBe('BANK A BALL IN OFF 2 CUSHIONS');
  });
});

describe('stars', () => {
  const facts = { score: 2, tokensSpent: 1, scratched: false, eggIntact: true };

  it('one for a win, more for meeting the conditions', () => {
    const stars = { three: { score: 1, tokens: 1 }, two: { score: 2 } };
    expect(starsFor(stars, facts)).toBe(2);
    expect(starsFor(stars, { ...facts, score: 1 })).toBe(3);
    expect(starsFor(stars, { ...facts, score: 3 })).toBe(1);
    expect(meets({ flag: 'noScratch' }, { ...facts, scratched: true })).toBe(false);
    expect(meets({ flag: 'eggIntact' }, { ...facts, eggIntact: false })).toBe(false);
  });

  it('reads well', () => {
    expect(starText({ score: 1, tokens: 1 })).toBe('in 1 stroke, 1 grab at most');
    expect(starText({ score: 2, flag: 'eggIntact' })).toBe('in 2 strokes or fewer, egg unbroken');
    expect(starText({ tokens: 0 })).toBe('no grabs');
  });
});

describe('progress', () => {
  beforeEach(() => resetProgress());

  it('keeps the most stars and the fewest strokes', () => {
    expect(recordWin('rr-01', 2, 3)).toEqual({ stars: 2, best: 3 });
    expect(recordWin('rr-01', 1, 2)).toEqual({ stars: 2, best: 2 });
    expect(recordWin('rr-01', 3, 4)).toEqual({ stars: 3, best: 2 });
    expect(loadProgress().levels['rr-01']).toEqual({ stars: 3, best: 2 });
    expect(loadProgress().levels['rr-02']).toBeUndefined();
  });
});
