import { describe, expect, it } from 'vitest';
import { R } from '../../src/config';
import type { Part } from '../../src/geom/parts';
import { buildGeom, createTable, type Table } from '../../src/geom/table';
import {
  checkParts,
  DIRS,
  hitPart,
  movePart,
  nearestDir,
  placePart,
  turnKnob,
  turnPart,
  type ArenaHost,
  type PartPreset,
} from '../../src/game/placement';
import { moveVertex, type ReshapeHost } from '../../src/game/reshape';
import { makeBall, type Ball } from '../../src/physics/world';

function host(parts: Part[], balls: Ball[] = [], pockets = true): ArenaHost & ReshapeHost {
  const table: Table = createTable();
  if (!pockets) for (const v of table.verts) v.pocket = false;
  table.parts = parts;
  return { table, geom: buildGeom(table), balls, hunger: 0, budget: Infinity };
}

const stub = (id: number, x: number, y: number, dx = 1, dy = 0, len = 160): Part => ({
  id,
  kind: 'stub',
  x,
  y,
  dir: { x: dx, y: dy },
  len,
});

describe('the direction table', () => {
  it('holds every multiple of 5 degrees, to the nearest thousandth', () => {
    expect(DIRS).toHaveLength(72);
    DIRS.forEach(([x, y], k) => {
      const a = (k * 5 * Math.PI) / 180;
      expect(Math.abs(x - Math.cos(a) * 1000)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y - Math.sin(a) * 1000)).toBeLessThanOrEqual(0.5);
    });
    expect(nearestDir(1, 0)).toBe(0);
    expect(nearestDir(0, 1)).toBe(18);
    expect(nearestDir(-1, -1)).toBe(45);
  });
});

describe('where toys may go', () => {
  it('a stub in open felt is fine; across a rail, on a pocket or on another stub it is not', () => {
    const ok = host([stub(1, 500, 250)]);
    expect(checkParts(ok.table, ok.geom).ok).toBe(true);
    const out = host([stub(1, 500, 10)]);
    expect(checkParts(out.table, out.geom).reason).toBe('off-table');
    const pocket = host([stub(1, 60, 60, 1, 1, 60)]);
    expect(checkParts(pocket.table, pocket.geom).reason).toBe('on-pocket');
    const pile = host([stub(1, 500, 250), stub(2, 500, 270, 0, 1)]);
    expect(checkParts(pile.table, pile.geom).reason).toBe('overlap');
  });

  it('pads may not overlap each other, but may lie under a wall', () => {
    const pad = (id: number, x: number): Part => ({
      id,
      kind: 'booster',
      x,
      y: 250,
      dir: { x: 1, y: 0 },
      len: 120,
      wid: 60,
      kick: 500,
    });
    const a = host([pad(1, 400), pad(2, 480)]);
    expect(checkParts(a.table, a.geom).reason).toBe('overlap');
    const b = host([pad(1, 400), pad(2, 560)]);
    expect(checkParts(b.table, b.geom).ok).toBe(true);
    const c = host([pad(1, 400), stub(2, 400, 250, 0, 1, 100)]);
    expect(checkParts(c.table, c.geom).ok).toBe(true);
  });

  it("a portal's whole disc must be on the table", () => {
    const p = (y: number): Part[] => [
      { id: 1, kind: 'portal', x: 300, y, link: 2, r: 40 },
      { id: 2, kind: 'portal', x: 700, y: 250, link: 1, r: 40 },
    ];
    const edge = host(p(30));
    expect(checkParts(edge.table, edge.geom).reason).toBe('off-table');
    const fine = host(p(60));
    expect(checkParts(fine.table, fine.geom).ok).toBe(true);
  });
});

