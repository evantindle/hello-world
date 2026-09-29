import { COLORS, PLAY, RAIL_W } from '../config';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import type { Jelly } from '../fx/jelly';
import type { Game } from '../game/game';
import { listHandles } from '../game/reshape';
import type { Pocket, Table } from '../geom/table';
import type { Camera } from './camera';

export interface P {
  x: number;
  y: number;
}

/** The table as drawn: jelly-offset vertices and one quadratic control point per edge. */
export interface VisualTable {
  pts: P[];
  ctrl: P[];
  n: number;
}

export function buildVisual(t: Table, jelly: Jelly): VisualTable {
  const n = t.verts.length;
  const pts = t.verts.map((v) => {
    const o = jelly.offset(v.id);
    return { x: v.x + o.x, y: v.y + o.y };
  });
  const ctrl: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const bulge = jelly.bulge(t.verts[i]!.id);
    // Outward normal of a positive-area polygon edge is (dy, -dx).
    ctrl.push({ x: (a.x + b.x) / 2 + (dy / l) * 2 * bulge, y: (a.y + b.y) / 2 - (dx / l) * 2 * bulge });
  }
  return { pts, ctrl, n };
}

export function edgePoint(vt: VisualTable, i: number, t: number): P {
  const a = vt.pts[i]!;
  const b = vt.pts[(i + 1) % vt.n]!;
  const c = vt.ctrl[i]!;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** Outward unit normal of the drawn edge curve at parameter t. */
export function edgeNormal(vt: VisualTable, i: number, t: number): P {
  const a = vt.pts[i]!;
  const b = vt.pts[(i + 1) % vt.n]!;
  const c = vt.ctrl[i]!;
  const tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  const ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  const l = Math.hypot(tx, ty) || 1;
  return { x: ty / l, y: -tx / l };
}

export function tracePath(ctx: CanvasRenderingContext2D, vt: VisualTable): void {
  ctx.beginPath();
  const p0 = vt.pts[0]!;
  ctx.moveTo(p0.x, p0.y);
  for (let i = 0; i < vt.n; i++) {
    const c = vt.ctrl[i]!;
    const b = vt.pts[(i + 1) % vt.n]!;
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- table body

let dots: P[] | null = null;
function feltDots(): P[] {
  if (dots) return dots;
  const out: P[] = [];
  const sp = 38;
  let row = 0;
  for (let y = PLAY.minY; y <= PLAY.maxY; y += sp * 0.866, row++) {
    for (let x = PLAY.minX + (row % 2 ? sp / 2 : 0); x <= PLAY.maxX; x += sp) out.push({ x, y });
  }
  dots = out;
  return out;
}

export function drawTableBody(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, vt: VisualTable): void {
  // Drop shadow.
  ctx.save();
  ctx.translate(16, 26);
  tracePath(ctx, vt);
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(8,2,22,0.38)';
  ctx.fill();
  ctx.lineWidth = 2 * RAIL_W + 14;
  ctx.strokeStyle = 'rgba(8,2,22,0.38)';
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W + 34;
  ctx.strokeStyle = 'rgba(8,2,22,0.14)';
  ctx.stroke();
  ctx.restore();

  // Wooden rail: layered strokes centred on the outline; the felt later covers the inner half.
  tracePath(ctx, vt);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * RAIL_W + 9;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W + 1;
  ctx.strokeStyle = COLORS.woodDark;
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W - 8;
  ctx.strokeStyle = COLORS.wood;
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W - 22;
  ctx.strokeStyle = COLORS.woodLight;
  ctx.stroke();
  ctx.lineWidth = 2 * RAIL_W - 28;
  ctx.strokeStyle = COLORS.wood;
  ctx.stroke();

  // Felt.
  let cx = 0;
  let cy = 0;
  for (const p of vt.pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= vt.n;
  cy /= vt.n;
  const g = ctx.createRadialGradient(cx - 60, cy - 70, 40, cx, cy, 720);
  g.addColorStop(0, COLORS.feltLight);
  g.addColorStop(0.5, COLORS.felt);
  g.addColorStop(1, COLORS.feltDark);
  tracePath(ctx, vt);
  ctx.fillStyle = g;
  ctx.fill();

  // Felt dots, warped by the jelly so the cloth visibly stretches.
  ctx.save();
  tracePath(ctx, vt);
  ctx.clip();
  const verts = game.table.verts;
  const ctlX: number[] = [];
  const ctlY: number[] = [];
  const offX: number[] = [];
  const offY: number[] = [];
  const warp = fx.jelly.active;
  if (warp) {
    verts.forEach((v, i) => {
      const o = fx.jelly.offset(v.id);
      ctlX.push(v.x);
      ctlY.push(v.y);
      offX.push(o.x);
      offY.push(o.y);
      const b = verts[(i + 1) % verts.length]!;
      const m = edgePoint(vt, i, 0.5);
      ctlX.push((v.x + b.x) / 2);
      ctlY.push((v.y + b.y) / 2);
      offX.push(m.x - (v.x + b.x) / 2);
      offY.push(m.y - (v.y + b.y) / 2);
    });
  }
  ctx.beginPath();
  const rr = 2.8;
  for (const d of feltDots()) {
    let x = d.x;
    let y = d.y;
    if (warp) {
      let sw = 1 / (170 * 170);
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < ctlX.length; k++) {
        const dx = x - ctlX[k]!;
        const dy = y - ctlY[k]!;
        const w = 1 / (dx * dx + dy * dy + 600);
        sw += w;
        sx += w * offX[k]!;
        sy += w * offY[k]!;
      }
      x += sx / sw;
      y += sy / sw;
    }
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, rr, 0, TAU);
  }
  ctx.fillStyle = COLORS.feltDot;
  ctx.fill();

  // Poke ripples.
  for (const r of fx.ripples) {
    const k = r.t / 0.7;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 10 + k * 90, 0, TAU);
    ctx.lineWidth = 6 * (1 - k);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
    ctx.stroke();
  }
  ctx.restore();

  // Cushions: a darker rubber strip along each rail, stopping at the pocket jaws.
  ctx.lineCap = 'round';
  for (const r of game.geom.rails) {
    if (r.t1 - r.t0 < 1e-3) continue;
    ctx.beginPath();
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = r.t0 + ((r.t1 - r.t0) * s) / steps;
      const p = edgePoint(vt, r.edge, t);
      const nrm = edgeNormal(vt, r.edge, t);
      const x = p.x - nrm.x * 6;
      const y = p.y - nrm.y * 6;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 12;
    ctx.strokeStyle = COLORS.cushion;
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // Crisp ink line where felt meets wood.
  tracePath(ctx, vt);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  // Pearl sights on the rails.
  ctx.fillStyle = '#fff3d1';
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1.6;
  for (const r of game.geom.rails) {
    for (const t of [0.25, 0.5, 0.75]) {
      if (t < r.t0 + 0.06 || t > r.t1 - 0.06) continue;
      const p = edgePoint(vt, r.edge, t);
      const nrm = edgeNormal(vt, r.edge, t);
      const x = p.x + nrm.x * RAIL_W * 0.55;
      const y = p.y + nrm.y * RAIL_W * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 4.5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 4.5, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- pockets

export function drawPockets(ctx: CanvasRenderingContext2D, game: Game, fx: Fx): void {
  for (const p of game.geom.pockets) {
    const o = fx.jelly.offset(p.vid);
    const x = p.x + o.x;
    const y = p.y + o.y;
    const r = fx.holeR.get(p.vid) ?? p.r;
    if (p.open) drawHole(ctx, x, y, r, game.hunger, fx.chomp.get(p.vid) ?? 0, fx.hungerWobble + p.vid);
    else drawCork(ctx, x, y, r, p);
  }
}

function drawHole(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  hunger: number,
  chomp: number,
  phase: number,
) {
  const bite = chomp > 0 ? Math.sin((chomp / 0.35) * Math.PI) : 0;
  const rr = r * (1 - 0.12 * bite);
  ctx.beginPath();
  ctx.arc(x, y, rr + 8, 0, TAU);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, rr + 5, 0, TAU);
  ctx.fillStyle = COLORS.holeRim;
  ctx.fill();
  const g = ctx.createRadialGradient(x - rr * 0.25, y - rr * 0.3, rr * 0.05, x, y, rr);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.72, '#0c0619');
  g.addColorStop(1, '#2d1846');
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  if (hunger <= 0) return;
  // Hungry pockets grow teeth. The hungrier, the bigger and the chattier.
  const count = 6 + hunger * 2;
  const baseH = 4 + hunger * 3.2;
  ctx.fillStyle = '#fffdf2';
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + phase * 0.05;
    const chatter = 1 + 0.18 * Math.sin(phase * 3 + i * 1.7) + bite * 0.8;
    const hgt = baseH * chatter;
    const half = (TAU / count) * 0.34;
    const bx0 = x + Math.cos(a - half) * rr;
    const by0 = y + Math.sin(a - half) * rr;
    const bx1 = x + Math.cos(a + half) * rr;
    const by1 = y + Math.sin(a + half) * rr;
    const tx = x + Math.cos(a) * (rr - hgt);
    const ty = y + Math.sin(a) * (rr - hgt);
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx1, by1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawCork(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pocket) {
  const rr = r * 0.8;
  ctx.beginPath();
  ctx.arc(x, y, rr + 3, 0, TAU);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = '#c9975a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - rr * 0.15, y - rr * 0.18, rr * 0.7, 0, TAU);
  ctx.fillStyle = '#ddb57a';
  ctx.fill();
  // A cartoon band-aid "X": this pocket is closed for business.
  ctx.save();
  ctx.translate(x, y);
  const a = Math.atan2(p.iny, p.inx);
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.rotate(a + (s * Math.PI) / 4);
    ctx.fillStyle = '#ffd6a5';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-rr * 1.15, -rr * 0.24, rr * 2.3, rr * 0.48, rr * 0.2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8b27a';
    ctx.fillRect(-rr * 0.25, -rr * 0.18, rr * 0.5, rr * 0.36);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- reshape handles

export interface HandleView {
  hoverKind: 'vertex' | 'edge' | null;
  hoverIndex: number;
  dragVid: number | null;
  /** Show the first-turn "DRAG ME!" tutorial tag. */
  tutorial: boolean;
}

const KNOB_R = 18;
const EDGE_R = 11.5;

export function drawHandles(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  vt: VisualTable,
  view: HandleView,
  cam: Camera,
): void {
  if (game.phase !== 'plan' || game.charging) return;
  const t = fx.time;
  const px = 1 / cam.scale; // one CSS pixel in world units
  const intro = Math.min(1, game.phaseT * 3);
  const handles = listHandles(game.table);
  // Midpoint "+" handles first (under the knobs).
  for (const h of handles) {
    if (h.kind !== 'edge') continue;
    const p = edgePoint(vt, h.index, 0.5);
    const hot = view.hoverKind === 'edge' && view.hoverIndex === h.index;
    // Never smaller than ~11 CSS px radius on tiny screens.
    const s = (hot ? 1.4 : 1) * Math.max(1, (11 * px) / EDGE_R) * intro;
    if (s <= 0.01) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    ctx.globalAlpha = hot ? 1 : 0.85;
    ctx.beginPath();
    ctx.arc(1.5, 2.5, EDGE_R, 0, TAU);
    ctx.fillStyle = 'rgba(10,4,24,0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, EDGE_R, 0, TAU);
    ctx.fillStyle = hot ? '#ffffff' : '#fff6e0';
    ctx.fill();
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5.5, 0);
    ctx.lineTo(5.5, 0);
    ctx.moveTo(0, -5.5);
    ctx.lineTo(0, 5.5);
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
  // Vertex knobs.
  let tutorialAt: P | null = null;
  let tutorialD = Infinity;
  game.table.verts.forEach((v, i) => {
    const p = vt.pts[i]!;
    const hot = view.hoverKind === 'vertex' && view.hoverIndex === i;
    const dragging = view.dragVid === v.id;
    const nope = fx.nope.get(v.id) ?? 0;
    const pulse = 1 + 0.08 * Math.sin(t * 4 + i * 1.3);
    let s = (dragging ? 1.3 : hot ? 1.25 : pulse) * Math.max(1, (15 * px) / KNOB_R) * intro;
    if (s <= 0.01) return;
    let jx = 0;
    if (nope > 0) {
      jx = Math.sin(nope * 60) * 5 * (nope / 0.35);
      s *= 1.1;
    }
    // The tutorial tag goes on the knob closest to the top-middle of the screen (always visible).
    const d = Math.hypot(p.x - 500, p.y + 200);
    if (v.pocket && d < tutorialD) {
      tutorialD = d;
      tutorialAt = p;
    }
    ctx.save();
    ctx.translate(p.x + jx, p.y);
    ctx.scale(s, s);
    if (hot || dragging) {
      ctx.beginPath();
      ctx.arc(0, 0, KNOB_R + 11, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
    }
    const fill = nope > 0 ? COLORS.nope : dragging ? COLORS.knobHot : v.pocket ? COLORS.knob : '#ff9f6b';
    ctx.beginPath();
    ctx.arc(2, 3.5, KNOB_R, 0, TAU);
    ctx.fillStyle = 'rgba(10,4,24,0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, KNOB_R, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    // Grip dots: reads as "grab me".
    ctx.fillStyle = 'rgba(28,18,51,0.75)';
    for (const [gx, gy] of [
      [-5, -5],
      [5, -5],
      [-5, 5],
      [5, 5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(gx, gy, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(-7, -9, 4, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.restore();
  });
  const tag = tutorialAt as P | null;
  if (view.tutorial && tag && !game.drag) {
    const bob = Math.sin(t * 5) * 6;
    ctx.save();
    ctx.translate(tag.x, tag.y + 58 + bob);
    ctx.rotate(cam.upright);
    ctx.scale(Math.max(1, (15 * px) / KNOB_R) * intro, Math.max(1, (15 * px) / KNOB_R) * intro);
    ctx.font = `26px "Bangers", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText('DRAG ME!').width + 22;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -17, w, 34, 10);
    ctx.fillStyle = COLORS.knob;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -17);
    ctx.lineTo(0, -29);
    ctx.lineTo(9, -17);
    ctx.fillStyle = COLORS.knob;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.fillText('DRAG ME!', 0, 2);
    ctx.restore();
  }
}
