import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { levelById, REC_ROOM } from '../src/game/levels/rec-room';
import { solve } from './solver';

/**
 * Finds (and saves) a solution for each level, trying for three stars first:
 *   npm run solve                    (every level without a saved solution)
 *   LEVEL=rr-03,rr-04 npm run solve  (just these, even if saved)
 *   FORCE=1 npm run solve            (every level, replacing saved ones)
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
    for (const t of tries) {
      const sol = solve(
        def,
        { tokens: Math.min(t.tokens, def.tokens), strokes: Math.min(t.strokes, def.shots), stars: t.stars },
        { log: process.env['VERBOSE'] ? console.log : undefined },
      );
      if (!sol) {
        console.log(`  no ${t.stars}-star solution found`);
        continue;
      }
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
