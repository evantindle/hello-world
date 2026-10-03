import { BLACKHOLE_CORE, COLORS } from '../config';
import { TAU } from '../core/vec';
import type { Fx } from '../fx/fx';
import type { Game } from '../game/game';
import { compileFloor, type Field, type Part, type PortalEnd, type Zone } from '../geom/parts';
import type { Camera } from './camera';
import { tracePath, type VisualTable } from './draw_table';

/**
 * Flat toys on the felt: speed pads, special felt, magnets, black holes, portals and targets.
 * Drawn under the guide and the balls, clipped to the table.
 */

/** Stable pseudo-random numbers per part, so speckles and bubbles stay put frame to frame. */
function rnd(id: number, k: number): number {
  let h = Math.imul(id + 1, 374761393) ^ Math.imul(k + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Move into the zone's frame: +x along its arrow. */
function local(ctx: CanvasRenderingContext2D, z: Zone): void {
  ctx.translate(z.cx, z.cy);
  ctx.rotate(Math.atan2(z.uy, z.ux));
}

function rect(ctx: CanvasRenderingContext2D, z: Zone, r: number): void {
  ctx.beginPath();
  ctx.roundRect(-z.hl, -z.hw, 2 * z.hl, 2 * z.hw, Math.min(r, z.hw, z.hl));
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

function drawBooster(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 14);
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  const g = ctx.createLinearGradient(-z.hl, 0, z.hl, 0);
  g.addColorStop(0, '#ff6b35');
  g.addColorStop(1, '#ffd23f');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Chevrons racing along the arrow.
  const n = Math.max(2, Math.round(z.hl / 24));
  const sp = (2 * z.hl) / n;
  const off = (t * 150) % sp;
  const h = z.hw * 0.55;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = -1; i <= n; i++) {
    const x = -z.hl + i * sp + off;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.55, -h);
    ctx.lineTo(x + h * 0.25, 0);
    ctx.lineTo(x - h * 0.55, h);
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(28,18,51,0.25)';
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff8e7';
    ctx.stroke();
  }
  ctx.restore();
  rect(ctx, z, 14);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.stroke();
  ctx.restore();
}

function drawIce(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 12);
  ctx.fillStyle = 'rgba(206,242,255,0.78)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Sheen bands sliding slowly across.
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  const gap = 150;
  const slant = z.hw * 1.2;
  for (let x = -z.hl - slant - gap + ((t * 24) % gap); x < z.hl + slant; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, -z.hw);
    ctx.lineTo(x + 36, -z.hw);
    ctx.lineTo(x + 36 - slant, z.hw);
    ctx.lineTo(x - slant, z.hw);
    ctx.closePath();
    ctx.fill();
  }
  const n = 3 + Math.round((z.hl * z.hw) / 2600);
  for (let k = 0; k < n; k++) {
    const x = (rnd(z.src, k) * 2 - 1) * (z.hl - 8);
    const y = (rnd(z.src, k + 97) * 2 - 1) * (z.hw - 8);
    const tw = 0.5 + 0.5 * Math.sin(t * 3 + k * 1.7);
    sparkle(ctx, x, y, 3 + 5 * tw, `rgba(255,255,255,${0.35 + 0.65 * tw})`);
  }
  ctx.restore();
  rect(ctx, z, 12);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.restore();
}