describe('moving and turning toys', () => {
  it('a dragged stub stops at the last good spot before a rail', () => {
    const h = host([stub(1, 300, 250, 0, 1, 100)]);
    const r = movePart(h, 1, 300, -100);
    expect(r.blocked).toBe('off-table');
    const p = h.table.parts[0]!;
    // Its top end stops more than R + THICK below the top rail, within one step.
    expect(p.y - 50).toBeGreaterThanOrEqual(R + 6 - 1e-9);
    expect(p.y - 50).toBeLessThan(R + 6 + 12);
    expect(checkParts(h.table, h.geom).ok).toBe(true);
  });

  it('a dragged wall shoves balls, but may not crush one or push it into a pocket', () => {
    const b = makeBall({ id: 1, x: 500, y: 250 });
    const h = host([stub(1, 400, 250, 0, 1, 120)], [b]);
    const r = movePart(h, 1, 600, 250);
    expect(r.pushed.some((q) => q.id === 1)).toBe(true);
    expect(b.x).toBeGreaterThan(600);
    // Now toward the right rail: the ball gets squeezed and the stub stops short.
    const r2 = movePart(h, 1, 950, 250);
    expect(r2.blocked).not.toBeNull();
    expect(b.x).toBeLessThanOrEqual(1000 - R + 1e-6);
    // Toward a corner pocket: the ball may not be shoved into its pull.
    const c = makeBall({ id: 2, x: 150, y: 150 });
    const h2 = host([stub(1, 260, 260, 1, -1, 60)], [c]);
    const r3 = movePart(h2, 1, 40, 40);
    expect(r3.blocked).not.toBeNull();
    const pk = h2.geom.pockets.find((q) => q.vid === 0)!;
    expect(Math.hypot(c.x - pk.x, c.y - pk.y)).toBeGreaterThanOrEqual(pk.sr - 1e-6);
  });

  it('turning goes 5 degrees at a time and stops before hitting a rail', () => {
    // A long stub near the top rail, lying flat: turning it upright would poke the rail.
    const h = host([stub(1, 300, 140, 1, 0, 240)]);
    const res = turnPart(h, 1, 18);
    expect(res.blocked).toBe('off-table');
    expect(res.steps).toBeGreaterThan(0);
    expect(res.steps).toBeLessThan(18);
    const p = h.table.parts[0] as Part & { kind: 'stub' };
    expect([p.dir.x, p.dir.y]).toEqual([...DIRS[res.steps]!]);
    expect(checkParts(h.table, h.geom).ok).toBe(true);
  });

  it('a curved rail turns as a whole', () => {
    const h = host([
      { id: 1, kind: 'arc', x: 500, y: 250, r: 120, from: { x: 1000, y: 0 }, to: { x: 0, y: 1000 } },
    ]);
    const before = turnKnob(h.table.parts[0]!)!;
    expect(turnPart(h, 1, 9 + 18).steps).toBe(18);
    const p = h.table.parts[0] as Part & { kind: 'arc' };
    expect([p.from.x, p.from.y]).toEqual([0, 1000]);
    expect([p.to.x, p.to.y]).toEqual([-1000, 0]);
    const after = turnKnob(p)!;
    // The knob went a quarter turn round the centre.
    expect((before.x - 500) * (after.x - 500) + (before.y - 250) * (after.y - 250)).toBeCloseTo(0, 6);
  });

  it('bending a rail into a toy is blocked', () => {
    const h = host([stub(1, 500, 120, 1, 0, 160)], [], false);
    // Drag the top-middle vertex down onto the stub.
    const r = moveVertex(h, 1, 500, 200);
    expect(r.blocked).toBe('part-in-the-way');
    expect(h.table.verts[1]!.y).toBeLessThan(120 - R);
  });
});

describe('putting toys down', () => {
  const magnet: PartPreset = { kind: 'magnet', polarity: 1, r: 140, strength: 1000 };

  it('a toy that does not fit leaves no trace', () => {
    const h = host([stub(1, 500, 250)]);
    const before = JSON.stringify(h.table);
    const r = placePart(h, { kind: 'stub', dir: { x: 0, y: 1 }, len: 160 }, 500, 260);
    expect(r.ids).toEqual([]);
    expect('blocked' in r && r.blocked).toBe('overlap');
    expect(JSON.stringify(h.table)).toBe(before);
  });

  it('a magnet may not land with a ball in its reach, but may be dragged away from one', () => {
    const b = makeBall({ id: 1, x: 500, y: 250 });
    const h = host([], [b]);
    const near = placePart(h, magnet, 560, 250);
    expect('blocked' in near && near.blocked).toBe('keep-out');
    const far = placePart(h, magnet, 760, 250);
    expect(far.ids).toHaveLength(1);
    // Toward the ball: no. Away: fine (even starting with the ball inside, after a shot).
    const id = far.ids[0]!;
    expect(movePart(h, id, 600, 250).blocked).toBe('keep-out');
    h.balls[0]!.x = 600;
    expect(movePart(h, id, 820, 250).blocked).toBeNull();
  });

  it('a portal comes as a linked pair, the far end across the table', () => {
    const h = host([]);
    const r = placePart(h, { kind: 'portal', link: -1, r: 38 }, 300, 150);
    expect(r.ids).toHaveLength(2);
    const [a, b] = r.ids.map((id) => h.table.parts.find((p) => p.id === id)!) as (Part & {
      kind: 'portal';
    })[];
    expect(a!.link).toBe(b!.id);
    expect(b!.link).toBe(a!.id);
    expect([b!.x, b!.y]).toEqual([700, 350]);
    expect(h.geom.portals).toHaveLength(2);
  });

  it('finds toys under the pointer, knobs first', () => {
    const h = host([
      stub(1, 500, 250),
      { id: 2, kind: 'felt', felt: 'ice', x: 500, y: 250, dir: { x: 1, y: 0 }, w: 300, h: 200 },
    ]);
    // On the stub (which lies on the ice): the stub.
    expect(hitPart(h.table, 520, 253, 10, [])?.id).toBe(1);
    // Elsewhere on the ice: the ice.
    expect(hitPart(h.table, 420, 320, 10, [])?.id).toBe(2);
    const k = turnKnob(h.table.parts[0]!)!;
    expect(hitPart(h.table, k.x, k.y, 10, [1])).toMatchObject({ kind: 'part-rot', id: 1 });
  });
});
