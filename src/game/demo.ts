import { sineInOut } from '../core/easing';
import type { Rng } from '../core/rng';
import { castGuide } from '../geom/raycast';
import { cloneTable } from '../geom/table';
import type { Game } from './game';
import { listHandles, moveVertex, type Handle } from './reshape';

interface Plan {
  handle: Handle | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  dragDur: number;
  chargeDur: number;
  stage: 'think' | 'drag' | 'pause' | 'charge' | 'done';
  t: number;
}

/**
 * Attract mode / ?demo=1: plays the game the way a thoughtful human would, by trying a few bends
 * in its head, reading the guide line for each, and then acting out the best one on screen.
 */
export class Autopilot {
  private plan: Plan | null = null;

  constructor(
    private readonly game: Game,
    private readonly rng: Rng,
  ) {}

  update(dt: number): void {
    const g = this.game;
    switch (g.phase) {
      case 'title':
        if (g.phaseT > 1) g.start();
        break;
      case 'spin':
        if (g.phaseT > 1.4 && this.rng.chance(0.03)) g.skipSpin();
        break;
      case 'plan':
        this.plan ??= this.think();
        this.act(dt, this.plan);
        break;
      case 'over':
        if (g.phaseT > 7) g.restart();
        break;
      default:
        this.plan = null;
        break;
    }
  }

  private score(dx: number, dy: number, host: { geom: Game['geom']; balls: Game['balls'] }): number {
    const cue = host.balls[0]!;
    const gd = castGuide(host.geom, host.balls, cue, dx, dy);
    let v = this.rng.range(0, 0.2);
    if (gd.pocket) v -= 1;
    if (gd.target) {
      v += 0.5;
      const t = gd.target;
      const g2 = castGuide(host.geom, host.balls, t.ball, t.dx, t.dy);
      if (g2.kind === 'hole') v += 1.2;
      else if (g2.bounceKind === 'hole') v += 0.6;
    } else if (gd.bounceKind === 'ball') v += 0.25;
    return v;
  }

  private think(): Plan {
    const g = this.game;
    const dx = Math.cos(g.aim);
    const dy = Math.sin(g.aim);
    let best: Plan = this.blank();
    let bestV = this.score(dx, dy, g);
    const handles = listHandles(g.table);
    for (let i = 0; i < 14; i++) {
      const h = handles[this.rng.int(handles.length)]!;
      if (h.kind === 'edge') continue;
      const host = {
        table: cloneTable(g.table),
        geom: g.geom,
        balls: g.balls.map((b) => ({ ...b })),
        budget: g.budget,
        hunger: g.hunger,
      };
      const v = host.table.verts[h.index]!;
      const tx = v.x + this.rng.range(-220, 220);
      const ty = v.y + this.rng.range(-220, 220);
      moveVertex(host, v.id, tx, ty);
      const val = this.score(dx, dy, host);
      if (val > bestV) {
        bestV = val;
        best = { ...this.blank(), handle: h, fromX: h.x, fromY: h.y, toX: tx, toY: ty };
      }
    }
    // Sometimes just bend something for the fun of it.
    if (!best.handle && this.rng.chance(0.5)) {
      const h = handles[this.rng.int(handles.length)]!;
      best = {
        ...this.blank(),
        handle: h,
        fromX: h.x,
        fromY: h.y,
        toX: h.x + this.rng.range(-120, 120),
        toY: h.y + this.rng.range(-120, 120),
      };
    }
    return best;
  }

  private blank(): Plan {
    return {
      handle: null,
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      dragDur: this.rng.range(0.9, 1.5),
      chargeDur: this.rng.range(0.45, 1.3),
      stage: 'think',
      t: 0,
    };
  }

  private act(dt: number, p: Plan): void {
    const g = this.game;
    p.t += dt;
    switch (p.stage) {
      case 'think':
        if (p.t > 0.7) {
          p.t = 0;
          if (p.handle && g.beginDrag(p.handle, p.fromX, p.fromY)) p.stage = 'drag';
          else p.stage = 'pause';
        }
        break;
      case 'drag': {
        const k = Math.min(1, p.t / p.dragDur);
        const e = sineInOut(k);
        const wob = Math.sin(k * Math.PI * 3) * 18 * (1 - k);
        g.dragTo(p.fromX + (p.toX - p.fromX) * e + wob, p.fromY + (p.toY - p.fromY) * e - wob);
        if (k >= 1) {
          g.endDrag();
          p.stage = 'pause';
          p.t = 0;
        }
        break;
      }
      case 'pause':
        if (p.t > 0.45) {
          p.t = 0;
          p.stage = g.beginCharge() ? 'charge' : 'done';
        }
        break;
      case 'charge':
        if (p.t >= p.chargeDur) {
          g.releaseCharge();
          p.stage = 'done';
        }
        break;
      default:
        break;
    }
  }
}
