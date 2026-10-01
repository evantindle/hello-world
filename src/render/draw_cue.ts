import { COLORS, R, STRIKE_HOLD, STRIKE_LUNGE } from '../config';
import { backOut, cubicOut, quadIn } from '../core/easing';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import { POP_FONT } from '../fx/wordpops';
import type { Game } from '../game/game';
import { PEGS } from '../game/spin';
import type { Guide } from '../geom/raycast';
import type { Camera } from './camera';

const STICK_LEN = 430;
const TIP_W = 3.4;
const BUTT_W = 8.8;

interface StickPose {
  pull: number;
  bend: number;
  alpha: number;
}

/** Stick pull-back distance while charging (shared with the strike lunge). */
export function chargePull(power: number): number {
  return 18 + 150 * quadIn(power);
}

function stickPose(game: Game, fx: Fx): StickPose | null {
  const t = fx.time;
  switch (game.phase) {
    case 'spin':
      return { pull: 14, bend: 0, alpha: 1 };
    case 'plan': {
      // Idle: the stick sits back a little further the higher the dial is set.
      if (!game.charging) return { pull: 14 + chargePull(game.dial) * 0.22 + 4 * Math.sin(t * 3), bend: 0, alpha: 1 };
      const p = game.power;
      const shake = p * p * 3.5 + (p >= 1 ? 2.5 : 0);
      return {
        pull: chargePull(p) + Math.sin(t * 57) * shake,
        bend: 26 * p * p + (p >= 1 ? Math.sin(t * 38) * 6 : 0),
        alpha: 1,
      };
    }
    case 'strike': {
      const k = game.phaseT;
      if (k < STRIKE_HOLD) return { pull: fx.releasePull + 6, bend: 0, alpha: 1 };
      const u = Math.min(1, (k - STRIKE_HOLD) / STRIKE_LUNGE);
      return { pull: fx.releasePull + 6 + (-8 - fx.releasePull - 6) * u, bend: 0, alpha: 1 };
    }
    case 'sim': {
      const k = game.phaseT / 0.55;
      if (k >= 1) return null;
      return { pull: -8 + 220 * cubicOut(k), bend: 0, alpha: 1 - k };
    }
    default:
      return null;
  }
}

export function drawCue(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
  const cue = game.cue;
  if (!cue.active) return;
  if (game.phase === 'spin') drawPegs(ctx, game, fx);
  const pose = stickPose(game, fx);
  if (!pose) return;
  if (game.phase === 'spin') {
    // Cartoon smear: evenly spaced ghosts trailing behind the stick, longer when it is fast.
    const trail = Math.min(1.0, game.spin.speed * 0.04);
    if (trail > 0.05) {
      const n = 6;
      for (let i = n; i >= 1; i--) {
        drawStick(
          ctx,
          cue.x,
          cue.y,
          game.aim - (trail * i) / n,
          pose.pull,
          0,
          0.28 * (1 - i / (n + 1)),
          true,
        );
      }
    }
  }
  // Side English: the stick lines up off-centre, where it will hit the ball.
  const side = game.phase === 'plan' || game.phase === 'strike' ? game.rules.english ? game.englishX : 0 : 0;
  const ox = -Math.sin(game.aim) * side * R * 0.55;
  const oy = Math.cos(game.aim) * side * R * 0.55;
  drawStick(ctx, cue.x + ox, cue.y + oy, game.aim, pose.pull, pose.bend, pose.alpha, false);
  if (game.phase === 'plan') {
    if (game.charging) drawPowerRing(ctx, cue.x, cue.y, game.power, fx.time);
    else if (fx.dialShow > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, fx.dialShow * 2) * 0.85;
      drawPowerRing(ctx, cue.x, cue.y, game.dial, fx.time);
      ctx.restore();
    }
  }
  void cam;
}

