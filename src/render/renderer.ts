import { COLORS } from '../config';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import type { Game } from '../game/game';
import type { Camera } from './camera';
import { drawBalls, drawBallShadows, star } from './draw_balls';
import { drawCue, drawGuide, drawSpeedLines } from './draw_cue';
import { drawEditOver, drawEditUnder } from './draw_edit';
import { drawFloorParts } from './draw_floor';
import { drawPreviewOver, drawPreviewUnder } from './draw_preview';
import { drawPartShadows, drawRaisedParts } from './draw_parts';
import { buildVisual, drawHandles, drawPockets, drawTableBody, type HandleView } from './draw_table';

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
    private readonly fx: Fx,
    private readonly cam: Camera,
    private readonly view: () => HandleView,
  ) {
    // Transparent canvas: the backdrop (sunburst, glow, vignette) is plain CSS behind it.
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cam.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * this.cam.dpr));
    const h = Math.max(1, Math.round(rect.height * this.cam.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(): void {
    const { ctx, game, fx, cam } = this;
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.clearRect(0, 0, cam.cssW, cam.cssH);
    cam.apply(ctx);
    const vt = buildVisual(game.table, fx.jelly);
    drawTableBody(ctx, game, fx, vt, cam);
    drawPockets(ctx, game, fx);
    drawFloorParts(ctx, game, fx, cam, vt);
    const view = this.view();
    drawEditUnder(ctx, game, fx, view);
    // Free Play and the Toy Box show the whole chain; elsewhere, the one honest guide line.
    const chain = game.rules.preview === 'chain';
    const preview = game.preview;
    const guide = game.phase === 'plan' && !chain ? game.guide() : undefined;
    if (preview) drawPreviewUnder(ctx, game, fx, preview);
    else if (!chain) drawGuide(ctx, game, fx, cam, 'under', guide);
    drawPartShadows(ctx, game, cam);
    drawBallShadows(ctx, game, fx, cam);
    drawRaisedParts(ctx, game, fx, cam);
    drawBalls(ctx, game, fx, cam);
    if (preview) drawPreviewOver(ctx, game, fx, cam, preview);
    else if (!chain) drawGuide(ctx, game, fx, cam, 'over', guide);
    drawSpeedLines(ctx, fx);
    drawCue(ctx, game, fx, cam);
    drawHandles(ctx, game, fx, vt, view, cam);
    drawEditOver(ctx, game, fx, cam, view);
    drawParticles(ctx, fx, cam.upright);
    fx.pops.draw(ctx, cam.upright);

    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    if (fx.vignette > 0.01) {
      const w = cam.cssW;
      const h = cam.cssH;
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.25,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.7,
      );
      g.addColorStop(0, 'rgba(10,0,30,0)');
      g.addColorStop(1, `rgba(10,0,30,${0.75 * fx.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.flash > 0.01) {
      ctx.fillStyle = `rgba(255,250,235,${fx.flash * 0.35})`;
      ctx.fillRect(0, 0, cam.cssW, cam.cssH);
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, fx: Fx, upright: number): void {
  for (const p of fx.particles.list) {
    const k = p.life / p.max; // 1 -> 0
    switch (p.kind) {
      case 'dust': {
        ctx.globalAlpha = 0.7 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        break;
      }
      case 'spark': {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = p.color;
        ctx.stroke();
        break;
      }
      case 'confetti': {
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(p.rot * 1.7), 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
        break;
      }
      case 'star': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + upright);
        star(ctx, 0, 0, p.size * (0.6 + 0.4 * k), p.color);
        ctx.restore();
        break;
      }
      case 'sweat':
      case 'drool': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, p.size * 1.8);
        ctx.quadraticCurveTo(p.size, 0, 0, -p.size * 0.2);
        ctx.quadraticCurveTo(-p.size, 0, 0, p.size * 1.8);
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'ring': {
        const e = 1 - k;
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.25 + 0.75 * (1 - (1 - e) * (1 - e))), 0, TAU);
        ctx.lineWidth = 7 * k + 1;
        ctx.strokeStyle = p.color;
        ctx.stroke();
        break;
      }
      case 'shard': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.6, p.size * 0.5);
        ctx.lineTo(-p.size * 0.5, p.size * 0.3);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'yolk': {
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.2 - 0.2 * k), 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        break;
      }
      case 'feather': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + Math.sin(p.life * 6) * 0.6);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.35, 0, 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'blip': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * k), 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        break;
      }
      case 'ember': {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}
