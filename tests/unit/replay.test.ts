import { describe, expect, it } from 'vitest';
import { Game } from '../../src/game/game';
import { simulateShot } from '../../src/game/record';
import { FREE_RULES, TOYBOX_RULES } from '../../src/game/ruleset';
import { hashBoard, snapState } from '../../src/game/serialize';
import {
  codeFromHash,
  decodeShot,
  encodeShot,
  replaySourceOf,
  sharedFromRecord,
  shareUrl,
} from '../../src/game/share';
import { fullTray } from '../../src/game/toys';

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 90) {
  for (let t = 0; t < maxSeconds && !pred(); t += DT) {
    if (g.phase === 'spin') g.skipSpin();
    g.update(DT);
  }
  expect(pred()).toBe(true);
}

/** A game that has played one shot and is planning the next. */
function afterOneShot(rules = FREE_RULES, seed = 21): Game {
  const g = new Game({ seed, rules });
  g.load({ rules, seed, tray: rules === TOYBOX_RULES ? fullTray(99) : undefined });
  runUntil(g, () => g.phase === 'plan');
  g.shoot(0.8);
  runUntil(g, () => g.phase === 'plan' && g.shots === 1);
  return g;
}

describe('instant replay', () => {
  it('plays the last shot again exactly as it went, then puts the game back as it was', () => {
    const g = afterOneShot();
    // Bend the table a little before watching: the replay must not lose it.
    const v = g.table.verts[2]!;
    expect(g.beginDrag({ kind: 'vertex', index: 2, x: v.x, y: v.y, pocket: v.pocket }, v.x, v.y)).toBe(true);
    g.dragTo(v.x + 40, v.y - 30);
    g.endDrag();
    const before = JSON.stringify(snapState(g));
    const aim = g.aim;
    expect(g.canReplay).toBe(true);
    expect(g.replay()).toBe(true);
    expect(g.phase).toBe('replay');
    // On the table as it was before the shot.
    expect(hashBoard(g.table, g.balls)).toBe(hashBoard(g.history[0]!.pre.table, g.history[0]!.pre.balls));
    runUntil(g, () => g.phase === 'plan');
    expect(g.replayOk).toBe(true);
    expect(JSON.stringify(snapState(g))).toBe(before);
    expect(g.aim).toBe(aim);
    // The bend is still undoable.
    expect(g.undo()).toBe(true);
  });

  it('can be stopped part way', () => {
    const g = afterOneShot();
    const before = JSON.stringify(snapState(g));
    g.replay();
    for (let i = 0; i < 20; i++) g.update(DT);
    g.stopReplay();
    expect(g.phase).toBe('plan');
    expect(JSON.stringify(snapState(g))).toBe(before);
  });

  it('is only offered when there is a shot to watch', () => {
    const g = new Game({ seed: 4, rules: FREE_RULES });
    g.load({ rules: FREE_RULES, seed: 4 });
    runUntil(g, () => g.phase === 'plan');
    expect(g.canReplay).toBe(false);
    expect(g.replay()).toBe(false);
  });
});

