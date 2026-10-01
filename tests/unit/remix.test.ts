import { describe, expect, it } from 'vitest';
import { R } from '../../src/config';
import { checkParts } from '../../src/game/placement';
import { makeRemix, SHAPES, shapeProblems } from '../../src/game/remix';
import { distToSegment, pointInPolygon } from '../../src/geom/polygon';
import { buildGeom, validateTable } from '../../src/geom/table';

describe('Free Play remix', () => {
  it('every shape is a good table, and racks inside itself', () => {
    expect(shapeProblems()).toEqual([]);
    expect(SHAPES.length).toBeGreaterThanOrEqual(6);
  });

  it('deals playable tables: balls inside, clear of rails, holes and toys; toys in good places', () => {
    const shapes = new Set<string>();
    const twists = new Set<string>();
    for (let seed = 1; seed <= 160; seed++) {
      const level = seed % 4;
      const rx = makeRemix(seed, level);
      const geom = buildGeom(rx.table);
      expect(validateTable(rx.table, geom).ok).toBe(true);
      expect(checkParts(rx.table, geom).ok).toBe(true);
      expect(rx.twists.length).toBeLessThanOrEqual(level);
      if (level === 0) expect(rx.name).toBe('THE CLASSIC');
      shapes.add(rx.name.split(' · ')[0]!);
      rx.twists.forEach((t) => twists.add(t));
      for (const b of rx.balls) {
        expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
        for (const r of geom.rails)
          expect(distToSegment(b.x, b.y, r.ax, r.ay, r.bx, r.by)).toBeGreaterThanOrEqual(R - 1e-6);
        for (const o of rx.balls)
          if (o !== b) expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThanOrEqual(2 * R);
        // No ball starts in a hole's pull: no free pots.
        for (const p of geom.pockets)
          if (p.open) expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(p.sr);
        for (const f of geom.fields) expect(Math.hypot(f.x - b.x, f.y - b.y)).toBeGreaterThanOrEqual(f.r);
      }
      // At least two pockets still take balls at the start.
      expect(geom.pockets.filter((p) => p.open).length).toBeGreaterThanOrEqual(2);
    }
    expect(shapes.size).toBe(SHAPES.length);
    expect(twists.size).toBeGreaterThan(8);
  });

  it('deals the same table for the same seed', () => {
    expect(JSON.stringify(makeRemix(77))).toBe(JSON.stringify(makeRemix(77)));
    expect(JSON.stringify(makeRemix(77))).not.toBe(JSON.stringify(makeRemix(78)));
  });
});
