import { COLORS, R } from '../config';
import { backOut } from '../core/easing';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import { POP_FONT } from '../fx/wordpops';
import type { Game } from '../game/game';
import { PREVIEW_GEN, type Preview, type PreviewTrack } from '../game/preview';
import type { Camera } from './camera';

/**
 * The chain preview, drawn: every ball's path in its own colour (the cue ball's in white), fading
 * and thinning with each generation of the chain, a ghost where each ball ends up, a tick at each
 * contact, and sparkles on the pockets balls would drop into.
 */

/** Look of each generation: the cue ball, the balls it hits, the balls those hit... */
const GEN_STYLE: readonly { alpha: number; width: number }[] = [
  { alpha: 1, width: 5 },
  { alpha: 0.8, width: 4 },
  { alpha: 0.55, width: 3 },
  { alpha: 0.35, width: 2.5 },
];
/** Balls only a toy moved (never hit). */
const PUSHED_STYLE = { alpha: 0.4, width: 2.5 };

function styleOf(tr: PreviewTrack): { alpha: number; width: number } | null {
  if (tr.gen === 255) return PUSHED_STYLE;
  if (tr.gen > PREVIEW_GEN) return null;
  return GEN_STYLE[tr.gen]!;
}

function colorOf(tr: PreviewTrack): string {
  return tr.num === 0 ? COLORS.guide : tr.color;
}

/** Under the balls: paths, ghosts and contact ticks. */
export function drawPreviewUnder(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, p: Preview): void {
  const t = fx.time;
  // A preview of an older setup (a new one is being worked out) is drawn faded.
  const fresh = p.key === game.previewer.pendingKey || game.previewer.pendingKey === null;
  const intro = Math.min(1, game.phaseT * 3) * (fresh ? 1 : 0.45);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Deepest generations first, so the cue ball's path sits on top.
  const order = [...p.tracks].sort((a, b) => (b.gen === 255 ? 99 : b.gen) - (a.gen === 255 ? 99 : a.gen));
  for (const tr of order) {
    const st = styleOf(tr);
    if (!st) continue;
    const color = colorOf(tr);
    for (const seg of tr.segs) {
      ctx.beginPath();
      ctx.moveTo(seg[0]!, seg[1]!);
      for (let i = 2; i + 1 < seg.length; i += 2) ctx.lineTo(seg[i]!, seg[i + 1]!);
      ctx.globalAlpha = intro * st.alpha * 0.45;
      ctx.lineWidth = st.width + 4;
      ctx.strokeStyle = 'rgba(20,8,40,0.6)';
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = intro * st.alpha;
      ctx.lineWidth = st.width;
      ctx.strokeStyle = color;
      ctx.setLineDash([st.width * 3, st.width * 2.6]);
      ctx.lineDashOffset = -t * 70;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (tr.drop !== null || tr.segs.length === 0) continue;
    // A ghost where it ends up (still rolling: a smaller, open ring).
    ctx.globalAlpha = intro * Math.max(0.45, st.alpha);
    ctx.beginPath();
    ctx.arc(tr.end.x, tr.end.y, tr.moving ? R * 0.7 : R, 0, TAU);
    ctx.setLineDash(tr.moving ? [4, 6] : [7, 5]);
    ctx.lineDashOffset = t * 25;
    ctx.lineWidth = tr.num === 0 ? 3 : 2.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
    if (tr.num !== 0 && !tr.moving) {
      ctx.globalAlpha = intro * st.alpha * 0.25;
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  // Contact ticks.
  for (const c of p.contacts) {
    const st = GEN_STYLE[Math.min(c.gen, PREVIEW_GEN)]!;
    ctx.globalAlpha = intro * Math.max(0.5, st.alpha);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(t * 2 + c.x * 0.01);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COLORS.knob;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Over the balls: what would drop, and a warning if the cue ball would. */
export function drawPreviewOver(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  cam: Camera,
  p: Preview,
): void {
  const t = fx.time;
  const fresh = p.key === game.previewer.pendingKey || game.previewer.pendingKey === null;
  if (!p.done || !fresh) return;
  const intro = Math.min(1, game.phaseT * 3);
  ctx.save();
  ctx.globalAlpha = intro;
  const byPocket = new Map<number, number>();
  for (const d of p.drops) byPocket.set(d.pocket, (byPocket.get(d.pocket) ?? 0) + 1);
  for (const [vid, n] of byPocket) {
    const pk = game.geom.pockets.find((q) => q.vid === vid);
    if (!pk) continue;
    const r = (fx.holeR.get(vid) ?? pk.r) + 10 + Math.sin(t * 8 + vid) * 3;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, r, 0, TAU);
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -t * 40;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#b8ff8a';
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const a = t * 2.5 + (i * TAU) / 4 + vid;
      sparkle(ctx, pk.x + Math.cos(a) * r, pk.y + Math.sin(a) * r, 5 + 2 * Math.sin(t * 9 + i), '#fff6a8');
    }
    if (n > 1)
      label(ctx, cam, game, t, `×${n}`, pk.x + pk.inx * (r + 26), pk.y + pk.iny * (r + 26), '#b8ff8a', 24);
  }
  const total = p.drops.length;
  if (total >= 2) {
    const first = game.geom.pockets.find((q) => q.vid === p.drops[0]!.pocket);
    if (first) {
      const up = cam.screenToWorldDir(0, -1);
      label(
        ctx,
        cam,
        game,
        t,
        `${total}-BALL COMBO?`,
        first.x + first.inx * 90 + up.x * 30,
        first.y + first.iny * 90 + up.y * 30,
        '#ffe45c',
        30,
      );
    }
  }
  if (p.scratch) {
    const cue = p.tracks.find((q) => q.num === 0);
    const pk = cue && cue.drop !== null ? game.geom.pockets.find((q) => q.vid === cue.drop) : undefined;
    if (pk) {
      const r = (fx.holeR.get(pk.vid) ?? pk.r) + 12 + Math.sin(t * 10) * 3;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, r, 0, TAU);
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = t * 40;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ff4d6d';
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, cam, game, t, 'SCRATCH?', pk.x + pk.inx * (r + 40), pk.y + pk.iny * (r + 40), '#ff4d6d', 30);
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
  ctx.translate(x, y + Math.sin(t * 7) * 4);
  ctx.rotate(cam.upright + Math.sin(t * 5) * 0.06);
  const s = backOut(Math.min(1, game.phaseT * 2.5));
  ctx.scale(s, s);
  ctx.font = `${size}px ${POP_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
