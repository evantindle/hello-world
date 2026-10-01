import { COLORS, R, RESPAWN_TIME } from '../config';
import { cubicIn, quadOut } from '../core/easing';
import { TAU } from '../core/vec';
import type { BallFx } from '../fx/ballfx';
import type { Fx } from '../fx/fx';
import type { Game } from '../game/game';
import type { Ball } from '../physics/world';
import type { Camera } from './camera';

const HOP_START = 0.35;

const shadeCache = new Map<string, string>();
/** Mix a #rrggbb colour toward black (amt < 0) or white (amt > 0). */
export function shade(hex: string, amt: number): string {
  const key = hex + amt;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  r = Math.round(r + (t - r) * k);
  g = Math.round(g + (t - g) * k);
  b = Math.round(b + (t - b) * k);
  const out = `rgb(${r},${g},${b})`;
  shadeCache.set(key, out);
  return out;
}

/** Where the respawning cue ball is: ground position, height above the felt, progress. */
export function hopState(game: Game): { x: number; y: number; h: number; k: number } | null {
  const r = game.respawn;
  if (game.phase !== 'respawn' || !r) return null;
  const k = Math.max(0, Math.min(1, (game.phaseT - HOP_START) / (RESPAWN_TIME - HOP_START)));
  const e = quadOut(k);
  return {
    x: r.fromX + (r.toX - r.fromX) * e,
    y: r.fromY + (r.toY - r.fromY) * e,
    h: 190 * 4 * k * (1 - k),
    k,
  };
}

