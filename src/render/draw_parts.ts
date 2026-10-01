import { COLORS } from '../config';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import type { Game } from '../game/game';
import { arcPoints, THICK, type Part } from '../geom/parts';
import type { Camera } from './camera';

/**
 * Raised table toys (stubs, curved rails, glass, gates, bumpers): they cast shadows and sit just
 * under the balls. Flat toys on the felt are in draw_floor.ts.
 */

function glassHp(game: Game, p: Part & { kind: 'glass' }): number {
  return game.phase === 'sim' ? (game.world.solid.glassHp.get(p.id) ?? p.hp) : p.hp;
}

/** The toy's outline as a path (exported for selection glows). */
export function traceOutline(ctx: CanvasRenderingContext2D, p: Part): boolean {
  return tracePart(ctx, p);
}

function unit(d: { x: number; y: number }) {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

function ends(p: { x: number; y: number; dir: { x: number; y: number }; len: number }) {
  const u = unit(p.dir);
  const h = p.len / 2;
  return { ax: p.x - u.x * h, ay: p.y - u.y * h, bx: p.x + u.x * h, by: p.y + u.y * h, u };
}

/** The toy's outline as a path, for shadows and the wood look. */
function tracePart(ctx: CanvasRenderingContext2D, p: Part): boolean {
  switch (p.kind) {
    case 'stub':
    case 'glass': {
      const e = ends(p);
      ctx.moveTo(e.ax, e.ay);
      ctx.lineTo(e.bx, e.by);
      return true;
    }
    case 'gate': {
      const u = unit(p.dir);
      const h = p.len / 2;
      ctx.moveTo(p.x + u.y * h, p.y - u.x * h);
      ctx.lineTo(p.x - u.y * h, p.y + u.x * h);
      return true;
    }
    case 'arc': {
      const pts = arcPoints(p.x, p.y, p.r, p.from, p.to);
      pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      return true;
    }
    default:
      return false;
  }
}

export function drawPartShadows(ctx: CanvasRenderingContext2D, game: Game, cam: Camera): void {
  const o = cam.screenToWorldDir(5, 8);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.strokeStyle = 'rgba(10,4,26,0.3)';
  ctx.fillStyle = 'rgba(10,4,26,0.3)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = THICK * 2 + 4;
  for (const p of game.table.parts) {
    if (p.kind === 'glass' && glassHp(game, p) <= 0) continue;
    if (p.kind === 'bumper') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 2, 0, TAU);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    if (tracePart(ctx, p)) ctx.stroke();
  }
  ctx.restore();
}

export function drawRaisedParts(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
  for (const p of game.table.parts) drawRaisedPart(ctx, p, game, fx, cam);
}

/** One raised toy (also used for the ghost of a toy being dragged out of the tray). */
export function drawRaisedPart(ctx: CanvasRenderingContext2D, p: Part, game: Game, fx: Fx, cam: Camera): void {
  const t = fx.time;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (p.kind) {
    case 'stub':
    case 'arc': {
      ctx.beginPath();
      tracePart(ctx, p);
      ctx.lineWidth = THICK * 2 + 5;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      ctx.lineWidth = THICK * 2 - 1;
      ctx.strokeStyle = COLORS.wood;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.woodLight;
      ctx.stroke();
      break;
    }
    case 'glass': {
      const hp = glassHp(game, p);
      if (hp <= 0) break;
      const e = ends(p);
      ctx.beginPath();
      tracePart(ctx, p);
      ctx.lineWidth = THICK * 2 + 4;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      ctx.lineWidth = THICK * 2 - 1;
      ctx.strokeStyle = 'rgba(160,236,255,0.85)';
      ctx.stroke();
      // Glints sliding along the pane.
      const g = (t * 0.4) % 1;
      ctx.beginPath();
      ctx.moveTo(e.ax + (e.bx - e.ax) * g, e.ay + (e.by - e.ay) * g);
      ctx.lineTo(e.ax + (e.bx - e.ax) * Math.min(1, g + 0.12), e.ay + (e.by - e.ay) * Math.min(1, g + 0.12));
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      if (hp < p.hp || hp === 1) {
        // Cracked: a zigzag across the middle.
        const nx = -e.u.y;
        const ny = e.u.x;
        ctx.beginPath();
        for (let k = -3; k <= 3; k++) {
          const s = k * 9;
          const z = (k % 2 === 0 ? 1 : -1) * 5;
          const x = p.x + e.u.x * s + nx * z;
          const y = p.y + e.u.y * s + ny * z;
          if (k === -3) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
      }
      break;
    }
    case 'gate': {
      const u = unit(p.dir);
      const h = p.len / 2;
      const ax = p.x + u.y * h;
      const ay = p.y - u.x * h;
      const bx = p.x - u.y * h;
      const by = p.y + u.x * h;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineWidth = THICK * 2 + 4;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      ctx.lineWidth = THICK * 2 - 1;
      ctx.strokeStyle = '#b388ff';
      ctx.stroke();
      // Chevrons marching the way balls may pass.
      const n = Math.max(2, Math.floor(p.len / 34));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const cx = ax + (bx - ax) * k + u.x * Math.sin(t * 6 + i) * 2;
        const cy = ay + (by - ay) * k + u.y * Math.sin(t * 6 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(cx - u.x * 4 + u.y * 5, cy - u.y * 4 - u.x * 5);
        ctx.lineTo(cx + u.x * 5, cy + u.y * 5);
        ctx.lineTo(cx - u.x * 4 - u.y * 5, cy - u.y * 4 + u.x * 5);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#fff8e7';
        ctx.stroke();
      }
      for (const [ex, ey] of [
        [ax, ay],
        [bx, by],
      ] as const) {
        ctx.beginPath();
        ctx.arc(ex, ey, THICK + 3, 0, TAU);
        ctx.fillStyle = '#6b4bb8';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
      }
      break;
    }
    case 'bumper':
      drawBumper(ctx, game, fx, cam, p);
      break;
    default:
      break;
  }
}

function drawBumper(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera, p: Part & { kind: 'bumper' }) {
  const hit = fx.bumps.get(p.id) ?? 0;
  const pop = 1 + 0.22 * Math.sin(Math.min(1, hit / 0.25) * Math.PI) * (hit > 0 ? 1 : 0);
  const r = p.r * pop;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.beginPath();
  ctx.arc(0, 0, r + 4, 0, TAU);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = hit > 0 ? '#ffe45c' : '#ff5d8f';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, TAU);
  ctx.fillStyle = hit > 0 ? '#fff6c2' : '#ff8fb3';
  ctx.fill();
  // A face that watches the nearest ball.
  let lx = 0;
  let ly = 0;
  let best = Infinity;
  for (const b of game.balls) {
    if (!b.active) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < best) {
      best = d;
      lx = (b.x - p.x) / (d || 1);
      ly = (b.y - p.y) / (d || 1);
    }
  }
  ctx.rotate(cam.upright);
  const c = Math.cos(-cam.upright);
  const s = Math.sin(-cam.upright);
  const ux = lx * c - ly * s;
  const uy = lx * s + ly * c;
  for (const side of [-1, 1]) {
    const ex = side * r * 0.3;
    const ey = -r * 0.12;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.2, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex + ux * r * 0.08, ey + uy * r * 0.08, r * 0.09, 0, TAU);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
  }
  ctx.beginPath();
  if (hit > 0) ctx.arc(0, r * 0.3, r * 0.16, 0, TAU);
  else ctx.arc(0, r * 0.18, r * 0.22, 0.2, Math.PI - 0.2);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.restore();
}
