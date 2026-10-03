import { describe, expect, it } from 'vitest';
import { R } from '../../src/config';
import { createRng } from '../../src/core/rng';
import { buildGeom, createTable, type Table } from '../../src/geom/table';
import { createWorld, type Ball } from '../../src/physics/world';
import { ball, hashBalls, runUntilStopped } from './helpers';

/**
 * Golden runs: fixed scenes simulated to rest and hashed to the last bit. A refactor of the
 * physics must reproduce them exactly. When a change is MEANT to alter the simulation, re-baseline
 * with `GOLDEN=print npx vitest run tests/unit/golden.test.ts` and say why in the commit.
 */
const GOLDEN: Record<string, number> = {
  break: 3933869153,
  angled: 2696278295,
  'bent-hungry': 445881032,
  pockets: 2295447101,
  scatter: 3253959727,
};

function rack(cueX: number, cueY: number, vx: number, vy: number, apexX = 700, apexY = 250): Ball[] {
  const balls = [ball(0, cueX, cueY, vx, vy)];
  const pitch = 2 * R + 0.6;
  const dx = pitch * (Math.sqrt(3) / 2);
  let num = 1;
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) balls.push(ball(num++, apexX + row * dx, apexY + (j - row / 2) * pitch));
  }
  return balls;
}

function bentTable(): Table {
  const t = createTable();
  t.verts[1]!.y = -80;
  t.verts[3]!.x = 950;
  t.verts[3]!.y = 560;
  t.verts.splice(5, 0, { id: t.nextId++, x: 250, y: 560, pocket: false });
  return t;
}

function scatter(): Ball[] {
  const rng = createRng(1234);
  const balls: Ball[] = [];
  let id = 0;
  for (let gx = 0; gx < 4 && id < 11; gx++) {
    for (let gy = 0; gy < 3 && id < 11; gy++) {
      const x = 140 + gx * 240 + rng.range(-40, 40);
      const y = 110 + gy * 140 + rng.range(-30, 30);
      balls.push(ball(id, x, y));
      id++;
    }
  }
  balls[0]!.vx = 700;
  balls[0]!.vy = -2900;
  return balls;
}

function scene(name: string): { balls: Ball[]; table: Table; hunger: number } {
  switch (name) {
    case 'break':
      return { balls: rack(250, 250, 2900, 40), table: createTable(), hunger: 0 };
    case 'angled':
      return { balls: rack(250, 250, 1300, 1000), table: createTable(), hunger: 3 };
    case 'bent-hungry':
      return { balls: rack(300, 150, 1900, 830, 640, 300), table: bentTable(), hunger: 2 };
    case 'pockets': {
      // A ball rolled at a corner, one sliding along a rail past a side pocket, and a cue scratch.
      const balls = [ball(0, 150, 400, -500, 420), ball(1, 880, 120, 420, -420), ball(2, 300, 470, 900, 0)];
      return { balls, table: createTable(), hunger: 1 };
    }
    default:
      return { balls: scatter(), table: createTable(), hunger: 1 };
  }
}

function simulate(name: string): number {
  const { balls, table, hunger } = scene(name);
  const w = createWorld(balls, buildGeom(table, hunger));
  const events = runUntilStopped(w, 6000);
  const h = hashBalls(balls).f64(w.t);
  if (process.env['GOLDEN'] === 'print') {
    const pots = events.filter((e) => e.type === 'pocketed').length;
    const hits = events.filter((e) => e.type === 'ballHit').length;
    console.log(`GOLDEN ${name}: t=${w.t.toFixed(2)} stopped=${w.stopped} pots=${pots} hits=${hits}`);
  }
  for (const e of events) {
    h.str(e.type);
    if (e.type === 'pocketed') h.f64(e.ball.id).f64(e.pocket.vid);
  }
  return h.value;
}

describe('golden simulations', () => {
  for (const name of Object.keys(GOLDEN)) {
    it(`${name} plays out bit-for-bit as recorded`, () => {
      const got = simulate(name);
      if (process.env['GOLDEN'] === 'print') console.log(`GOLDEN ${name}: ${got}`);
      else expect(got).toBe(GOLDEN[name]);
    });
  }
});