function drawStick(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  aim: number,
  pull: number,
  bend: number,
  alpha: number,
  ghost: boolean,
) {
  if (alpha <= 0.01) return;
  const sx = -Math.cos(aim);
  const sy = -Math.sin(aim);
  const px = -sy; // perpendicular
  const py = sx;
  const tx = bx + sx * (R + 4 + pull);
  const ty = by + sy * (R + 4 + pull);
  const ex = tx + sx * STICK_LEN;
  const ey = ty + sy * STICK_LEN;
  const cx = (tx + ex) / 2 + px * bend;
  const cy = (ty + ey) / 2 + py * bend;
  const N = 18;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * tx + 2 * u * t * cx + t * t * ex;
    const y = u * u * ty + 2 * u * t * cy + t * t * ey;
    const dx = 2 * u * (cx - tx) + 2 * t * (ex - cx);
    const dy = 2 * u * (cy - ty) + 2 * t * (ey - cy);
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const w = TIP_W + (BUTT_W - TIP_W) * t;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (const [x, y] of left) ctx.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1]);
  ctx.closePath();
  if (ghost) {
    const gg = ctx.createLinearGradient(tx, ty, ex, ey);
    gg.addColorStop(0, 'rgba(255,236,196,1)');
    gg.addColorStop(0.45, 'rgba(255,236,196,0.5)');
    gg.addColorStop(1, 'rgba(255,236,196,0)');
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.restore();
    return;
  }
  const g = ctx.createLinearGradient(tx, ty, ex, ey);
  const stops: [number, string][] = [
    [0, '#3a86ff'],
    [0.022, '#3a86ff'],
    [0.023, '#fffaf0'],
    [0.055, '#fffaf0'],
    [0.056, '#f7d9a3'],
    [0.6, '#e9b877'],
    [0.601, '#ffcc33'],
    [0.63, '#ffcc33'],
    [0.631, '#7a3514'],
    [0.8, '#6b2f12'],
    [0.801, '#c0602e'],
    [0.84, '#c0602e'],
    [0.841, '#5e2810'],
    [1, '#4a1f0c'],
  ];
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  // Specular stripe along the shaft.
  ctx.beginPath();
  for (let i = 2; i <= N - 1; i++) {
    const [lx, ly] = left[i]!;
    const [rx, ry] = right[i]!;
    const x = lx + (rx - lx) * 0.3;
    const y = ly + (ry - ly) * 0.3;
    if (i === 2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.restore();
}

function drawPegs(ctx: CanvasRenderingContext2D, game: Game, fx: Fx) {
  const cue = game.cue;
  const k = game.spin.progress;
  const alpha = Math.min(1, k * 8) * Math.min(1, (1 - k) * 10 + 0.25);
  const rr = R * 2.35;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, rr, 0, TAU);
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 9]);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < PEGS; i++) {
    const a = (i / PEGS) * TAU;
    const flick = fx.pegFlick[i] ?? 0;
    const x = cue.x + Math.cos(a) * rr;
    const y = cue.y + Math.sin(a) * rr;
    ctx.beginPath();
    ctx.arc(x, y, 4 + flick * 4, 0, TAU);
    ctx.fillStyle = flick > 0.05 ? COLORS.knob : '#fffaf0';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPowerRing(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, t: number) {
  const rr = R + 14;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, TAU);
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(20,8,40,0.55)';
  ctx.stroke();
  const col = p < 0.5 ? '#06d6a0' : p < 0.85 ? '#ffd23f' : '#ff4040';
  ctx.beginPath();
  ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.01, p));
  ctx.lineWidth = 7 + (p >= 1 ? Math.sin(t * 30) * 2 : 0);
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.restore();
}

export function drawSpeedLines(ctx: CanvasRenderingContext2D, fx: Fx): void {
  const s = fx.speedLines;
  if (!s) return;
  const k = s.t / 0.3;
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = '#fffaf0';
  ctx.lineCap = 'round';
  const base = Math.atan2(-s.dy, -s.dx);
  for (let i = 0; i < 14; i++) {
    const spread = ((i * 0.6180339) % 1) - 0.5;
    const a = base + spread * 1.6;
    const d0 = R * 1.4 + k * 60 + (i % 3) * 10;
    const len = (40 + 90 * s.power) * (1 - k * 0.5);
    ctx.beginPath();
    ctx.moveTo(s.x + Math.cos(a) * d0, s.y + Math.sin(a) * d0);
    ctx.lineTo(s.x + Math.cos(a) * (d0 + len), s.y + Math.sin(a) * (d0 + len));
    ctx.lineWidth = 3 + (i % 2) * 2;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- guide ray

function arrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  w = 6,
) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const hx = x1 - Math.cos(a) * 14;
  const hy = y1 - Math.sin(a) * 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(hx, hy);
  ctx.lineWidth = w + 4;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.5) * 20, y1 - Math.sin(a - 0.5) * 20);
  ctx.lineTo(x1 - Math.cos(a + 0.5) * 20, y1 - Math.sin(a + 0.5) * 20);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/**
 * The guide in two layers: lines and the ghost ball go under the balls (`layer: 'under'`), the
 * object-ball arrow and the scratch warning go on top (`layer: 'over'`).
 */
