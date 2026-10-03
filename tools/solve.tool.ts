import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { levelById, REC_ROOM } from '../src/game/levels/rec-room';
import { solve, type SolveOpts } from './solver';

/**
 * Finds (and saves) a solution for each level, trying for three stars first:
 *   npm run solve                    (every level without a saved solution)
 *   LEVEL=rr-03,rr-04 npm run solve  (just these, even if saved)
 *   FORCE=1 npm run solve            (every level, replacing saved ones)
 *   BEAM=4, VERBOSE=1                (beam width; progress logs)
 *   QUICK=1                          (only the quick, coarse search)
 */
const DIR = path.resolve(__dirname, '../tests/levels/solutions');

it('solves levels', () => {
  const only = process.env['LEVEL']?.split(',');
  const defs = only ? only.map((id) => levelById(id)!).filter(Boolean) : REC_ROOM;
  for (const def of defs) {
    const file = path.join(DIR, `${def.id}.json`);
    if (!only && !process.env['FORCE'] && fs.existsSync(file)) continue;
    const t0 = Date.now();
    console.log(`${def.id} ${def.name}`);
    const tries = [
      { stars: 3, tokens: def.stars.three.tokens ?? def.tokens, strokes: def.stars.three.score ?? def.shots },
      { stars: 2, tokens: def.stars.two.tokens ?? def.tokens, strokes: def.stars.two.score ?? def.shots },
      { stars: 1, tokens: def.tokens, strokes: def.shots },
    ];
    let saved = false;
    const log = process.env['VERBOSE'] ? console.log : undefined;
    const beam = process.env['BEAM'] ? Number(process.env['BEAM']) : undefined;
    // A quick, coarse search first (most levels fall to it); the full one only if it fails.
    const passes: [string, SolveOpts][] = [
      [
        'quick',
        {
          log,
          beam: beam ?? 3,
          pairs: 4,
          dirStep: 8,
          radii: [0.5, 1],
          english: [
            [0, 0],
            [0, 0.8],
            [0, -0.8],
          ],
        },
      ],
      ['full', { log, beam }],
    ];
    for (const t of tries) {
      const limits = {
        tokens: Math.min(t.tokens, def.tokens),
        strokes: Math.min(t.strokes, def.shots),
        stars: t.stars,
      };
      let sol = null;
      for (const [name, opts] of passes) {
        if (process.env['QUICK'] && name === 'full') break;
        sol = solve(def, limits, opts);
        if (sol) break;
        console.log(`  no ${t.stars}-star solution in the ${name} search`);
      }
      if (!sol) continue;
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(sol, null, 1)}\n`);
      console.log(
        `  solved: ${sol.stars} stars in ${sol.strokes.length} strokes (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
      );
      saved = true;
      break;
    }
    if (!saved) console.log(`  UNSOLVED (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
});
