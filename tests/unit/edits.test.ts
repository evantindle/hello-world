import { describe, expect, it } from 'vitest';
import { BUDGET } from '../../src/config';
import { Game, type GameSetup } from '../../src/game/game';
import type { TrayItem } from '../../src/game/placement';
import { listHandles } from '../../src/game/reshape';
import { FREE_RULES, TOYBOX_RULES, type Ruleset } from '../../src/game/ruleset';
import type { Part } from '../../src/geom/parts';

const DT = 1 / 60;

function runUntil(g: Game, pred: () => boolean, maxSeconds = 60) {
  let t = 0;
  while (!pred() && t < maxSeconds) {
    g.update(DT);
    t += DT;
  }
  expect(pred()).toBe(true);
}

const TOKENS: Ruleset = {
  ...FREE_RULES,
  mode: 'classic',
  reshape: { kind: 'tokens', tokens: 2, reach: 200 },
};

const TRAY: TrayItem[] = [
  { preset: { kind: 'stub', dir: { x: 1, y: 0 }, len: 140 }, count: 2 },
  { preset: { kind: 'booster', dir: { x: 1, y: 0 }, len: 120, wid: 60, kick: 600 }, count: 1 },
  { preset: { kind: 'bumper', r: 28 }, count: 1 },
];

/** A game in its first plan phase. */
function planning(rules: Ruleset, extra: Partial<GameSetup> = {}, seed = 4): Game {
  const g = new Game({ seed, rules });
  g.load({ rules, seed, tray: TRAY, ...extra });
  runUntil(g, () => g.phase === 'plan');
  return g;
}

/** The state edits can change, for comparisons. */
function board(g: Game) {
  return JSON.stringify({
    t: g.table,
    b: g.balls.map((b) => [b.x, b.y]),
    budget: g.budget,
    tokens: g.tokens,
    tray: g.tray.map((t) => t.count),
  });
}

function drag(g: Game, index: number, x: number, y: number) {
  const v = g.table.verts[index]!;
  const h = listHandles(g.table).find((q) => q.kind === 'vertex' && q.index === index)!;
  expect(g.beginDrag(h, v.x, v.y)).toBe(true);
  g.dragTo(x, y);
  g.endDrag();
}

describe('undo, redo, reset', () => {
  it('undo and redo step through edits one at a time; a new edit forgets the redo steps', () => {
    const g = planning(FREE_RULES);
    const s0 = board(g);
    drag(g, 3, 1060, 540);
    const s1 = board(g);
    drag(g, 0, -40, -30);
    const s2 = board(g);
    expect(g.canUndo).toBe(true);
    expect(g.canRedo).toBe(false);
    expect(g.undo()).toBe(true);
    expect(board(g)).toBe(s1);
    expect(g.undo()).toBe(true);
    expect(board(g)).toBe(s0);
    expect(g.undo()).toBe(false);
    expect(g.redo()).toBe(true);
    expect(board(g)).toBe(s1);
    expect(g.redo()).toBe(true);
    expect(board(g)).toBe(s2);
    g.undo();
    drag(g, 5, -30, 540);
    expect(g.canRedo).toBe(false);
  });

  it('reset goes back to the start of the turn, and can itself be undone', () => {
    const g = planning(FREE_RULES);
    const s0 = board(g);
    expect(g.canReset).toBe(false);
    drag(g, 3, 1060, 540);
    g.placeFromTray(0, 500, 250);
    const s2 = board(g);
    expect(g.canReset).toBe(true);
    expect(g.reset()).toBe(true);
    expect(board(g)).toBe(s0);
    expect(g.canReset).toBe(false);
    expect(g.undo()).toBe(true);
    expect(board(g)).toBe(s2);
  });

  it('undo refunds the stretch an edit cost', () => {
    const g = planning(FREE_RULES);
    drag(g, 3, 1060, 540);
    const spent = g.budget;
    expect(spent).toBeLessThan(BUDGET);
    drag(g, 0, -40, -30);
    expect(g.budget).toBeLessThan(spent);
    g.undo();
    expect(g.budget).toBe(spent);
    g.undo();
    expect(g.budget).toBe(BUDGET);
  });
});