function drawMud(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 26);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3d2210';
  ctx.stroke();
  ctx.fillStyle = '#7a4b2a';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const n = 4 + Math.round((z.hl * z.hw) / 1800);
  for (let k = 0; k < n; k++) {
    const x = (rnd(z.src, k) * 2 - 1) * z.hl;
    const y = (rnd(z.src, k + 31) * 2 - 1) * z.hw;
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + 16 * rnd(z.src, k + 7), 6 + 9 * rnd(z.src, k + 8), rnd(z.src, k + 9) * 3, 0, TAU);
    ctx.fillStyle = '#5b351c';
    ctx.fill();
  }
  // Bubbles swell and pop.
  for (let k = 0; k < Math.max(3, n >> 1); k++) {
    const ph = (t * (0.35 + 0.3 * rnd(z.src, k + 51)) + rnd(z.src, k + 52)) % 1;
    const x = (rnd(z.src, k + 53) * 2 - 1) * (z.hl - 10);
    const y = (rnd(z.src, k + 54) * 2 - 1) * (z.hw - 10);
    if (ph < 0.85) {
      const r = 2 + 8 * (ph / 0.85);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = 'rgba(168,116,73,0.85)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU);
      ctx.fillStyle = 'rgba(255,230,200,0.6)';
      ctx.fill();
    } else {
      const k2 = (ph - 0.85) / 0.15;
      ctx.beginPath();
      ctx.arc(x, y, 10 + 6 * k2, 0, TAU);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(168,116,73,${1 - k2})`;
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.restore();
}

function drawSand(ctx: CanvasRenderingContext2D, z: Zone): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 18);
  ctx.fillStyle = '#ecd28f';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Wind ripples across the patch.
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(170,130,60,0.35)';
  for (let y = -z.hw + 12; y < z.hw; y += 16) {
    ctx.beginPath();
    for (let x = -z.hl; x <= z.hl; x += 8) {
      const yy = y + Math.sin(x * 0.06 + y * 0.3) * 3;
      if (x === -z.hl) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const n = 12 + Math.round((z.hl * z.hw) / 300);
  ctx.fillStyle = 'rgba(168,130,66,0.75)';
  for (let k = 0; k < n; k++) {
    ctx.beginPath();
    ctx.arc(
      (rnd(z.src, k) * 2 - 1) * z.hl,
      (rnd(z.src, k + 77) * 2 - 1) * z.hw,
      1.2 + rnd(z.src, k + 5),
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();
  rect(ctx, z, 18);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#c9a35a';
  ctx.stroke();
  ctx.restore();
}

function drawConveyor(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 10);
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.fillStyle = '#363a4f';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Slats moving at belt speed.
  const gap = 20;
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#555c7c';
  for (let x = -z.hl - gap + ((t * z.power) % gap); x < z.hl + gap; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, -z.hw + 5);
    ctx.lineTo(x, z.hw - 5);
    ctx.stroke();
  }
  // Rollers at both ends.
  for (const x of [-z.hl, z.hl]) {
    ctx.beginPath();
    ctx.ellipse(x, 0, 9, z.hw - 2, 0, 0, TAU);
    ctx.fillStyle = '#9aa3c0';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
  }
  ctx.restore();
  // Painted arrows down the middle.
  const n = Math.max(1, Math.round(z.hl / 70));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const x = -z.hl + ((i + 0.5) * 2 * z.hl) / n;
    const h = Math.min(14, z.hw * 0.5);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.5, -h);
    ctx.lineTo(x + h * 0.5, 0);
    ctx.lineTo(x - h * 0.5, h);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffd23f';
    ctx.stroke();
  }
  ctx.restore();
}

function drawFan(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  ctx.save();
  local(ctx, z);
  rect(ctx, z, 16);
  ctx.fillStyle = 'rgba(170,255,230,0.2)';
  ctx.fill();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.clip();
  // Gusts streaming downwind.
  const m = Math.max(3, Math.round(z.hw / 9));
  ctx.lineCap = 'round';
  for (let k = 0; k < m; k++) {
    const y = (rnd(z.src, k) * 2 - 1) * (z.hw - 6);
    const len = 26 + 30 * rnd(z.src, k + 11);
    const span = 2 * z.hl + len;
    const x =
      -z.hl -
      len +
      ((t * z.power * 0.45 * (0.7 + 0.6 * rnd(z.src, k + 12)) + rnd(z.src, k + 13) * span) % span);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y - 4, x + len, y);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
  }
  ctx.restore();
  // The fan itself, at the upwind end.
  ctx.translate(-z.hl + Math.min(22, z.hl * 0.4), 0);
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, TAU);
  ctx.fillStyle = 'rgba(28,18,51,0.55)';
  ctx.fill();
  ctx.rotate(t * 14);
  for (let k = 0; k < 3; k++) {
    ctx.rotate(TAU / 3);
    ctx.beginPath();
    ctx.ellipse(7, 0, 8, 4, 0.4, 0, TAU);
    ctx.fillStyle = '#e8f7ff';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, TAU);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.restore();
}

function drawMagnet(ctx: CanvasRenderingContext2D, f: Field, t: number, cam: Camera): void {
  const pull = f.polarity > 0;
  const tint = pull ? '255,77,109' : '46,196,182';
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, TAU);
  ctx.setLineDash([6, 10]);
  ctx.lineDashOffset = (pull ? -1 : 1) * t * 20;
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${tint},0.5)`;
  ctx.stroke();
  ctx.setLineDash([]);
  // Field rings: drawn in toward a magnet, pushed out from a repulsor.
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.55 + k / 3) % 1;
    const rr = pull ? f.r * (1 - ph) : f.r * ph;
    if (rr < 18) continue;
    ctx.beginPath();
    ctx.arc(f.x, f.y, rr, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(${tint},${0.4 * Math.sin(ph * Math.PI)})`;
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(cam.upright);
  if (pull) {
    // A horseshoe magnet, the classic cartoon kind.
    const u = () => {
      ctx.beginPath();
      ctx.moveTo(-12, -15);
      ctx.lineTo(-12, 0);
      ctx.arc(0, 0, 12, Math.PI, 0, true);
      ctx.lineTo(12, -15);
    };
    u();
    ctx.lineWidth = 17;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    u();
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#ff4d6d';
    ctx.stroke();
    for (const x of [-12, 12]) {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(x - 7, -19, 14, 9);
      ctx.fillStyle = '#e6ecf7';
      ctx.fillRect(x - 5.5, -17.5, 11, 6);
    }
  } else {
    // A springy knob with arrows pushing out.
    ctx.rotate(t * 0.8);
    for (let k = 0; k < 4; k++) {
      ctx.rotate(TAU / 4);
      ctx.beginPath();
      ctx.moveTo(21, -6);
      ctx.lineTo(30, 0);
      ctx.lineTo(21, 6);
      ctx.closePath();
      ctx.fillStyle = '#2ec4b6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.fillStyle = '#2ec4b6';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-4, -4, 5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
  }
  ctx.restore();
}

function drawBlackHole(ctx: CanvasRenderingContext2D, f: Field, t: number): void {
  const core = BLACKHOLE_CORE;
  const g = ctx.createRadialGradient(f.x, f.y, core * 0.5, f.x, f.y, f.r);
  g.addColorStop(0, 'rgba(8,0,20,0.95)');
  g.addColorStop(0.35, 'rgba(70,24,120,0.55)');
  g.addColorStop(1, 'rgba(70,24,120,0)');
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // Spiral arms, swirling in.
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    let px = 0;
    let py = 0;
    for (let i = 0; i <= 24; i++) {
      const s = i / 24;
      const rad = core + (f.r * 0.92 - core) * s;
      const a = (k * TAU) / 3 + s * 2.8 - t * 2.2;
      const x = f.x + Math.cos(a) * rad;
      const y = f.y + Math.sin(a) * rad;
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.lineWidth = 1 + 5 * (1 - s);
        ctx.strokeStyle = s < 0.4 ? `rgba(255,150,60,${0.9 - s})` : `rgba(199,125,255,${0.8 * (1 - s)})`;
        ctx.stroke();
      }
      px = x;
      py = y;
    }
  }
  // Accretion ring and the event horizon.
  ctx.beginPath();
  ctx.arc(f.x, f.y, core + 9, 0, TAU);
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -t * 60;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffb347';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(f.x, f.y, core + 2, 0, TAU);
  ctx.fillStyle = '#05020c';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = `rgba(255,123,0,${0.7 + 0.3 * Math.sin(t * 6)})`;
  ctx.stroke();
  // Where swallowed balls come back out.
  for (const e of f.exits) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, 15, 0, TAU);
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = t * 30;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(224,195,255,0.85)';
    ctx.stroke();
    ctx.setLineDash([]);
    sparkle(ctx, e.x, e.y, 5 + Math.sin(t * 4) * 1.5, 'rgba(240,225,255,0.9)');
  }
}

/** Portal pairs get matching colours: [first end, second end]. */
const PORTAL_COLORS: readonly (readonly [string, string])[] = [
  ['#ff9f1c', '#4cc9f0'],
  ['#06d6a0', '#ff5d8f'],
  ['#ffd23f', '#9b5de5'],
];

export function portalColor(ends: readonly PortalEnd[], e: PortalEnd): string {
  const keys = [...new Set(ends.map((q) => Math.min(q.src, q.link)))].sort((a, b) => a - b);
  const pair = PORTAL_COLORS[keys.indexOf(Math.min(e.src, e.link)) % PORTAL_COLORS.length]!;
  return e.src < e.link ? pair[0] : pair[1];
}

function drawPortal(ctx: CanvasRenderingContext2D, e: PortalEnd, color: string, t: number): void {
  const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
  g.addColorStop(0, 'rgba(5,2,12,0.92)');
  g.addColorStop(0.65, `${color}66`);
  g.addColorStop(1, `${color}00`);
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = t * 3 + (k * TAU) / 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 0.6, a, a + 1.3);
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, TAU);
  ctx.lineWidth = 7;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * One flat toy on its own (the ghost of a toy coming out of the tray). Portals are drawn as a lone
 * end in its pair's first colour.
 */
export function drawFloorPart(ctx: CanvasRenderingContext2D, p: Part, t: number, cam: Camera): void {
  const c = compileFloor([p]);
  for (const z of c.zones) drawZone(ctx, z, t);
  for (const f of c.fields) {
    if (f.kind === 'blackhole') drawBlackHole(ctx, f, t);
    else drawMagnet(ctx, f, t, cam);
  }
  if (p.kind === 'portal') {
    drawPortal(ctx, { src: p.id, link: p.link, x: p.x, y: p.y, r: p.r, ox: p.x, oy: p.y, to: 0 }, PORTAL_COLORS[0]![0], t);
  }
  if (p.kind === 'bullseye') drawBullseye(ctx, p, t);
}

function drawZone(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
  switch (z.kind) {
    case 'booster':
      drawBooster(ctx, z, t);
      break;
    case 'ice':
      drawIce(ctx, z, t);
      break;
    case 'mud':
      drawMud(ctx, z, t);
      break;
    case 'sand':
      drawSand(ctx, z);
      break;
    case 'conveyor':
      drawConveyor(ctx, z, t);
      break;
    case 'fan':
      drawFan(ctx, z, t);
      break;
  }
}

function drawBullseye(ctx: CanvasRenderingContext2D, p: Part & { kind: 'bullseye' }, t: number): void {
  for (let i = 3; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, (p.r * i) / 3, 0, TAU);
    ctx.fillStyle = i % 2 === 1 ? 'rgba(255,77,109,0.55)' : 'rgba(255,248,231,0.55)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 3 + Math.sin(t * 3) * 2, 0, TAU);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = COLORS.ink;
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawFloorParts(
  ctx: CanvasRenderingContext2D,
  game: Game,
  fx: Fx,
  cam: Camera,
  vt: VisualTable,
): void {
  const g = game.geom;
  const t = fx.time;
  const any =
    g.zones.length ||
    g.fields.length ||
    g.portals.length ||
    game.table.parts.some((p) => p.kind === 'bullseye');
  if (!any) return;
  ctx.save();
  tracePath(ctx, vt);
  ctx.clip();
  for (const z of g.zones) drawZone(ctx, z, t);
  for (const p of game.table.parts) if (p.kind === 'bullseye') drawBullseye(ctx, p, t);
  for (const f of g.fields) {
    if (f.kind === 'blackhole') drawBlackHole(ctx, f, t);
    else drawMagnet(ctx, f, t, cam);
  }
  for (const e of g.portals) drawPortal(ctx, e, portalColor(g.portals, e), t);
  ctx.restore();
}
