import { makeBall } from '../../physics/ball';
import type { GameSetup } from '../game';
import type { Ruleset } from '../ruleset';
import type { LevelDef } from './types';

/** The rules a Classic level plays by. */
export function classicRules(def: LevelDef): Ruleset {
  return {
    mode: 'classic',
    angles: { kind: 'sequence', deg: def.angles },
    reshape: { kind: 'tokens', tokens: def.tokens, reach: def.reach },
    shotLimit: def.shots,
    hunger: def.hunger ?? false,
    boltOnScratch: false,
    english: def.english,
    preview: 'guide',
    arrows: 'fixed',
    rewind: false,
    respin: false,
    par: def.shots,
    goal: def.goal,
    stars: def.stars,
  };
}

/** A new game of level `def`: its table, balls, tray, rules and seed. */
export function setupFromLevel(def: LevelDef): GameSetup {
  const verts = def.shape.map((v, id) => ({ ...structuredClone(v), id }));
  return {
    rules: classicRules(def),
    seed: def.seed ?? 1000 + def.n,
    table: { verts, parts: structuredClone(def.parts ?? []), nextId: verts.length },
    balls: def.balls.map((b) => makeBall({ id: b.num, num: b.num, x: b.x, y: b.y, variant: b.variant })),
    tray: structuredClone(def.tray ?? []),
    levelId: def.id,
    name: def.name,
  };
}
