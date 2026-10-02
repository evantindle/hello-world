import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { R } from '../../src/config';
import { hyp } from '../../src/core/vec';
import { REC_ROOM } from '../../src/game/levels/rec-room';
import { setupFromLevel } from '../../src/game/levels/setup';
import { playSolution, type Solution } from '../../src/game/levels/solution';
import { checkParts } from '../../src/game/placement';
import { distToSegment, pointInPolygon } from '../../src/geom/polygon';
import { buildGeom, validateTable } from '../../src/geom/table';

const DIR = path.resolve(__dirname, '../levels/solutions');

function solutionFor(id: string): Solution | null {
  const file = path.join(DIR, `${id}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Solution) : null;
}

describe('the Rec Room levels', () => {
  it('are numbered in order with unique ids', () => {
    expect(REC_ROOM.map((l) => l.n)).toEqual(REC_ROOM.map((_, i) => i + 1));
    expect(new Set(REC_ROOM.map((l) => l.id)).size).toBe(REC_ROOM.length);
  });

  for (const def of REC_ROOM) {
    describe(`${def.id} ${def.name}`, () => {
      it('is a valid layout', () => {
        const setup = setupFromLevel(def);
        const table = setup.table!;
        const geom = buildGeom(table);
        expect(validateTable(table, geom)).toEqual({ ok: true });
        expect(checkParts(table, geom)).toEqual({ ok: true });
        // The cue ball first; every ball on the felt, clear of the rails and of each other.
        const balls = setup.balls!;
        expect(balls[0]!.kind).toBe('cue');
        expect(balls.slice(1).every((b) => b.kind === 'object')).toBe(true);
        for (const b of balls) {
          expect(pointInPolygon(b.x, b.y, geom.poly)).toBe(true);
          for (const r of geom.rails)
            expect(distToSegment(b.x, b.y, r.ax, r.ay, r.bx, r.by)).toBeGreaterThan(R);
          for (const o of balls) if (o !== b) expect(hyp(o.x - b.x, o.y - b.y)).toBeGreaterThan(2 * R);
        }
        // One angle per stroke, and star conditions inside the level's limits.
        expect(def.angles.length).toBe(def.shots);
        for (const c of [def.stars.three, def.stars.two]) {
          if (c.score !== undefined) expect(c.score).toBeLessThanOrEqual(def.shots);
          if (c.tokens !== undefined) expect(c.tokens).toBeLessThanOrEqual(def.tokens);
        }
      });

      it('has a recorded solution that still wins', () => {
        const sol = solutionFor(def.id);
        expect(sol, `tests/levels/solutions/${def.id}.json (npm run solve)`).not.toBeNull();
        const g = playSolution(def, sol!);
        expect(g.phase).toBe('over');
        expect(g.lastOver?.result).toBe('win');
        expect(g.lastOver!.stars).toBeGreaterThanOrEqual(sol!.stars);
        expect(g.score).toBeLessThanOrEqual(def.shots);
        expect(g.score).toBe(sol!.strokes.length);
      });
    });
  }
});