export function drawBallShadows(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
  // Shadows fall down-right on screen whatever the camera rotation.
  const { x: ox, y: oy } = cam.screenToWorldDir(6, 9);
  ctx.fillStyle = 'rgba(10,4,26,0.34)';
  ctx.beginPath();
  for (const b of game.balls) {
    if (!b.active) continue;
    ctx.moveTo(b.x + ox + R * 1.02, b.y + oy);
    ctx.ellipse(b.x + ox, b.y + oy, R * 1.02, R * 0.96, 0, 0, TAU);
  }
  ctx.fill();
  const hop = hopState(game);
  if (hop && hop.k > 0 && hop.k < 1) {
    const sc = 1 - hop.h / 400;
    ctx.globalAlpha = 0.5 * sc;
    ctx.beginPath();
    ctx.ellipse(hop.x + ox, hop.y + oy, R * sc, R * 0.9 * sc, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  void fx;
}

export function drawBalls(ctx: CanvasRenderingContext2D, game: Game, fx: Fx, cam: Camera): void {
  // Sinking balls first (they are in the holes, under everything else).
  for (const b of game.balls) {
    const f = fx.balls.get(b.id);
    if (!b.active && f.sink) drawSinking(ctx, b, f, fx, cam, game);
  }
  for (const b of game.balls) {
    if (!b.active) continue;
    const f = fx.balls.get(b.id);
    drawBall(ctx, b, f, fx, cam, game, b.x, b.y, fx.balls.growScale(f));
  }
  const hop = hopState(game);
  if (hop && hop.k > 0) {
    const cue = game.cue;
    drawBall(ctx, cue, fx.balls.get(cue.id), fx, cam, game, hop.x, hop.y - hop.h, 1 + hop.h / 380);
  }
}

function drawSinking(ctx: CanvasRenderingContext2D, b: Ball, f: BallFx, fx: Fx, cam: Camera, game: Game) {
  const s = f.sink!;
  const k = Math.min(1, s.t / s.dur);
  const e = cubicIn(k);
  const ang = s.dir * k * 5;
  const dx = s.x0 - s.hx;
  const dy = s.y0 - s.hy;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const shrink = 1 - e;
  const x = s.hx + (dx * c - dy * sn) * shrink;
  const y = s.hy + (dx * sn + dy * c) * shrink;
  const scale = 1 - 0.6 * k;
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.hx, s.hy, s.hr, 0, TAU);
  ctx.clip();
  drawBall(ctx, b, f, fx, cam, game, x, y, scale);
  ctx.globalAlpha = Math.min(1, k * 1.1);
  ctx.beginPath();
  ctx.arc(x, y, R * scale + 1.5, 0, TAU);
  ctx.fillStyle = '#05020c';
  ctx.fill();
  ctx.restore();
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  b: Ball,
  f: BallFx,
  fx: Fx,
  cam: Camera,
  game: Game,
  x: number,
  y: number,
  scale: number,
): void {
  const up = cam.upright;
  ctx.save();
  ctx.translate(x, y);
  const sq = fx.balls.squashScale(f);
  if (sq !== 1) {
    const a = Math.atan2(f.sqNy, f.sqNx);
    ctx.rotate(a);
    ctx.scale(sq, 1 / sq);
    ctx.rotate(-a);
  }
  const sp = b.active ? Math.hypot(b.vx, b.vy) : 0;
  if (sp > 250) {
    const k = Math.min(0.16, sp / 14000);
    const a = Math.atan2(b.vy, b.vx);
    ctx.rotate(a);
    ctx.scale(1 + k, 1 - k * 0.55);
    ctx.rotate(-a);
  }
  if (scale !== 1) ctx.scale(scale, scale);
  // Ghosts are see-through.
  if (b.variant === 'ghost') ctx.globalAlpha *= 0.55;

  const base = b.kind === 'cue' ? COLORS.cue : (VARIANT_COLOR[b.variant] ?? b.color);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fillStyle = shade(base, -0.28);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.rotate(up);
  ctx.beginPath();
  ctx.arc(-R * 0.14, -R * 0.16, R * 0.93, 0, TAU);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.rotate(-up);
  if (b.kind === 'object') drawDecals(ctx, b, f, up);
  if (b.variant === 'bowling') {
    // Finger holes ride round with the ball.
    decal(ctx, f.qx, f.qy, f.qh, R * 0.15, '#0e0f1c', null, up);
    decal(ctx, -f.qx * 0.8 + f.px * 0.6, -f.qy * 0.8 + f.py * 0.6, -f.qh * 0.8 + f.ph * 0.6, R * 0.13, '#0e0f1c', null, up);
    decal(ctx, f.qx * 0.3 - f.px * 0.95, f.qy * 0.3 - f.py * 0.95, f.qh * 0.3 - f.ph * 0.95, R * 0.13, '#0e0f1c', null, up);
  } else if (b.variant === 'egg') {
    ctx.fillStyle = 'rgba(160,120,80,0.45)';
    for (const [sx, sy] of EGG_SPECKS) {
      ctx.beginPath();
      ctx.arc(sx * R, sy * R, 1.8, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.rotate(up);
  ctx.beginPath();
  ctx.ellipse(-R * 0.36, -R * 0.43, R * 0.3, R * 0.17, -0.65, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-R * 0.06, -R * 0.6, R * 0.065, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  if (b.kind === 'cue') drawFace(ctx, f, fx, game, up);
  else if (b.variant !== 'normal') drawVariant(ctx, b, fx, up);
  ctx.restore();
}

const VARIANT_COLOR: Partial<Record<Ball['variant'], string>> = {
  bowling: '#2e3150',
  egg: '#fff3dc',
  bomb: '#26283d',
  chicken: '#fffdf5',
  golden: '#ffcc33',
};

const EGG_SPECKS: [number, number][] = [
  [-0.4, -0.2],
  [0.3, -0.5],
  [0.5, 0.2],
  [-0.2, 0.45],
  [0.05, 0.05],
  [-0.55, 0.3],
];

/** Upright decorations for the oddball balls (they keep facing the viewer as the ball rolls). */
function drawVariant(ctx: CanvasRenderingContext2D, b: Ball, fx: Fx, up: number) {
  const t = fx.time;
  ctx.save();
  ctx.rotate(up);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (b.variant) {
    case 'egg': {
      if (b.hp < 2) {
        // A crack across the shell.
        ctx.beginPath();
        ctx.moveTo(-R * 0.8, -R * 0.1);
        ctx.lineTo(-R * 0.4, R * 0.1);
        ctx.lineTo(-R * 0.1, -R * 0.15);
        ctx.lineTo(R * 0.25, R * 0.12);
        ctx.lineTo(R * 0.55, -R * 0.08);
        ctx.lineTo(R * 0.85, R * 0.05);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
      }
      break;
    }
    case 'bomb': {
      // A fuse that shortens with every knock, fizzing at the tip.
      const len = 6 + b.fuse * 6;
      ctx.beginPath();
      ctx.moveTo(0, -R + 2);
      ctx.quadraticCurveTo(len * 0.4, -R - len * 0.6, len * 0.7, -R - len);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#8a6a3a';
      ctx.stroke();
      const sx = len * 0.7;
      const sy = -R - len;
      const fl = 4 + Math.sin(t * 40) * 2 + (3 - b.fuse) * 2;
      star(ctx, sx, sy, fl, b.fuse <= 1 ? '#ff4d6d' : '#ffe45c');
      ctx.beginPath();
      ctx.roundRect(-5, -R - 3, 10, 6, 2);
      ctx.fillStyle = '#7d8aa3';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      break;
    }
    case 'chicken': {
      const sp = Math.hypot(b.vx, b.vy);
      // Comb.
      ctx.fillStyle = '#ff3b3b';
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.6;
      for (const cx of [-5, 0, 5]) {
        ctx.beginPath();
        ctx.arc(cx, -R - 1 - (cx === 0 ? 3 : 0), 4, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      // Eyes and beak.
      for (const ex of [-6, 6]) {
        ctx.beginPath();
        ctx.arc(ex, -5, 2.6, 0, TAU);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-5, 1);
      ctx.lineTo(0, 9);
      ctx.lineTo(5, 1);
      ctx.closePath();
      ctx.fillStyle = '#ffb300';
      ctx.fill();
      ctx.stroke();
      // Little legs that run when it runs.
      const run = sp > 30 ? Math.sin(t * 30) * 5 : 0;
      ctx.beginPath();
      ctx.moveTo(-6, R - 2);
      ctx.lineTo(-6 + run, R + 7);
      ctx.moveTo(6, R - 2);
      ctx.lineTo(6 - run, R + 7);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#ff9a1f';
      ctx.stroke();
      break;
    }
    case 'ghost': {
      // Wavy tail and hollow eyes.
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = -R + (i / 8) * 2 * R;
        const y = R * 0.85 + Math.sin(t * 8 + i) * 3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      for (const ex of [-7, 7]) {
        ctx.beginPath();
        ctx.ellipse(ex, -4, 3, 5, 0, 0, TAU);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
      }
      break;
    }
    case 'golden': {
      const a = t * 2;
      star(ctx, Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, 5, '#fffbe0');
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawDecals(ctx: CanvasRenderingContext2D, b: Ball, f: BallFx, up: number) {
  if (b.stripe) {
    // Polka dots ride on the other two body axes.
    const rx = f.py * f.qh - f.ph * f.qy;
    const ry = f.ph * f.qx - f.px * f.qh;
    const rh = f.px * f.qy - f.py * f.qx;
    decal(ctx, f.qx, f.qy, f.qh, R * 0.3, '#fff8e7', null, up);
    decal(ctx, -f.qx, -f.qy, -f.qh, R * 0.3, '#fff8e7', null, up);
    decal(ctx, rx, ry, rh, R * 0.3, '#fff8e7', null, up);
    decal(ctx, -rx, -ry, -rh, R * 0.3, '#fff8e7', null, up);
  }
  const text = String(b.num);
  decal(ctx, f.px, f.py, f.ph, R * 0.47, '#fff8e7', text, up);
  decal(ctx, -f.px, -f.py, -f.ph, R * 0.47, '#fff8e7', text, up);
}

/** A flat circle printed on the sphere at body direction (x, y, h), foreshortened. */
function decal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  rad: number,
  color: string,
  text: string | null,
  up: number,
) {
  if (h <= 0.02) return;
  const a = Math.atan2(y, x);
  ctx.save();
  ctx.translate(x * R, y * R);
  ctx.rotate(a);
  ctx.scale(Math.max(0.05, h), 1);
  ctx.rotate(-a);
  ctx.globalAlpha *= Math.min(1, h * 6);
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  if (text) {
    ctx.rotate(up);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${Math.round(rad * (text.length > 1 ? 1.0 : 1.25))}px Fredoka, "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, rad * 0.08);
  }
  ctx.restore();
}

/** The cue ball is a character. These are its googly eyes and moods. */
function drawFace(ctx: CanvasRenderingContext2D, f: BallFx, fx: Fx, game: Game, up: number) {
  ctx.save();
  // Sidespin twirls the whole face around (the look vector below stays in the upright frame).
  ctx.rotate(up + f.yaw);
  // Look vector is in world space; bring it into the upright frame.
  const c = Math.cos(-up);
  const s = Math.sin(-up);
  const lx = f.lookX * c - f.lookY * s;
  const ly = f.lookX * s + f.lookY * c;
  let mood = f.mood;
  if (mood === 'normal' && game.charging) mood = game.power > 0.85 ? 'worried' : 'squint';
  if (game.phase === 'over') mood = 'happy';
  const t = fx.time;
  const ex = R * 0.34;
  const ey = -R * 0.12;
  ctx.lineWidth = 2.3;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineCap = 'round';

  if (mood === 'squeeze') {
    ctx.beginPath();
    ctx.moveTo(-ex - 6, ey - 6);
    ctx.lineTo(-ex + 5, ey);
    ctx.lineTo(-ex - 6, ey + 6);
    ctx.moveTo(ex + 6, ey - 6);
    ctx.lineTo(ex - 5, ey);
    ctx.lineTo(ex + 6, ey + 6);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (mood === 'happy') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-ex, ey + 3, 6, Math.PI * 1.1, Math.PI * 1.9);
    ctx.moveTo(ex + 6 * Math.cos(Math.PI * 1.1), ey + 3 + 6 * Math.sin(Math.PI * 1.1));
    ctx.arc(ex, ey + 3, 6, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, R * 0.25, R * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const er = mood === 'shock' ? R * 0.4 : R * 0.33;
  const pr = mood === 'shock' || mood === 'worried' ? R * 0.09 : R * 0.155;
  for (const side of [-1, 1]) {
    const cx = side * ex;
    ctx.beginPath();
    ctx.arc(cx, ey, er, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, ey, er - 1, 0, TAU);
    ctx.clip();
    if (mood === 'dizzy') {
      ctx.beginPath();
      const rot = t * 9 * side;
      for (let k = 0; k <= 28; k++) {
        const a = rot + k * 0.45;
        const rr = (k / 28) * er * 0.8;
        const px = cx + Math.cos(a) * rr;
        const py = ey + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else {
      const jitter = mood === 'worried' ? Math.sin(t * 70 + side) * 0.8 : 0;
      const px = cx + lx * er * 0.45 + jitter;
      const py = ey + ly * er * 0.45;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, TAU);
      ctx.fillStyle = COLORS.ink;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.32, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    // Eyelids: blink, squint.
    const lid = Math.max(f.blink, mood === 'squint' ? 0.45 : mood === 'worried' ? 0.15 : 0);
    if (lid > 0.01) {
      ctx.beginPath();
      ctx.rect(cx - er, ey - er, er * 2, er * 2 * lid);
      ctx.fillStyle = shade(COLORS.cue, -0.12);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - er, ey - er + er * 2 * lid);
      ctx.lineTo(cx + er, ey - er + er * 2 * lid);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Eyebrows.
  if (mood === 'squint' || mood === 'worried') {
    const inner = mood === 'squint' ? 5 : -5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-ex - 8, ey - er - 5 - inner * 0.3);
    ctx.lineTo(-ex + 7, ey - er - 5 + inner * 0.6);
    ctx.moveTo(ex + 8, ey - er - 5 - inner * 0.3);
    ctx.lineTo(ex - 7, ey - er - 5 + inner * 0.6);
    ctx.stroke();
  }
  if (mood === 'shock') {
    ctx.beginPath();
    ctx.ellipse(0, R * 0.5, R * 0.12, R * 0.16, 0, 0, TAU);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
  }
  if (mood === 'dizzy') {
    // Orbiting stars.
    for (let k = 0; k < 3; k++) {
      const a = t * 4 + (k * TAU) / 3;
      star(ctx, Math.cos(a) * R * 1.05, -R * 0.95 + Math.sin(a) * R * 0.3, 5.5, COLORS.knob);
    }
  }
  ctx.restore();
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}
