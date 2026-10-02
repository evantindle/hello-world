import { COLORS, RAIL_W } from '../config';
import { cubicIn } from '../core/easing';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import type { Game } from '../game/game';
import type { Camera } from './camera';
import { drawBall } from './draw_balls';
import { tracePath, type VisualTable } from './draw_table';

/**
 * The table flip for a lost level, in 2D: the table swings over its bottom edge on screen (a
 * vertical squash through zero into its underside), tilts, and drops off the bottom of the screen
 * while the balls fly up and tumble down past it.
 */
export const FLIP_T = 1.6;

export interface FlipPose {
  /** Vertical scale about the pivot: 1 face up, 0 edge on, -1 upside down. */
  sy: number;
  rot: number;
  /** Screen px the table has fallen. */
  drop: number;
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

export function flipPose(t: number): FlipPose {
  // A little heave first, then over it goes.
  const heave = t < 0.15 ? 1 - 0.07 * Math.sin((Math.PI * t) / 0.15) : 1;
  const k = smooth(clamp01((t - 0.15) / 0.55));
  const sy = heave * Math.cos(Math.PI * k);
  const rot = 0.22 * cubicIn(clamp01((t - 0.15) / 0.9));
  const fall = Math.max(0, t - 0.45);
  return { sy, rot, drop: 0.5 * 4200 * fall * fall };
}

/** The camera transform with the flip applied on top, pivoting on the table's bottom edge on screen. */
export function applyFlip(ctx: CanvasRenderingContext2D, cam: Camera, game: Game, pose: FlipPose): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of game.table.verts) {
    const p = cam.worldToScreen(v.x, v.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const px = (minX + maxX) / 2;
  const py = maxY + RAIL_W * cam.scale;
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
  ctx.translate(px, py + pose.drop);
  ctx.rotate(pose.rot);
  ctx.scale(1, pose.sy);
  ctx.translate(-px, -py);
  cam.applyOn(ctx);
}

/** The bottom of the table: planks, braces and four legs sticking up at you. */
export function drawUnderside(ctx: CanvasRenderingContext2D, vt: VisualTable): void {
  tracePath(ctx, vt);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * RAIL_W + 9;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W;
  ctx.strokeStyle = COLORS.woodDark;
  ctx.stroke();
  ctx.fillStyle = COLORS.woodDark;
  ctx.fill();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of vt.pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  ctx.save();
  tracePath(ctx, vt);
  ctx.clip();
  // Planks.
  ctx.strokeStyle = 'rgba(20,8,0,0.35)';
  ctx.lineWidth = 4;
  for (let x = minX + 70; x < maxX; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, minY - 40);
    ctx.lineTo(x, maxY + 40);
    ctx.stroke();
  }
  // Cross braces.
  ctx.lineWidth = 26;
  ctx.strokeStyle = COLORS.wood;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(minX + 90, minY + 90);
  ctx.lineTo(maxX - 90, maxY - 90);
  ctx.moveTo(maxX - 90, minY + 90);
  ctx.lineTo(minX + 90, maxY - 90);
  ctx.stroke();
  ctx.restore();
  // Legs, end on.
  for (const [x, y] of [
    [minX + 80, minY + 80],
    [maxX - 80, minY + 80],
    [maxX - 80, maxY - 80],
    [minX + 80, maxY - 80],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 38, 0, TAU);
    ctx.fillStyle = COLORS.wood;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, TAU);
    ctx.fillStyle = COLORS.woodLight;
    ctx.fill();
  }
}

/** The balls, thrown clear of the flipping table (in plain camera space). */
export function drawFlyingBalls(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
  const flip = fx.flip;
  if (!flip) return;
  for (const f of flip.balls) {
    const b = game.balls.find((q) => q.id === f.id);
    if (!b) continue;
    drawBall(ctx, b, fx.balls.get(b.id), fx, cam, game, f.x, f.y, f.s);
  }
}
