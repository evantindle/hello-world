import { COLORS } from '../config';

export type ParticleKind = 'dust' | 'confetti' | 'spark' | 'star' | 'sweat' | 'ring' | 'ember' | 'drool';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  drag: number;
  /** Screen-space "gravity" (world units/s^2 along +y of the world). */
  g: number;
}

const CONFETTI = ['#ff4d6d', '#ffd23f', '#3a86ff', '#06d6a0', '#8e44ec', '#ff8a1f', '#ffffff'];

export class Particles {
  readonly list: Particle[] = [];
  cap = 800;

  spawn(p: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y'>): void {
    if (this.list.length >= this.cap) this.list.shift();
    const max = p.max ?? p.life ?? 0.6;
    this.list.push({
      vx: 0,
      vy: 0,
      size: 6,
      rot: 0,
      vr: 0,
      color: '#fff',
      drag: 2,
      g: 0,
      ...p,
      life: p.life ?? max,
      max,
    });
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    const l = this.list;
    let w = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i]!;
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      l[w++] = p;
    }
    l.length = w;
  }

  // ---------------------------------------------------------------- recipes

  dust(x: number, y: number, n: number, speed: number, rand: () => number, color = '#fff6e0'): void {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const s = speed * (0.3 + rand() * 0.7);
      this.spawn({
        kind: 'dust',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 6 + rand() * 10,
        life: 0.35 + rand() * 0.35,
        drag: 5,
        color,
      });
    }
  }

  sparks(
    x: number,
    y: number,
    nx: number,
    ny: number,
    n: number,
    speed: number,
    rand: () => number,
    color = '#fff3b0',
  ): void {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const a = base + (rand() - 0.5) * 2.2;
      const s = speed * (0.4 + rand() * 0.8);
      this.spawn({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 10 + rand() * 12,
        life: 0.18 + rand() * 0.2,
        drag: 6,
        color,
      });
    }
  }

  confetti(x: number, y: number, n: number, speed: number, rand: () => number): void {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const s = speed * (0.3 + rand());
      this.spawn({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.4,
        size: 7 + rand() * 7,
        rot: rand() * 6,
        vr: (rand() - 0.5) * 18,
        life: 1.2 + rand() * 0.9,
        drag: 2.2,
        g: 260,
        color: CONFETTI[Math.floor(rand() * CONFETTI.length)]!,
      });
    }
  }

  stars(x: number, y: number, n: number, speed: number, rand: () => number, color = COLORS.knob): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.4;
      const s = speed * (0.6 + rand() * 0.6);
      this.spawn({
        kind: 'star',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 9 + rand() * 7,
        rot: rand() * 6,
        vr: (rand() - 0.5) * 10,
        life: 0.6 + rand() * 0.4,
        drag: 3.5,
        color,
      });
    }
  }

  ring(x: number, y: number, size: number, color: string, life = 0.45): void {
    this.spawn({ kind: 'ring', x, y, size, life, color, drag: 0 });
  }

  sweat(x: number, y: number, rand: () => number): void {
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    const s = 120 + rand() * 120;
    this.spawn({
      kind: 'sweat',
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      size: 5 + rand() * 3,
      life: 0.6,
      drag: 1,
      g: 700,
      color: '#8fd3ff',
    });
  }

  drool(x: number, y: number, rand: () => number): void {
    this.spawn({
      kind: 'drool',
      x: x + (rand() - 0.5) * 16,
      y,
      vy: 20,
      size: 5,
      life: 1.1,
      drag: 0.5,
      g: 120,
      color: '#bfe9ff',
    });
  }

  /** A firework shell bursting at (x, y). */
  burst(x: number, y: number, rand: () => number): void {
    const color = CONFETTI[Math.floor(rand() * (CONFETTI.length - 1))]!;
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 260 + rand() * 120;
      this.spawn({
        kind: 'ember',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 4 + rand() * 3,
        life: 0.9 + rand() * 0.5,
        drag: 2.4,
        g: 120,
        color,
      });
    }
    this.ring(x, y, 140, color, 0.5);
  }
}
