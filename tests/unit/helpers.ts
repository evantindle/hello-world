import { H } from '../../src/config';
import { buildGeom, createTable, type Table, type TableGeom } from '../../src/geom/table';
import { createWorld, makeBall, stepWorld, type Ball, type PhysEvent, type World } from '../../src/physics/world';

/** A plain ball: id 0 is the cue, everything else an object ball numbered by its id. */
export function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return makeBall({ id, x, y, vx, vy });
}

/** The starting rectangle with every pocket plugged (no holes). */
export function sealedTable(): Table {
  const t = createTable();
  for (const v of t.verts) v.pocket = false;
  return t;
}

export function run(balls: Ball[], table: Table | TableGeom, seconds: number) {
  const geom = 'verts' in table ? buildGeom(table) : table;
  const w = createWorld(balls, geom);
  const events: PhysEvent[] = [];
  const steps = Math.round(seconds / H);
  for (let i = 0; i < steps; i++) stepWorld(w, H, events);
  return { w, events };
}

/** Steps until the world reports it has stopped (or the step cap runs out). */
export function runUntilStopped(w: World, maxSteps = 4000): PhysEvent[] {
  const events: PhysEvent[] = [];
  for (let i = 0; i < maxSteps && !w.stopped; i++) stepWorld(w, H, events);
  return events;
}

/** FNV-1a over raw float64 bytes: two runs hash equal only if they agree to the last bit. */
export class Hasher {
  private h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  f64(x: number): this {
    this.view.setFloat64(0, x);
    for (let i = 0; i < 8; i++) {
      this.h ^= this.view.getUint8(i);
      this.h = Math.imul(this.h, 16777619);
    }
    return this;
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 16777619);
    }
    return this;
  }

  get value(): number {
    return this.h >>> 0;
  }
}

export function hashBalls(balls: readonly Ball[], h = new Hasher()): Hasher {
  for (const b of balls) h.f64(b.x).f64(b.y).f64(b.vx).f64(b.vy).f64(b.active ? 1 : 0);
  return h;
}