describe('grab tokens', () => {
  it('each grab that moves something costs one; with none left, grabs are refused', () => {
    const g = planning(TOKENS);
    const blocked: string[] = [];
    g.events.on('blocked', (e) => blocked.push(e.reason));
    expect(g.budget).toBe(Infinity);
    drag(g, 3, 1060, 540);
    expect(g.tokens).toBe(1);
    drag(g, 0, -40, -30);
    expect(g.tokens).toBe(0);
    const h = listHandles(g.table).find((q) => q.kind === 'vertex' && q.index === 5)!;
    expect(g.beginDrag(h, h.x, h.y)).toBe(false);
    expect(blocked).toContain('tokens');
    // Undo gives the token back.
    g.undo();
    expect(g.tokens).toBe(1);
  });

  it('a grab reaches only so far', () => {
    const g = planning(TOKENS);
    const reasons: string[] = [];
    g.events.on('blocked', (e) => reasons.push(e.reason));
    const v = g.table.verts[3]!;
    const h = listHandles(g.table).find((q) => q.kind === 'vertex' && q.index === 3)!;
    g.beginDrag(h, v.x, v.y);
    g.dragTo(1100, 600); // 141 away: fine
    g.dragTo(1100, 1000); // way beyond: stops at the reach (and the play area)
    g.endDrag();
    expect(Math.hypot(v.x - 1000, v.y - 500)).toBeLessThanOrEqual(200 + 1e-6);
    expect(reasons).toContain('reach');
  });

  it('a new bend let go of without moving is free and leaves no trace', () => {
    const g = planning(TOKENS);
    const before = board(g);
    const h = listHandles(g.table).find((q) => q.kind === 'edge')!;
    expect(g.beginDrag(h, h.x, h.y)).toBe(true);
    g.dragTo(h.x + 1, h.y);
    g.endDrag();
    expect(board(g)).toBe(before);
    expect(g.edits).toEqual([]);
    expect(g.canUndo).toBe(false);
  });

  it('toys from the tray go down free and move free until the shot; after it, a move costs a token', () => {
    const g = planning(TOKENS);
    expect(g.placeFromTray(0, 500, 250)).toBe(true);
    expect(g.tray[0]!.count).toBe(1);
    expect(g.tokens).toBe(2);
    const id = g.table.parts[0]!.id;
    expect(g.beginPartDrag(id, 500, 250, false)).toBe(true);
    g.partDragTo(560, 300);
    g.endPartDrag();
    expect(g.table.parts[0]).toMatchObject({ x: 560, y: 300 });
    expect(g.tokens).toBe(2);
    // Dropped off the table: back in the tray, still free.
    expect(g.beginPartDrag(id, 560, 300, false)).toBe(true);
    g.endPartDrag(true);
    expect(g.table.parts).toHaveLength(0);
    expect(g.tray[0]!.count).toBe(2);
    expect(g.tokens).toBe(2);
    // Put it down, take the shot: next turn, moving it costs.
    g.placeFromTray(0, 500, 380);
    g.shoot(0.2);
    runUntil(g, () => g.shots === 1 && g.phase === 'plan');
    const p = g.table.parts[0]!;
    expect(g.beginPartDrag(p.id, p.x, p.y, false)).toBe(true);
    g.partDragTo(p.x - 60, p.y);
    g.endPartDrag();
    expect(g.tokens).toBe(1);
  });
});