describe('Toy Box', () => {
  it('REWIND takes the last shot back: same toys, balls where they were, same aim', () => {
    const g = new Game({ seed: 9, rules: TOYBOX_RULES });
    g.load({ rules: TOYBOX_RULES, seed: 9, tray: fullTray(99) });
    runUntil(g, () => g.phase === 'plan');
    expect(g.placeFromTray(2, 600, 120)).toBe(true);
    const balls = g.balls.map((b) => [b.x, b.y]);
    const parts = JSON.stringify(g.table.parts);
    const aim = g.aim;
    g.shoot(0.9);
    runUntil(g, () => g.phase === 'plan' && g.shots === 1);
    expect(g.canRewind).toBe(true);
    expect(g.rewind()).toBe(true);
    expect(g.shots).toBe(0);
    expect(g.history).toHaveLength(0);
    expect(g.aim).toBe(aim);
    expect(g.dial).toBe(0.9);
    expect(JSON.stringify(g.table.parts)).toBe(parts);
    expect(g.balls.map((b) => [b.x, b.y])).toEqual(balls);
    expect(g.balls.every((b) => b.active)).toBe(true);
    expect(g.canRewind).toBe(false);
  });

  it('RESPIN spins the cue again without counting a stroke', () => {
    const g = new Game({ seed: 12, rules: TOYBOX_RULES });
    g.load({ rules: TOYBOX_RULES, seed: 12, tray: fullTray(99) });
    runUntil(g, () => g.phase === 'plan');
    const aim = g.aim;
    expect(g.respin()).toBe(true);
    expect(g.phase).toBe('spin');
    runUntil(g, () => g.phase === 'plan');
    expect(g.aim).not.toBe(aim);
    expect(g.shots).toBe(0);
  });

  it('CLEAR puts every toy back in the box, as one undoable edit', () => {
    const g = new Game({ seed: 3, rules: TOYBOX_RULES });
    g.load({ rules: TOYBOX_RULES, seed: 3, tray: fullTray(99) });
    runUntil(g, () => g.phase === 'plan');
    const portal = g.tray.findIndex((t) => t.preset.kind === 'portal');
    expect(g.placeFromTray(0, 500, 120)).toBe(true);
    expect(g.placeFromTray(portal, 300, 380)).toBe(true);
    expect(g.table.parts).toHaveLength(3);
    expect(g.clearToys()).toBe(true);
    expect(g.table.parts).toHaveLength(0);
    expect(g.tray.every((t) => t.count === 99)).toBe(true);
    expect(g.undo()).toBe(true);
    expect(g.table.parts).toHaveLength(3);
    // Free Play has no CLEAR.
    const f = new Game({ seed: 3, rules: FREE_RULES });
    f.load({ rules: FREE_RULES, seed: 3, tray: fullTray() });
    runUntil(f, () => f.phase === 'plan');
    f.placeFromTray(0, 500, 120);
    expect(f.clearToys()).toBe(false);
  });
});

describe('shared shots', () => {
  it('a link carries a shot exactly: decoded, it replays to the same resting place', async () => {
    const g = afterOneShot(FREE_RULES, 33);
    const rec = g.history[0]!;
    const shared = sharedFromRecord(rec, g.rules.mode, g.tableName);
    const code = await encodeShot(shared);
    expect(code.startsWith('z')).toBe(true);
    const url = shareUrl(code, { origin: 'https://example.test', pathname: '/bendy/' });
    expect(url).toBe(`https://example.test/bendy/#s=${code}`);
    expect(codeFromHash(`#s=${code}`)).toBe(code);
    const back = await decodeShot(codeFromHash(`#s=${code}`)!);
    expect(back).toEqual(shared);
    expect(simulateShot(back!.pre, back!.shot).hash).toBe(rec.postHash);
    // And through the viewer, over and over.
    const v = new Game({ seed: 1, rules: FREE_RULES });
    v.watch(replaySourceOf(back!), back!.name ?? undefined);
    expect(v.rules.mode).toBe('viewer');
    runUntil(v, () => v.replayOk !== null);
    expect(v.replayOk).toBe(true);
    runUntil(v, () => v.phase === 'replay' && v.phaseT < 0.1, 10);
    v.quit();
    expect(v.phase).toBe('title');
  });

  it('turns away broken or doctored links', async () => {
    expect(await decodeShot('zAAAA')).toBeNull();
    expect(await decodeShot('x' + 'A'.repeat(20))).toBeNull();
    expect(await decodeShot('j' + btoa('{"v":1}'))).toBeNull();
    const g = afterOneShot(FREE_RULES, 5);
    const shared = sharedFromRecord(g.history[0]!, 'free', null);
    const raw = (s: unknown) =>
      'j' + btoa(JSON.stringify(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await decodeShot(raw(shared))).toEqual(shared);
    const bad = structuredClone(shared);
    (bad.pre.balls[1] as unknown as { x: unknown }).x = 'evil';
    expect(await decodeShot(raw(bad))).toBeNull();
    const pinched = structuredClone(shared);
    pinched.pre.table.verts[1]!.y = 495;
    expect(await decodeShot(raw(pinched))).toBeNull();
  });
});