export function drawGuide(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  cam: Camera,
  layer: 'under' | 'over',
  guide?: Guide,
): void {
  if (game.phase !== 'plan') return;
  const cue = game.cue;
  if (!cue.active) return;
  const g = guide ?? game.guide();
  if (layer === 'over') {
    drawGuideOver(ctx, game, fx, cam, g);
    return;
  }
  const t = fx.time;
  const dx = Math.cos(game.aim);
  const dy = Math.sin(game.aim);
  const x0 = cue.x + dx * (R + 3);
  const y0 = cue.y + dy * (R + 3);
  const { x1, y1 } = g.path;
  const intro = Math.min(1, game.phaseT * 3);
  ctx.save();
  ctx.globalAlpha = intro;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const bent = g.curve && g.curve.length > 1;
  if (bent || g.hop || (Math.hypot(x1 - x0, y1 - y0) > 2 && (x1 - x0) * dx + (y1 - y0) * dy > 0)) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    // With side English the path bends through the skid before running straight.
    if (bent) for (let i = 1; i < g.curve!.length; i++) ctx.lineTo(g.curve![i]!.x, g.curve![i]!.y);
    // Through a portal: into the entrance, then on from the exit.
    if (g.hop) {
      ctx.lineTo(g.hop.path.x1, g.hop.path.y1);
      ctx.moveTo(g.path.x0, g.path.y0);
    }
    ctx.lineTo(x1, y1);
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(20,8,40,0.35)';
    ctx.stroke();
    ctx.setLineDash([16, 13]);
    ctx.lineDashOffset = -t * 80;
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = COLORS.guide;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (g.hop) {
    // Little swirls where the ball dives in and pops out.
    for (const [px, py, col] of [
      [g.hop.path.x1, g.hop.path.y1, '#ff9f1c'],
      [g.path.x0, g.path.y0, '#4cc9f0'],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, TAU);
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = t * 40;
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Ghost ball where the cue will make contact.
  ctx.beginPath();
  ctx.arc(x1, y1, R, 0, TAU);
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = t * 30;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.setLineDash([]);

  if (g.kind === 'rail' || g.kind === 'part' || g.kind === 'bumper') {
    const cx = x1 - g.nx * R;
    const cy = y1 - g.ny * R;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 2);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
      ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.knob;
    ctx.stroke();
    ctx.restore();
  }
  const faint = (x: number, y: number, xe: number, ye: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(xe, ye);
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = -t * 60;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (g.bounce) faint(g.bounce.x0, g.bounce.y0, g.bounce.x1, g.bounce.y1);
  if (g.deflect) faint(g.deflect.x0, g.deflect.y0, g.deflect.x1, g.deflect.y1);
  ctx.restore();
}

/** What the guide says where it stops short: past a pad, portal or black hole it would be guessing. */
const STOP_WORDS: Partial<Record<Guide['kind'], [string, string]>> = {
  boost: ['ZOOM?', '#ffd23f'],
  portal: ['WHOOSH?', '#4cc9f0'],
  vortex: ['GLORP?', '#c77dff'],
};

function guideLabel(
  ctx: CanvasRenderingContext2D,
  game: Game,
  cam: Camera,
  t: number,
  text: string,
  color: string,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 7) * 4);
  ctx.rotate(cam.upright + Math.sin(t * 5) * 0.08);
  const s = backOut(Math.min(1, game.phaseT * 2.5));
  ctx.scale(s, s);
  ctx.font = `30px ${POP_FONT}`;
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

function drawGuideOver(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera, g: Guide): void {
  const t = fx.time;
  ctx.save();
  ctx.globalAlpha = Math.min(1, game.phaseT * 3);
  const stop = STOP_WORDS[g.kind];
  if (stop) {
    // Above the ghost ball, toward the top of the screen.
    const up = cam.screenToWorldDir(0, -1);
    guideLabel(ctx, game, cam, t, stop[0], stop[1], g.path.x1 + up.x * (R + 30), g.path.y1 + up.y * (R + 30));
  }
  if (g.target) {
    const b = g.target.ball;
    const len = 125 + 10 * Math.sin(t * 6);
    arrow(
      ctx,
      b.x + g.target.dx * R * 1.15,
      b.y + g.target.dy * R * 1.15,
      b.x + g.target.dx * (R + len),
      b.y + g.target.dy * (R + len),
      b.color,
    );
  }
  if (g.pocket) {
    const p = g.pocket;
    const o = fx.jelly.offset(p.vid);
    const px = p.x + o.x;
    const py = p.y + o.y;
    const r = (fx.holeR.get(p.vid) ?? p.r) + 12 + Math.sin(t * 10) * 3;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = t * 40;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff4d6d';
    ctx.stroke();
    ctx.setLineDash([]);
    guideLabel(ctx, game, cam, t, 'GULP?', '#ff4d6d', px + p.inx * (r + 34), py + p.iny * (r + 34));
  }
  ctx.restore();
}