describe('the tray', () => {
  it('will not put a toy on a pocket, off the table, or on another toy', () => {
    const g = planning(FREE_RULES);
    const reasons: string[] = [];
    g.events.on('partBlocked', (e) => reasons.push(e.reason));
    // Across the middle pocket's mouth.
    expect(g.canPlace(0, 500, 50)).toBe(false);
    expect(g.placeFromTray(0, 500, 50)).toBe(false);
    expect(g.placeFromTray(0, 500, -50)).toBe(false);
    expect(g.canPlace(0, 500, 250)).toBe(true);
    expect(g.placeFromTray(0, 500, 250)).toBe(true);
    expect(g.placeFromTray(0, 500, 262)).toBe(false);
    expect(reasons).toEqual(['on-pocket', 'off-table', 'overlap']);
    expect(g.tray[0]!.count).toBe(1);
  });

  it('spins arrows at random in Free Play, but the same way again after an undo', () => {
    const g = planning(FREE_RULES);
    const d = g.placementDir(1)!;
    g.placeFromTray(1, 500, 250);
    const placed = g.table.parts[0] as Part & { kind: 'booster' };
    expect(placed.dir).toEqual(d);
    g.undo();
    expect(g.placementDir(1)).toEqual(d);
    // Fixed arrows keep the tray's direction.
    const c = planning({ ...TOKENS, arrows: 'fixed' });
    expect(c.placementDir(1)).toEqual({ x: 1, y: 0 });
  });

  it('turns walls in Free Play but arrows only in the Toy Box', () => {
    const g = planning(FREE_RULES);
    g.placeFromTray(0, 500, 250);
    g.placeFromTray(1, 300, 380);
    const [wall, pad] = g.table.parts;
    expect(g.turnable()).toEqual([wall!.id]);
    expect(g.beginPartDrag(pad!.id, pad!.x, pad!.y, true)).toBe(false);
    expect(g.beginPartDrag(wall!.id, wall!.x, wall!.y, true)).toBe(true);
    g.turnPartTo(9);
    g.endPartDrag();
    expect((g.table.parts[0] as Part & { kind: 'stub' }).dir).toEqual({ x: 707, y: 707 });
    const t = planning(TOYBOX_RULES);
    t.placeFromTray(1, 300, 380);
    expect(t.turnable()).toHaveLength(1);
  });
});

describe('recorded edits', () => {
  it('replaying a turn’s edits rebuilds exactly the same table', () => {
    const g = planning(FREE_RULES);
    drag(g, 3, 1043.3, 541.7);
    const edge = listHandles(g.table).find((q) => q.kind === 'edge' && q.index === 0)!;
    g.beginDrag(edge, edge.x, edge.y);
    g.dragTo(edge.x + 13.1, edge.y - 41.9);
    g.dragTo(edge.x + 20.7, edge.y - 60.2);
    g.endDrag();
    g.placeFromTray(0, 455.55, 240.1);
    g.placeFromTray(2, 640.2, 300.3);
    const wall = g.table.parts[0]!;
    g.beginPartDrag(wall.id, wall.x, wall.y, false);
    g.partDragTo(wall.x - 30.33, wall.y + 12.12);
    g.endPartDrag();
    g.beginPartDrag(wall.id, wall.x, wall.y, true);
    g.turnPartTo(7);
    g.turnPartTo(12);
    g.endPartDrag();
    g.undo();
    g.redo();
    g.placeFromTray(1, 200, 400);
    g.undo();
    const live = board(g);
    const edits = structuredClone(g.edits);
    for (const e of edits) if ('path' in e) for (const v of e.path) expect(v * 64).toBe(Math.round(v * 64));

    const r = planning(FREE_RULES);
    for (const e of edits) r.applyEdit(e);
    expect(board(r)).toBe(live);
    expect(r.edits).toEqual(edits);
  });

  it('a stroke remembers the edits made before it', () => {
    const g = planning(FREE_RULES);
    drag(g, 3, 1060, 540);
    g.placeFromTray(0, 500, 250);
    const edits = structuredClone(g.edits);
    g.shoot(0.3);
    runUntil(g, () => g.history.length === 1);
    expect(g.history[0]!.edits).toEqual(edits);
    expect(g.history[0]!.pre.tray[0]!.count).toBe(1);
  });
});
