import type { Table } from '../geom/table';

interface Spring2 {
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

interface Spring1 {
  b: number;
  v: number;
}

const K = 170; // stiffness
const C = 2 * Math.sqrt(K) * 0.18; // light damping: wobbly on purpose
const MAX_OFF = 24;
const MAX_BULGE = 18;

/**
 * Visual-only jelly: every vertex has a damped spring offset and every edge a bulge spring.
 * Physics never sees this; it just makes the table look like it is made of gummy candy.
 */
export class Jelly {
  private verts = new Map<number, Spring2>();
  /** Keyed by the id of the vertex the edge starts at. */
  private bulges = new Map<number, Spring1>();
  energy = 0;

  sync(t: Table): void {
    const ids = new Set<number>();
    for (const v of t.verts) {
      ids.add(v.id);
      if (!this.verts.has(v.id)) this.verts.set(v.id, { ox: 0, oy: 0, vx: 0, vy: 0 });
      if (!this.bulges.has(v.id)) this.bulges.set(v.id, { b: 0, v: 0 });
    }
    for (const id of [...this.verts.keys()]) {
      if (!ids.has(id)) {
        this.verts.delete(id);
        this.bulges.delete(id);
      }
    }
  }

  reset(): void {
    this.verts.clear();
    this.bulges.clear();
  }

  update(dt: number): void {
    let e = 0;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const sp of this.verts.values()) {
        sp.vx += (-K * sp.ox - C * sp.vx) * h;
        sp.vy += (-K * sp.oy - C * sp.vy) * h;
        sp.ox += sp.vx * h;
        sp.oy += sp.vy * h;
        const l = Math.hypot(sp.ox, sp.oy);
        if (l > MAX_OFF) {
          sp.ox *= MAX_OFF / l;
          sp.oy *= MAX_OFF / l;
        }
      }
      for (const b of this.bulges.values()) {
        b.v += (-K * b.b - C * b.v) * h;
        b.b += b.v * h;
        if (b.b > MAX_BULGE) b.b = MAX_BULGE;
        else if (b.b < -MAX_BULGE) b.b = -MAX_BULGE;
      }
    }
    for (const sp of this.verts.values()) e += Math.abs(sp.ox) + Math.abs(sp.oy) + Math.abs(sp.vx) * 0.02;
    for (const b of this.bulges.values()) e += Math.abs(b.b) + Math.abs(b.v) * 0.02;
    this.energy = e;
  }

  get active(): boolean {
    return this.energy > 0.05;
  }

  offset(vid: number): { x: number; y: number } {
    const sp = this.verts.get(vid);
    return sp ? { x: sp.ox, y: sp.oy } : { x: 0, y: 0 };
  }

  bulge(fromVid: number): number {
    return this.bulges.get(fromVid)?.b ?? 0;
  }

  kickVertex(vid: number, ix: number, iy: number): void {
    const sp = this.verts.get(vid);
    if (!sp) return;
    sp.vx += ix;
    sp.vy += iy;
  }

  kickBulge(fromVid: number, amount: number): void {
    const b = this.bulges.get(fromVid);
    if (b) b.v += amount;
  }

  /** A ball slammed into edge `edge` at parameter u: the rail bows outward and rings. */
  wallHit(t: Table, edge: number, u: number, speed: number, nx: number, ny: number): void {
    const n = t.verts.length;
    const a = t.verts[edge];
    const b = t.verts[(edge + 1) % n];
    if (!a || !b) return;
    const j = Math.min(speed, 2600) * 0.16;
    const mid = 1 - Math.abs(2 * u - 1);
    this.kickBulge(a.id, j * (0.4 + mid));
    // (nx, ny) points from the rail into the table; vertices get shoved outward.
    this.kickVertex(a.id, -nx * j * 0.5 * (1 - u), -ny * j * 0.5 * (1 - u));
    this.kickVertex(b.id, -nx * j * 0.5 * u, -ny * j * 0.5 * u);
  }

  /** The logical vertex moved by (dx, dy): make the visual lag behind and the table wobble. */
  drag(t: Table, vid: number, dx: number, dy: number): void {
    const n = t.verts.length;
    const i = t.verts.findIndex((v) => v.id === vid);
    if (i < 0) return;
    t.verts.forEach((v, k) => {
      const sp = this.verts.get(v.id);
      if (!sp) return;
      const ring = Math.min(Math.abs(k - i), n - Math.abs(k - i));
      if (ring === 0) {
        sp.ox -= dx * 0.55;
        sp.oy -= dy * 0.55;
      } else {
        const f = ring === 1 ? 5 : 1.6;
        sp.vx += dx * f;
        sp.vy += dy * f;
      }
    });
    const prev = t.verts[(i + n - 1) % n]!;
    this.kickBulge(prev.id, Math.hypot(dx, dy) * 4);
    this.kickBulge(vid, Math.hypot(dx, dy) * 4);
  }

  wobbleAll(rand: () => number, amp: number): void {
    for (const sp of this.verts.values()) {
      sp.vx += (rand() * 2 - 1) * amp;
      sp.vy += (rand() * 2 - 1) * amp;
    }
    for (const b of this.bulges.values()) b.v += (rand() * 2 - 1) * amp;
  }
}
