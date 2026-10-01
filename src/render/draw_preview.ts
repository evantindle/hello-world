import { COLORS, R } from '../config';
import { backOut } from '../core/easing';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import { POP_FONT } from '../fx/wordpops';
import type { Game } from '../game/game';
import type { Preview, PreviewTrack } from '../game/preview';
import type { Camera } from './camera';

/**
 * The shot preview, drawn quietly: the cue ball's path to a ghost ball where it first makes contact
 * (then a short, fainter tail), a path for each ball it hits, ending in a little arrow if the ball
 * is still rolling, and a soft ring on any pocket a ball would drop into.
 *
 * When the shot changes, the old paths fade out under the new ones for a moment, so dragging the
 * dial, the spin dot or the rails reads as motion rather than as jumps.
 */
export class PreviewView {
  private shown: Preview | null = null;
  private old: Preview | null = null;
  /** 0 -> 1 over the fade. */
  private k = 1;
  private last = 0;

  /** Keep up with the game's latest preview. */
  sync(p: Preview | null, time: number): void {
    const dt = Math.max(0, Math.min(0.1, time - this.last));
    this.last = time;
    if (p !== this.shown) {
      // The view being replaced fades out under the new one (while dragging, that is always the
      // previous frame's: a soft trail).
      if (this.shown) this.old = this.shown;
      this.shown = p;
      this.k = 0;
    }
    this.k = Math.min(1, this.k + dt / FADE);
    if (this.k >= 1) this.old = null;
  }

  drawUnder(ctx: CanvasRenderingContext2D, game: Game, fx: Fx): void {
    const intro = Math.min(1, game.phaseT * 3);
    if (this.old) drawPaths(ctx, fx, this.old, intro * (1 - this.k) * 0.35);
    if (this.shown) drawPaths(ctx, fx, this.shown, intro);
  }

  drawOver(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
    if (this.shown) drawMarks(ctx, game, fx, cam, this.shown);
  }
}

/** Seconds an old preview takes to fade away. */
const FADE = 0.15;

function colorOf(tr: PreviewTrack): string {
  return tr.num === 0 ? COLORS.guide : tr.color;
}

function strokeSeg(ctx: CanvasRenderingContext2D, seg: number[]): void {
  ctx.beginPath();
  ctx.moveTo(seg[0]!, seg[1]!);
  for (let i = 2; i + 1 < seg.length; i += 2) ctx.lineTo(seg[i]!, seg[i + 1]!);
}

function drawPaths(ctx: CanvasRenderingContext2D, fx: Fx, p: Preview, alpha: number): void {
  if (alpha <= 0.01) return;
  const t = fx.time;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The balls the cue ball hits first, then the cue ball's own path on top.
  const order = [...p.tracks].sort((a, b) => b.gen - a.gen);
  for (const tr of order) {
    const cue = tr.num === 0;
    const color = colorOf(tr);
    tr.segs.forEach((seg, k) => {
      const tail = cue && k >= tr.after;
      const width = cue ? (tail ? 3 : 4) : 3;
      const a = cue ? (tail ? 0.45 : 0.95) : 0.75;
      strokeSeg(ctx, seg);
      ctx.globalAlpha = alpha * a * 0.3;
      ctx.lineWidth = width + 3;
      ctx.strokeStyle = COLORS.ink;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = alpha * a;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.setLineDash([width * 3.2, width * 2.4]);
      ctx.lineDashOffset = -t * 60;
      ctx.stroke();
    });
    ctx.setLineDash([]);
    if (tr.drop !== null) continue;
    ctx.globalAlpha = alpha * (cue ? 0.6 : 0.7);
    if (tr.moving) arrowhead(ctx, tr, color);
    else {
      // Comes to rest here.
      ctx.beginPath();
      ctx.arc(tr.end.x, tr.end.y, R * 0.75, 0, TAU);
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // The ghost ball where the cue ball first makes contact.
  if (p.contact) {
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(p.contact.x, p.contact.y, R, 0, TAU);
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = t * 30;
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.guide;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** A small chevron at the end of a path that was cut short, pointing the way the ball rolls on. */
function arrowhead(ctx: CanvasRenderingContext2D, tr: PreviewTrack, color: string): void {
  const seg = tr.segs[tr.segs.length - 1];
  if (!seg || seg.length < 4) return;
  const n = seg.length;
  const x = seg[n - 2]!;
  const y = seg[n - 1]!;
  // Direction from a few points back, for a steady arrow.
  const j = Math.max(0, n - 8);
  let dx = x - seg[j]!;
  let dy = y - seg[j + 1]!;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const s = 9;
  ctx.beginPath();
  ctx.moveTo(x - dx * s - dy * s * 0.7, y - dy * s + dx * s * 0.7);
  ctx.lineTo(x, y);
  ctx.lineTo(x - dx * s + dy * s * 0.7, y - dy * s - dx * s * 0.7);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Over the balls: pockets that would get a ball, and a warning if the cue ball would drop. */
function drawMarks(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera, p: Preview): void {
  const t = fx.time;
  ctx.save();
  ctx.globalAlpha = Math.min(1, game.phaseT * 3);
  const byPocket = new Map<number, number>();
  for (const d of p.drops) byPocket.set(d.pocket, (byPocket.get(d.pocket) ?? 0) + 1);
  for (const [vid, n] of byPocket) {
    const pk = game.geom.pockets.find((q) => q.vid === vid);
    if (!pk) continue;
    const r = (fx.holeR.get(vid) ?? pk.r) + 8 + Math.sin(t * 6 + vid) * 2;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, r, 0, TAU);
    ctx.setLineDash([3, 8]);
    ctx.lineDashOffset = -t * 30;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(184,255,138,0.85)';
    ctx.stroke();
    ctx.setLineDash([]);
    const a = t * 2 + vid;
    sparkle(ctx, pk.x + Math.cos(a) * r, pk.y + Math.sin(a) * r, 5, '#fff6a8');
    if (n > 1)
      label(ctx, cam, game, t, `×${n}`, pk.x + pk.inx * (r + 22), pk.y + pk.iny * (r + 22), '#b8ff8a', 22);
  }
  if (p.drops.length >= 2) {
    const first = game.geom.pockets.find((q) => q.vid === p.drops[0]!.pocket);
    if (first) {
      label(
        ctx,
        cam,
        game,
        t,
        `${p.drops.length}-BALL COMBO?`,
        first.x + first.inx * 88,
        first.y + first.iny * 88,
        '#ffe45c',
        26,
      );
    }
  }
  if (p.scratch) {
    const cue = p.tracks.find((q) => q.num === 0);
    const pk = cue && cue.drop !== null ? game.geom.pockets.find((q) => q.vid === cue.drop) : undefined;
    if (pk) {
      const r = (fx.holeR.get(pk.vid) ?? pk.r) + 10 + Math.sin(t * 10) * 3;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, r, 0, TAU);
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = t * 40;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ff4d6d';
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, cam, game, t, 'SCRATCH?', pk.x + pk.inx * (r + 36), pk.y + pk.iny * (r + 36), '#ff4d6d', 26);
    }
  }
  ctx.restore();
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fillStyle = color;
  ctx.fill();
}

function label(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  game: Game,
  t: number,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 6) * 3);
  ctx.rotate(cam.upright + Math.sin(t * 4) * 0.05);
  const s = backOut(Math.min(1, game.phaseT * 2.5));
  ctx.scale(s, s);
  ctx.font = `${size}px ${POP_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
