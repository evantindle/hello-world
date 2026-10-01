import { COLORS, R } from '../config';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import { POP_FONT } from '../fx/wordpops';
import type { Game } from '../game/game';
import { turnKnob } from '../game/placement';
import { THICK, type Part } from '../geom/parts';
import type { Camera } from './camera';
import { drawFloorPart } from './draw_floor';
import { drawRaisedPart, traceOutline } from './draw_parts';
import type { HandleView } from './draw_table';

/**
 * Editing overlays in the plan phase: the outline the table started the turn with, catch rings
 * on the pockets while something is being dragged, the reach of a grab, toy highlights and
 * turning knobs, and the ghost of a toy coming out of the tray.
 */

/** Under the balls: the starting outline, catch rings, the reach disc. */
export function drawEditUnder(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, view: HandleView): void {
  if (game.phase !== 'plan') return;
  const t = fx.time;
  const start = game.editHistory.start;
  const reshaped =
    start !== null &&
    (start.table.verts.length !== game.table.verts.length ||
      start.table.verts.some((v, i) => v.x !== game.table.verts[i]!.x || v.y !== game.table.verts[i]!.y));
  if (start && reshaped) {
    // Where the rails were when the turn began: a soft lilac band of dots, nothing like the white
    // dashes of a ball's path.
    ctx.save();
    ctx.beginPath();
    start.table.verts.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(199,160,255,0.16)';
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 11]);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = 'rgba(214,186,255,0.7)';
    ctx.stroke();
    ctx.restore();
  }
  const dragging = game.drag !== null || game.partDrag !== null || view.ghost !== null;
  if (dragging) {
    // Catch rings: where a ball would drop, so shots can be lined up while bending.
    for (const p of game.geom.pockets) {
      if (!p.open) continue;
      const pulse = 1 + 0.04 * Math.sin(t * 5 + p.vid);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, TAU);
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = t * 24;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(184,255,138,0.85)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sr, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(184,255,138,0.3)';
      ctx.stroke();
    }
  }
  // How far this grab may go.
  const reach = game.reach;
  if (reach < Infinity) {
    let ax: number | null = null;
    let ay = 0;
    if (game.drag) {
      ax = game.drag.ax;
      ay = game.drag.ay;
    } else if (game.partDrag && !game.partDrag.free && !game.partDrag.turn) {
      ax = game.partDrag.ax;
      ay = game.partDrag.ay;
    }
    if (ax !== null) {
      ctx.beginPath();
      ctx.arc(ax, ay, reach, 0, TAU);
      ctx.fillStyle = 'rgba(255,210,63,0.08)';
      ctx.fill();
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = t * 30;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,210,63,0.7)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Over the toys: highlights, turning knobs, the tray ghost. */
export function drawEditOver(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  cam: Camera,
  view: HandleView,
): void {
  if (game.phase !== 'plan' || game.charging) return;
  const t = fx.time;
  const px = 1 / cam.scale;
  const turnable = game.turnable();
  const dragId = game.partDrag?.id ?? null;
  for (const p of game.table.parts) {
    const hot = p.id === view.partHover || p.id === view.partSelected || p.id === dragId;
    if (!hot) continue;
    highlight(ctx, p, t, view.stowing && p.id === dragId);
    if (
      turnable.includes(p.id) &&
      (p.id === view.partSelected || p.id === view.partHover || game.partDrag?.turn)
    ) {
      knob(ctx, p, t, px, view.knobHover === p.id || (dragId === p.id && game.partDrag!.turn));
    }
  }
  if (view.ghost) ghost(ctx, game, fx, cam, view.ghost);
  if (view.stowing && game.partDrag) {
    const p = game.table.parts.find((q) => q.id === game.partDrag!.id);
    if (p) label(ctx, cam, 'BACK IN THE BOX', p.x, p.y - 60, '#ffe45c', 22);
  }
}

function highlight(ctx: CanvasRenderingContext2D, p: Part, t: number, stowing: boolean): void {
  const color = stowing ? 'rgba(255,93,143,0.9)' : `rgba(255,255,255,${0.55 + 0.25 * Math.sin(t * 6)})`;
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -t * 30;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (traceOutline(ctx, p)) {
    ctx.lineWidth = THICK * 2 + 12;
    ctx.strokeStyle = stowing ? 'rgba(255,93,143,0.3)' : 'rgba(255,255,255,0.18)';
    ctx.setLineDash([]);
    ctx.stroke();
  } else {
    const r = ringRadius(p);
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function ringRadius(p: Part): number {
  switch (p.kind) {
    case 'bumper':
    case 'portal':
    case 'bullseye':
      return p.r + 8;
    case 'booster':
      return Math.max(p.len, p.wid) / 2 + 10;
    case 'felt':
      return Math.max(p.w, p.h) / 2 + 10;
    case 'magnet':
      return 34;
    case 'blackhole':
      return 44;
    default:
      return R;
  }
}

function knob(ctx: CanvasRenderingContext2D, p: Part, t: number, px: number, hot: boolean): void {
  const k = turnKnob(p);
  if (!k) return;
  const s = Math.max(1, (13 * px) / 12) * (hot ? 1.25 : 1);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(k.x, k.y);
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(k.x, k.y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.fillStyle = hot ? '#ffffff' : '#c8f7ff';
  ctx.fill();
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  // A curly "turn me" arrow.
  ctx.rotate(t * 1.5);
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0.3, Math.PI * 1.6);
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.beginPath();
  const ex = Math.cos(Math.PI * 1.6) * 6;
  const ey = Math.sin(Math.PI * 1.6) * 6;
  ctx.moveTo(ex - 3, ey - 2);
  ctx.lineTo(ex + 1.5, ey + 0.5);
  ctx.lineTo(ex - 1, ey + 4);
  ctx.stroke();
  ctx.restore();
}

function ghost(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  cam: Camera,
  g: { item: number; x: number; y: number; ok: boolean },
): void {
  const it = game.tray[g.item];
  if (!it) return;
  const dir = game.placementDir(g.item);
  const part = { ...structuredClone(it.preset), id: -1, x: g.x, y: g.y, ...(dir ? { dir } : {}) } as Part;
  ctx.save();
  ctx.globalAlpha = g.ok ? 0.75 : 0.45;
  drawFloorPart(ctx, part, fx.time, cam);
  drawRaisedPart(ctx, part, game, fx, cam);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  if (!traceOutline(ctx, part)) ctx.arc(g.x, g.y, ringRadius(part), 0, TAU);
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -fx.time * 30;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = g.ok ? 'rgba(184,255,138,0.95)' : 'rgba(255,59,59,0.95)';
  ctx.stroke();
  ctx.restore();
  if (!g.ok) label(ctx, cam, 'NOPE', g.x, g.y - ringRadius(part) - 18, '#ff8fa3', 22);
}

function label(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(cam.upright);
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
