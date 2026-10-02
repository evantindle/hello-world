import { BLACKHOLE_CORE, COLORS, R, TABLE_H, TABLE_W } from '../config';
import type { Sfx } from '../audio/sfx';
import type { Game } from '../game/game';
import { PEGS } from '../game/spin';
import type { Camera } from '../render/camera';
import { chargePull } from '../render/draw_cue';
import { portalColor } from '../render/draw_floor';
import type { Hud } from '../ui/hud';
import type { Fx } from './fx';

const SMALL_BALL = ['tink', 'tap', 'clik', 'bonk'];
const MID_BALL = ['CLACK!', 'BONK!', 'WHAM!', 'OOF!', 'THOK!'];
const BIG_BALL = ['KAPOW!!', 'CRUNCH!!', 'YEET!!', 'KRAKOOM!', 'WALLOP!!'];
const SMALL_WALL = ['boing', 'doink', 'bwomp', 'sproing'];
const BIG_WALL = ['BOING!!', 'SPROING!', 'BWAAANG!', 'DOYOYOING!'];
const GULPS = ['GULP!', 'YOINK!', 'SCHLOOP!', 'PLOP!', 'NOM!', 'SLURP!', 'SEE YA!'];
const EIGHT_BALL = ['OUTLOOK: GOOD', 'SIGNS POINT TO YES', 'ASK AGAIN LATER', 'IT IS CERTAIN'];
const MISSES = [
  'nothing.',
  'the felt is disappointed',
  'bold strategy',
  'swing and a miss',
  'the balls are unimpressed',
  'a lovely stroll',
  'so close (not really)',
];
const STREAKS = ['', 'NICE!', 'SPICY!', 'TABLE WIZARD!', 'UNBENDLIEVABLE!'];
const BUMPS = ['BOING!', 'DING!', 'PING!', 'BWONG!', 'BOINK!'];
const ZOOMS = ['ZOOM!', 'NYOOM!', 'VROOM!', 'ZING!'];
const WARPS = ['WHOOSH!', 'ZIP!', 'BLINK!', 'FWOOP!'];
const GLORPS = ['GLORP!', 'SHLOOP!', 'BYE!', 'SPAGHETTI!'];

function pick<T>(list: readonly T[], r: () => number): T {
  return list[Math.floor(r() * list.length)]!;
}
const BLOCKED: Record<string, string> = {
  'keep-out': 'NO FREE LUNCH!',
  budget: 'OUT OF STRETCH!',
  crushed: 'SQUISH!',
  'squeezed-out': 'NOPE!',
  'out-of-bounds': 'TOO FAR!',
  tiny: 'TOO SMALL!',
  crossing: 'NOPE!',
  pinch: 'TOO TIGHT!',
  'short-edge': 'NOPE!',
  sharp: 'TOO POINTY!',
  bolted: 'BOLTED!',
  steel: 'STEEL!',
  'part-in-the-way': 'TOY IN THE WAY!',
  'off-table': 'OFF THE TABLE!',
  'on-pocket': 'NOT ON A POCKET!',
  overlap: 'NO ROOM!',
  tokens: 'NO GRABS LEFT!',
  reach: 'TOO FAR!',
  locked: 'STUCK!',
};
const PLONKS = ['PLONK!', 'THUNK!', 'PLOP!', 'TA-DA!'];

/**
 * The juice router: listens to game events and turns them into sound, shake, jelly, word pops,
 * particles, faces and toasts. The game logic never knows any of this exists.
 */
export class Director {
  private hits: number[] = [];
  private blammed = false;
  private later: { t: number; fn: () => void }[] = [];
  private dragLast = new Map<number, { x: number; y: number; t: number }>();
  private lastBlockPop = 0;
  private maxPopped = false;
  private sweatT = 0;
  private droolT = 0;
  private cueWasBraking = false;
  private skidT = 0;
  private turn = 0;
  private now = 0;
  private lastDialTick = 0;
  private lastBumpPop = 0;
  private lastZoomPop = 0;
  private lastFeltPop = 0;
  private bawked = false;
  /** English watch for the current shot: launch heading, the cue's velocity right after its
   * first contact, and which exclamations have been used. */
  private eng = {
    on: false,
    dx: 0,
    dy: 0,
    after: null as { vx: number; vy: number } | null,
    banana: false,
    screw: false,
    whee: false,
    swirlT: 0,
  };

  constructor(
    private readonly game: Game,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
    private readonly cam: Camera,
    private readonly hud: Hud,
  ) {
    const ev = game.events;
    const r = fx.rand;
    const pop = (text: string, x: number, y: number, o: Parameters<Fx['pops']['add']>[4] = {}) =>
      fx.pops.add(text, x, y, r, o);

    ev.on('newGame', () => {
      fx.reset(game);
      this.turn = 0;
      this.later = [];
      fx.jelly.wobbleAll(r, 260);
    });

    ev.on('phase', ({ to }) => {
      if (
        to === 'spin' &&
        game.shots === 0 &&
        game.rules.mode === 'free' &&
        game.tableName &&
        game.tableName !== 'THE CLASSIC'
      ) {
        // A new remixed table: say what it is.
        this.after(0.2, () => hud.toast(game.tableName!, 'wow'));
      }
      if (to === 'spin') {
        this.turn++;
        sfx.spinStart();
        hud.showBanner('SPIN IT!', 'spin');
        const c = game.cue;
        this.cam.zoomTarget = 1.1;
        this.cam.focusTargetX = TABLE_W / 2 + (c.x - TABLE_W / 2) * 0.35;
        this.cam.focusTargetY = TABLE_H / 2 + (c.y - TABLE_H / 2) * 0.35;
      } else if (to === 'plan') {
        this.resetCamera();
        this.maxPopped = false;
        hud.showBanner('BEND IT!', 'bend');
      } else if (to === 'sim') {
        this.blammed = false;
        this.hits = [];
        this.cueWasBraking = false;
        this.bawked = false;
      } else if (to === 'over') {
        this.resetCamera();
        const info = game.lastOver;
        if (info?.result === 'fail') {
          // (╯°□°)╯︵ ┻━┻
          fx.startFlip(game);
          hud.flipBanner();
          sfx.trombone();
          this.cam.addShake(0.25);
          this.after(0.85, () => {
            sfx.crash();
            this.cam.addShake(0.9);
          });
          this.after(1.2, () => hud.showOver(info));
          return;
        }
        fx.confettiRain = 5;
        fx.fireworks = 4.5;
        fx.balls.setMood(0, 'happy', 30);
        sfx.fanfare();
        this.after(1.1, () => {
          if (!info) return;
          hud.showOver(info);
          // The win card's stars land one by one.
          if (info.levelId)
            for (let i = 0; i < info.stars; i++) this.after(0.35 + i * 0.3, () => sfx.star(i));
        });
      } else if (to === 'title') {
        this.resetCamera();
      }
    });

    ev.on('spinTick', ({ speed }) => {
      sfx.tick(speed);
      const stick = game.aim + Math.PI;
      const idx = ((Math.floor((stick / (Math.PI * 2)) * PEGS) % PEGS) + PEGS) % PEGS;
      fx.pegFlick[idx] = 1;
    });

    ev.on('spinLand', ({ angle }) => {
      sfx.pop();
      const c = game.cue;
      const sx = c.x - Math.cos(angle) * (R + 120);
      const sy = c.y - Math.sin(angle) * (R + 120);
      fx.particles.stars(sx, sy, 6, 160, r);
    });

    ev.on('chargeStart', () => {
      sfx.strainStart();
      hud.showBanner('SMACK IT!', 'smack');
    });

    ev.on('chargeCancel', () => {
      sfx.strainStop();
      this.resetCamera();
    });

    ev.on('dial', ({ value }) => {
      fx.dialShow = 1.4;
      if (this.now - this.lastDialTick > 0.04) {
        this.lastDialTick = this.now;
        sfx.tick(6 + value * 26);
      }
    });

    ev.on('english', ({ x, y }) => {
      fx.englishShow = 1.4;
      if (Math.hypot(x, y) > 0.05) fx.balls.setMood(0, 'squint', 0.25);
    });

    ev.on('phase', ({ to }) => {
      if (to === 'strike') {
        sfx.strainStop();
        fx.releasePull = chargePull(game.strikePower);
        fx.balls.setMood(0, 'squint', 0.2);
      }
    });

    ev.on('strike', ({ power, x, y, dx, dy }) => {
      const shot = game.shot;
      const english = !!shot && (shot.ex !== 0 || shot.ey !== 0);
      this.eng = { on: english, dx, dy, after: null, banana: false, screw: false, whee: false, swirlT: 0 };
      if (english) {
        // Chalk puff where the tip meets the ball.
        const side = (shot.ex / 100) * R * 0.55;
        fx.particles.dust(x - dx * R - dy * side, y - dy * R + dx * side, 9, 150, r, '#8fc2ff');
      }
      sfx.whack(power);
      this.cam.addShake(0.3 + 0.55 * power);
      this.resetCamera();
      fx.flash = 0.15 + 0.4 * power;
      fx.speedLines = { x, y, dx, dy, t: 0, power };
      const cx = x - dx * R;
      const cy = y - dy * R;
      fx.particles.sparks(cx, cy, -dx, -dy, 10 + Math.round(power * 10), 500 + power * 500, r);
      fx.particles.ring(cx, cy, 80 + power * 80, '#fffaf0');
      fx.balls.squash(0, dx, dy, 0.25 + power * 0.2);
      fx.balls.setMood(0, 'squeeze', 0.35);
      const word = power > 0.85 ? 'THWACK!!' : power > 0.5 ? 'SMACK!' : power > 0.2 ? 'bonk' : 'tap.';
      pop(word, cx - dx * 40, cy - dy * 40 - 20, { size: 34 + power * 30, color: '#fff3b0', force: true });
    });

    ev.on('phys', (e) => {
      switch (e.type) {
        case 'ballHit': {
          const s = e.speed;
          sfx.clack(s / 1600);
          const amt = Math.min(0.38, s / 2600);
          fx.balls.squash(e.a.id, e.nx, e.ny, amt);
          fx.balls.squash(e.b.id, e.nx, e.ny, amt);
          if (s > 500)
            fx.particles.sparks(e.x, e.y, -e.ny, e.nx, 3 + Math.round(s / 400), s * 0.35, r, '#fffbe0');
          if (s > 900) fx.particles.stars(e.x, e.y, 3, s * 0.18, r);
          // The break: many hits at once become one giant word.
          const t = this.now;
          this.hits.push(t);
          this.hits = this.hits.filter((h) => t - h < 0.07);
          if (!this.blammed && this.hits.length >= 4) {
            this.blammed = true;
            pop('KA-BLAMMO!!', e.x, e.y - 30, { size: 64, color: '#ff8fd0', force: true, life: 1.2 });
            this.cam.addShake(0.45);
            fx.particles.stars(e.x, e.y, 10, 380, r);
            break;
          }
          if (s > 1400)
            pop(r() < 0.5 ? BIG_BALL[Math.floor(r() * BIG_BALL.length)]! : '!!', e.x, e.y - 20, { size: 44 });
          else if (s > 700) pop(MID_BALL[Math.floor(r() * MID_BALL.length)]!, e.x, e.y - 18, { size: 32 });
          else if (s > 300 && r() < 0.35)
            pop(SMALL_BALL[Math.floor(r() * SMALL_BALL.length)]!, e.x, e.y - 14, {
              size: 24,
              color: '#ffffff',
            });
          if (e.a.kind === 'cue' || e.b.kind === 'cue') {
            if (s > 600) fx.balls.setMood(0, 'shock', 0.5);
            if (this.eng.on && !this.eng.after) {
              const c = e.a.kind === 'cue' ? e.a : e.b;
              this.eng.after = { vx: c.vx, vy: c.vy };
            }
          }
          if (s > 1100) this.cam.addShake(0.12);
          break;
        }
        case 'wallHit': {
          const s = e.speed;
          sfx.boing(s / 1500);
          // Edge -1 is a chomper's jaws, not a rail.
          if (e.edge >= 0) fx.jelly.wallHit(game.table, e.edge, e.u, s, e.nx, e.ny);
          fx.balls.squash(e.ball.id, e.nx, e.ny, Math.min(0.42, s / 2200));
          if (s > 250) fx.particles.dust(e.x, e.y, 2 + Math.round(s / 500), s * 0.15, r);
          if (s > 1300)
            pop(BIG_WALL[Math.floor(r() * BIG_WALL.length)]!, e.x + e.nx * 40, e.y + e.ny * 40, {
              size: 38,
              color: '#9ff0ff',
            });
          else if (s > 600 && r() < 0.45)
            pop(SMALL_WALL[Math.floor(r() * SMALL_WALL.length)]!, e.x + e.nx * 34, e.y + e.ny * 34, {
              size: 26,
              color: '#c8f7ff',
            });
          if (s > 1400) this.cam.addShake(0.08);
          break;
        }
        case 'pocketed': {
          const b = e.ball;
          const p = e.pocket;
          const hr = fx.holeR.get(p.vid) ?? p.r;
          fx.balls.sink(b, p.x, p.y, hr, e.vx, e.vy);
          fx.chomp.set(p.vid, 0.35);
          fx.particles.ring(p.x, p.y, 110, b.kind === 'cue' ? '#ff4d6d' : '#fff3b0');
          const lx = p.x + p.inx * 70;
          const ly = p.y + p.iny * 70;
          if (b.kind === 'cue') {
            sfx.gulp();
            fx.balls.setMood(0, 'shock', 3);
            pop('NOOOO!', lx, ly, { size: 40, color: '#ff8fa3', force: true });
          } else {
            sfx.gulp();
            if (game.hunger > 0) sfx.chomp();
            sfx.burp();
            fx.particles.confetti(p.x, p.y, 26, 300, r);
            fx.particles.stars(p.x, p.y, 5, 220, r, b.color);
            const text =
              b.num === 8
                ? EIGHT_BALL[Math.floor(r() * EIGHT_BALL.length)]!
                : GULPS[Math.floor(r() * GULPS.length)]!;
            pop(text, lx, ly, { size: b.num === 8 ? 28 : 40, color: '#b8ff8a', force: true });
            this.hud.popPip(b.num);
            this.cam.addShake(0.15);
          }
          break;
        }
        case 'spat': {
          const p = e.pocket;
          const gentle = p.trait?.kind === 'gentle';
          sfx.bleh();
          fx.chomp.set(p.vid, 0.35);
          fx.balls.squash(e.ball.id, p.inx, p.iny, 0.35);
          fx.particles.dust(e.ball.x, e.ball.y, 5, 160, r, gentle ? '#ffe7f3' : '#ffd23f');
          pop(gentle ? 'TOO FAST!' : 'BLEH!', p.x + p.inx * 70, p.y + p.iny * 70, {
            size: 30,
            color: gentle ? '#ffb3d9' : '#ffd23f',
            force: true,
          });
          if (e.ball.kind === 'cue') fx.balls.setMood(0, 'shock', 0.8);
          break;
        }
        case 'chomp': {
          const p = e.pocket;
          fx.chomp.set(p.vid, 0.35);
          if (e.ball) {
            sfx.chomp();
            pop('CHOMP!', p.x + p.inx * 70, p.y + p.iny * 70, { size: 36, color: '#ff8fa3', force: true });
            this.cam.addShake(0.15);
          } else if (r() < 0.5) {
            sfx.chomp();
          }
          break;
        }
        case 'partHit': {
          const sp = e.speed;
          if (e.kind === 'glass') sfx.glassTink();
          else sfx.boing(sp / 1700);
          fx.balls.squash(e.ball.id, e.nx, e.ny, Math.min(0.38, sp / 2400));
          if (sp > 250) fx.particles.dust(e.x, e.y, 2 + Math.round(sp / 600), sp * 0.12, r);
          if (sp > 1200)
            pop(pick(BIG_WALL, r), e.x + e.nx * 38, e.y + e.ny * 38, { size: 34, color: '#9ff0ff' });
          break;
        }
        case 'bumperHit': {
          const sp = e.speed;
          sfx.bumper(sp / 1500);
          fx.bumps.set(e.src, 0.3);
          fx.balls.squash(e.ball.id, e.nx, e.ny, Math.min(0.42, sp / 2000));
          fx.particles.ring(e.x, e.y, 70, COLORS.knob);
          if (sp > 350 && this.now - this.lastBumpPop > 0.25) {
            this.lastBumpPop = this.now;
            pop(pick(BUMPS, r), e.x + e.nx * 40, e.y + e.ny * 40, { size: 32, color: '#ffe45c' });
          }
          this.cam.addShake(Math.min(0.2, sp / 8000));
          break;
        }
        case 'glass': {
          if (e.hp <= 0) {
            sfx.glassSmash();
            pop('CRASH!', e.x, e.y - 30, { size: 42, color: '#a0ecff', force: true });
            fx.particles.shards(e.x, e.y, 16, 420, r);
            this.cam.addShake(0.25);
          } else {
            pop('crack', e.x, e.y - 24, { size: 24, color: '#a0ecff' });
          }
          break;
        }
        case 'egg': {
          const b = e.ball;
          if (e.hp <= 0) {
            sfx.splat();
            pop('SPLAT!', b.x, b.y - 36, { size: 40, color: '#ffe45c', force: true });
            fx.particles.yolk(b.x, b.y, r);
            this.cam.addShake(0.12);
          } else {
            sfx.eggCrack();
            pop('CRACK!', b.x, b.y - 32, { size: 30, color: '#fff3dc', force: true });
          }
          break;
        }
        case 'bomb': {
          sfx.boom();
          pop('BOOM!!', e.x, e.y - 40, { size: 64, color: '#ff8a1f', force: true, life: 1.2 });
          fx.particles.ring(e.x, e.y, 360, '#ffd23f', 0.5);
          fx.particles.ring(e.x, e.y, 240, '#ff4d6d', 0.4);
          fx.particles.sparks(e.x, e.y, 0, -1, 26, 900, r, '#ffb347');
          fx.particles.dust(e.x, e.y, 16, 420, r, '#555a70');
          fx.flash = 0.6;
          this.cam.addShake(0.8);
          break;
        }
        case 'boost': {
          sfx.zoom();
          fx.balls.squash(e.ball.id, e.ux, e.uy, 0.35);
          fx.particles.sparks(e.x - e.ux * R, e.y - e.uy * R, -e.ux, -e.uy, 8, 520, r, '#ffd23f');
          fx.particles.ring(e.x, e.y, 70, '#ffb347');
          if (this.now - this.lastZoomPop > 0.3) {
            this.lastZoomPop = this.now;
            pop(pick(ZOOMS, r), e.x, e.y - 40, { size: 34, color: '#ffd23f', force: true });
          }
          if (e.ball.kind === 'cue') fx.balls.setMood(0, 'shock', 0.6);
          this.cam.addShake(0.06);
          break;
        }
        case 'felt': {
          const loud = e.speed > 300 && this.now - this.lastFeltPop > 0.4;
          if (loud) this.lastFeltPop = this.now;
          if (e.felt === 'mud') {
            sfx.splat();
            fx.particles.dust(e.x, e.y, 6 + Math.round(e.speed / 200), 160, r, '#7a4b2a');
            if (loud) pop('SPLAT!', e.x, e.y - 36, { size: 30, color: '#d9a26b' });
          } else if (e.felt === 'ice') {
            sfx.shing();
            fx.particles.stars(e.x, e.y, 3, 160, r, '#e8fbff');
            if (loud) pop('WHOA!', e.x, e.y - 36, { size: 30, color: '#bff0ff' });
          } else {
            sfx.fwump();
            fx.particles.dust(e.x, e.y, 6 + Math.round(e.speed / 200), 180, r, '#e0c27a');
            if (loud) pop('fwump', e.x, e.y - 34, { size: 26, color: '#ffe7a8' });
          }
          break;
        }
        case 'warp': {
          sfx.warp();
          const ends = game.geom.portals;
          const from = ends.find((q) => q.src === e.src);
          const to = ends.find((q) => q.src === e.link);
          const cin = from ? portalColor(ends, from) : '#ff9f1c';
          const cout = to ? portalColor(ends, to) : '#4cc9f0';
          fx.particles.spawn({
            kind: 'blip',
            x: e.fromX,
            y: e.fromY,
            size: R,
            life: 0.22,
            color: e.ball.color,
            drag: 0,
          });
          fx.particles.ring(e.fromX, e.fromY, 70, cin);
          fx.particles.ring(e.x, e.y, 80, cout);
          fx.balls.grow(e.ball.id);
          pop(pick(WARPS, r), e.x, e.y - 40, { size: 30, color: cout });
          if (e.ball.kind === 'cue') fx.balls.setMood(0, 'dizzy', 0.8);
          break;
        }
        case 'swallowed': {
          sfx.glorp();
          fx.balls.swallow(e.ball, e.fromX, e.fromY, e.x, e.y, BLACKHOLE_CORE + 26, e.vx, e.vy);
          fx.particles.ring(e.x, e.y, 90, '#c77dff');
          pop(pick(GLORPS, r), e.x, e.y - 50, { size: 34, color: '#c77dff', force: true });
          if (e.ball.kind === 'cue') fx.balls.setMood(0, 'shock', 2);
          this.cam.addShake(0.12);
          break;
        }
        case 'bloop': {
          sfx.bloop();
          fx.balls.unsink(e.ball.id);
          fx.balls.grow(e.ball.id);
          fx.particles.ring(e.x, e.y, 80, '#e0c3ff');
          fx.particles.stars(e.x, e.y, 5, 200, r, '#e0c3ff');
          pop('BLOOP!', e.x, e.y - 40, { size: 32, color: '#e0c3ff', force: true });
          if (e.ball.kind === 'cue') fx.balls.setMood(0, 'dizzy', 1.2);
          break;
        }
        case 'kick':
          pop('KICK!', e.x, e.y, { size: 30, color: '#8fc2ff' });
          fx.particles.sparks(e.x, e.y, e.ball.vx, e.ball.vy, 5, 260, r, '#8fc2ff');
          break;
        case 'stopped':
          if (e.timedOut) hud.toast('THE REF CALLS TIME!', 'meh');
          break;
        default:
          break;
      }
    });

    ev.on('turnResult', (res) => {
      const k = res.potted.length;
      if (res.scratch) {
        sfx.trombone();
        hud.toast('SCRATCH! +1', 'bad');
      }
      if (k >= 2) {
        hud.toast(k === 2 ? 'DOUBLE GULP!' : k === 3 ? 'TRIPLE GULP!' : `MEGA GULP ×${k}!`, 'wow');
        sfx.ding(k + 2);
        this.combo(k);
      }
      if (res.style > 0) {
        const c = game.cue;
        this.after(0.35, () =>
          pop(`+${res.style.toLocaleString('en-US')} STYLE`, c.x, c.y - 70, {
            size: Math.min(46, 26 + k * 4),
            color: '#d6a8ff',
            force: true,
            life: 1.3,
          }),
        );
      }
      if (k > 0) {
        const title = STREAKS[Math.min(res.streak, STREAKS.length - 1)] ?? '';
        if (title && (res.streak > 1 || k === 1)) hud.toast(title, res.streak >= 3 ? 'wow' : 'good');
        sfx.ding(res.streak);
      } else if (!res.scratch && res.left > 0) {
        hud.toast(MISSES[Math.floor(r() * MISSES.length)]!, 'meh');
      }
    });

    ev.on('hunger', ({ level, prev }) => {
      if (level > prev) {
        const words = [
          '',
          'The pockets are getting peckish…',
          'The pockets are HUNGRY!',
          'The pockets are RAVENOUS!!',
        ];
        this.after(0.5, () => {
          hud.toast(words[level] ?? 'The pockets are hungry!', level >= 3 ? 'wow' : 'meh');
          sfx.growl(level);
          for (const p of game.geom.pockets) fx.chomp.set(p.vid, 0.35);
          fx.jelly.wobbleAll(r, 120 + level * 60);
        });
      } else if (level === 0 && prev > 0) {
        this.after(0.4, () => hud.toast('pockets: satisfied', 'good'));
      }
    });

    ev.on('pocketBolted', ({ vid, x, y }) => {
      this.after(0.7, () => {
        sfx.clank();
        fx.bolted.set(vid, 0);
        pop('BOLTED!', x, y - 60, { size: 36, color: '#c8d3e6', force: true });
        fx.particles.sparks(x, y, 0, -1, 10, 380, r, '#ffe45c');
        this.cam.addShake(0.2);
      });
    });

    ev.on('uncorked', ({ vid, x, y }) => {
      this.after(0.3, () => {
        sfx.cork();
        fx.chomp.set(vid, 0.35);
        pop('POP!', x, y - 50, { size: 34, color: '#ddb57a', force: true });
        fx.particles.confetti(x, y, 12, 240, r);
      });
    });

    ev.on('respawnStart', ({ fromX, fromY }) => {
      fx.balls.setMood(0, 'dizzy', 3);
      this.after(0.35, () => {
        sfx.spit();
        pop('PTOOEY!', fromX, fromY - 50, { size: 38, color: '#ffd23f', force: true });
        fx.particles.dust(fromX, fromY, 10, 260, r);
        fx.particles.ring(fromX, fromY, 90, '#ffd23f');
      });
    });

    ev.on('respawnLand', ({ x, y }) => {
      sfx.land();
      fx.balls.squash(0, 0, 1, 0.45);
      fx.particles.dust(x, y, 12, 220, r);
      fx.particles.ring(x, y, 70, '#ffffff');
      this.cam.addShake(0.22);
    });

    ev.on('dragStart', ({ vid }) => {
      const v = game.table.verts.find((q) => q.id === vid);
      if (v) this.dragLast.set(vid, { x: v.x, y: v.y, t: this.now });
      sfx.squeakStart();
      sfx.pop();
    });

    ev.on('drag', ({ vid, result, x, y }) => {
      const last = this.dragLast.get(vid) ?? { x, y, t: this.now };
      const dx = x - last.x;
      const dy = y - last.y;
      const dt = Math.max(1 / 120, this.now - last.t);
      this.dragLast.set(vid, { x, y, t: this.now });
      fx.jelly.drag(game.table, vid, dx, dy);
      sfx.squeakSet(Math.hypot(dx, dy) / dt);
      for (const pb of result.pushed) {
        const l = Math.hypot(pb.dx, pb.dy);
        if (l > 0.5) {
          fx.balls.squash(pb.id, pb.dx / l, pb.dy / l, Math.min(0.3, 0.05 + l * 0.02));
          const b = game.balls.find((q) => q.id === pb.id);
          if (b && r() < 0.3) fx.particles.dust(b.x - (pb.dx / l) * R, b.y - (pb.dy / l) * R, 1, 60, r);
        }
      }
    });

    ev.on('dragEnd', ({ vid }) => {
      sfx.squeakStop();
      const last = this.dragLast.get(vid);
      if (last) fx.jelly.kickVertex(vid, (r() - 0.5) * 120, (r() - 0.5) * 120);
      this.dragLast.delete(vid);
    });

    ev.on('blocked', ({ vid, reason, x, y }) => {
      if (!fx.nope.has(vid)) {
        fx.nope.set(vid, 0.35);
        sfx.nope();
      }
      if (this.now - this.lastBlockPop > 0.9) {
        this.lastBlockPop = this.now;
        pop(BLOCKED[reason] ?? 'NOPE!', x, y - 40, { size: 28, color: '#ff8fa3', force: true });
      }
    });

    ev.on('bendRemoved', ({ x, y }) => {
      sfx.sproing();
      pop('boop', x, y - 30, { size: 26, color: '#ffffff', force: true });
      fx.particles.dust(x, y, 8, 200, r);
    });

    ev.on('undo', () => {
      sfx.sproing();
      fx.jelly.wobbleAll(r, 300);
      hud.toast('UN-BENT!', 'good');
      for (const b of game.balls) if (b.active) fx.balls.squash(b.id, 0, 1, 0.2);
    });

    ev.on('redo', () => {
      sfx.sproing();
      fx.jelly.wobbleAll(r, 220);
      hud.toast('RE-BENT!', 'good');
    });

    ev.on('reset', () => {
      sfx.sproing();
      fx.jelly.wobbleAll(r, 380);
      hud.toast('BACK TO THE START', 'meh');
      for (const b of game.balls) if (b.active) fx.balls.squash(b.id, 0, 1, 0.25);
    });

    ev.on('partGrab', ({ turn }) => {
      sfx.pop();
      if (!turn) sfx.squeakStart();
    });

    ev.on('partMove', ({ result }) => {
      sfx.squeakSet(result.applied * 60);
      for (const pb of result.pushed) {
        const l = Math.hypot(pb.dx, pb.dy);
        if (l > 0.5) fx.balls.squash(pb.id, pb.dx / l, pb.dy / l, Math.min(0.3, 0.05 + l * 0.02));
      }
    });

    ev.on('partTurn', ({ steps }) => {
      if (this.now - this.lastDialTick > 0.04) {
        this.lastDialTick = this.now;
        sfx.tick(8 + steps * 2);
      }
    });

    ev.on('partDrop', ({ stowed, x, y }) => {
      sfx.squeakStop();
      if (stowed) {
        sfx.pop();
        pop('BACK IN THE BOX', x, y - 40, { size: 26, color: '#ffe45c', force: true });
        fx.particles.dust(x, y, 6, 160, r);
      }
    });

    ev.on('partPlaced', ({ x, y, pushed }) => {
      sfx.thunk();
      fx.particles.dust(x, y, 10, 220, r);
      fx.particles.ring(x, y, 80, '#fff3b0');
      pop(pick(PLONKS, r), x, y - 46, { size: 30, color: '#fff3b0', force: true });
      this.cam.addShake(0.06);
      for (const pb of pushed) {
        const l = Math.hypot(pb.dx, pb.dy);
        if (l > 0.5) fx.balls.squash(pb.id, pb.dx / l, pb.dy / l, Math.min(0.35, 0.1 + l * 0.02));
      }
    });

    ev.on('partBlocked', ({ reason, x, y }) => {
      if (this.now - this.lastBlockPop > 0.9) {
        this.lastBlockPop = this.now;
        sfx.nope();
        pop(BLOCKED[reason] ?? 'NOPE!', x, y - 40, { size: 28, color: '#ff8fa3', force: true });
      }
    });

    ev.on('tokenSpent', ({ left, x, y }) => {
      sfx.coin();
      pop(left === 0 ? 'LAST GRAB!' : '-1 GRAB', x, y - 56, { size: 26, color: '#ffd23f', force: true });
    });

    ev.on('poke', ({ x, y }) => {
      sfx.poke();
      fx.ripples.push({ x, y, t: 0 });
      // Every rail wobbles a bit, the closest ones more.
      for (const v of game.table.verts) {
        const d = Math.hypot(v.x - x, v.y - y);
        const k = 90 * Math.exp(-d / 260);
        fx.jelly.kickVertex(v.id, ((v.x - x) / (d || 1)) * k, ((v.y - y) / (d || 1)) * k);
        fx.jelly.kickBulge(v.id, -k * 0.6);
      }
      if (r() < 0.3) pop(r() < 0.5 ? 'boop' : 'hey!', x, y - 26, { size: 22, color: '#ffffff' });
    });

    ev.on('slowmo', ({ on }) => {
      fx.vignetteTarget = on ? 1 : 0;
      sfx.setSlowmo(on);
      if (on) {
        const b = game.balls.find((q) => q.kind === 'object' && q.active);
        if (b) pop('ooooOOOH…', b.x, b.y - 50, { size: 34, color: '#e0c3ff', force: true, life: 1.6 });
      }
    });
  }

  /**
   * Bigger combos, bigger parties: three balls throw confetti out of every pocket, four set off
   * fireworks, five or more crown the player.
   */
  private combo(k: number): void {
    const fx = this.fx;
    const r = fx.rand;
    if (k >= 3) {
      for (const p of this.game.geom.pockets) {
        if (!p.open) continue;
        fx.particles.confetti(p.x, p.y, 18, 340, r);
        fx.particles.stars(p.x, p.y, 3, 220, r);
      }
      this.cam.addShake(0.2);
    }
    if (k >= 4) fx.fireworks = Math.max(fx.fireworks, 2.2);
    if (k >= 5) {
      this.hud.showBanner('TABLE WIZARD!', 'smack');
      fx.confettiRain = Math.max(fx.confettiRain, 2.5);
      this.sfx.fanfare();
    }
  }

  private resetCamera(): void {
    this.cam.zoomTarget = 1;
    this.cam.focusTargetX = TABLE_W / 2;
    this.cam.focusTargetY = TABLE_H / 2;
  }

  private after(t: number, fn: () => void): void {
    this.later.push({ t: this.now + t, fn });
  }

  /** Continuous effects. dtReal is wall-clock seconds. */
  update(dtReal: number): void {
    const g = this.game;
    const fx = this.fx;
    const r = fx.rand;
    this.now += dtReal;
    if (this.later.length) {
      const due = this.later.filter((l) => l.t <= this.now);
      this.later = this.later.filter((l) => l.t > this.now);
      for (const l of due) l.fn();
    }
    if (g.phase === 'plan' && g.charging) {
      const p = g.power;
      this.sfx.strainSet(p);
      const c = g.cue;
      this.cam.zoomTarget = 1 + 0.07 * p;
      this.cam.focusTargetX = TABLE_W / 2 + (c.x - TABLE_W / 2) * 0.4 * p;
      this.cam.focusTargetY = TABLE_H / 2 + (c.y - TABLE_H / 2) * 0.4 * p;
      if (p > 0.6) {
        this.sweatT -= dtReal * (p * 10);
        if (this.sweatT <= 0) {
          this.sweatT = 1;
          fx.particles.sweat(c.x + (r() - 0.5) * R, c.y - R * 0.8, r);
        }
      }
      if (p >= 1 && !this.maxPopped) {
        this.maxPopped = true;
        fx.pops.add('MAX!', c.x, c.y - 60, r, { size: 36, color: '#ff4d6d', force: true });
        this.sfx.ding(5);
      }
    }
    if (g.phase === 'sim' && this.eng.on) this.watchEnglish(dtReal);
    if (g.phase === 'sim' && !this.bawked) {
      // The chicken panics the moment it starts running.
      const chick = g.balls.find((b, i) => b.variant === 'chicken' && b.active && g.world.running[i]);
      if (chick) {
        this.bawked = true;
        this.sfx.bawk();
        fx.pops.add('BAWK!', chick.x, chick.y - 40, r, { size: 32, color: '#ffe45c', force: true });
        fx.particles.feathers(chick.x, chick.y, r);
      }
    }
    if (g.phase === 'sim') {
      const cue = g.cue;
      if (cue.active && cue.braking && !this.cueWasBraking) {
        this.cueWasBraking = true;
        fx.balls.setMood(0, 'dizzy', 1.6);
      }
      if (cue.active && cue.braking && Math.hypot(cue.vx, cue.vy) > 60) {
        this.skidT -= dtReal;
        if (this.skidT <= 0) {
          this.skidT = 0.05;
          const s = Math.hypot(cue.vx, cue.vy);
          fx.particles.dust(cue.x - (cue.vx / s) * R, cue.y - (cue.vy / s) * R, 1, 40, r, '#e8fff4');
        }
      }
    }
    if (g.hunger >= 3 && g.phase !== 'title' && g.phase !== 'over') {
      this.droolT -= dtReal;
      if (this.droolT <= 0) {
        this.droolT = 0.5 + r() * 0.7;
        const open = g.geom.pockets.filter((p) => p.open);
        const p = open[Math.floor(r() * open.length)];
        if (p) fx.particles.drool(p.x + p.inx * p.r * 0.6, p.y + p.iny * p.r * 0.6, r);
      }
    }
    void COLORS;
  }

  /** Cartoon commentary on English: bends, screw-backs, follow-throughs, spin-dizzy eyes. */
  private watchEnglish(dtReal: number): void {
    const cue = this.game.cue;
    const fx = this.fx;
    const r = fx.rand;
    const e = this.eng;
    if (!cue.active) return;
    const sp = Math.hypot(cue.vx, cue.vy);
    const slip = Math.hypot(cue.sx, cue.sy);
    if (slip > 600 || Math.abs(cue.wz) > 800) fx.balls.setMood(0, 'dizzy', 0.3);
    if (slip > 150 && sp > 60) {
      e.swirlT -= dtReal;
      if (e.swirlT <= 0) {
        e.swirlT = 0.04;
        fx.particles.dust(cue.x - (cue.vx / sp) * R, cue.y - (cue.vy / sp) * R, 1, 50, r, '#b9d9ff');
      }
    }
    if (!e.after) {
      // Still on the way to the first contact: has side English bent the path?
      if (!e.banana && sp > 80 && (cue.vx * e.dx + cue.vy * e.dy) / sp < Math.cos((12 * Math.PI) / 180)) {
        e.banana = true;
        fx.pops.add('BANANA!', cue.x, cue.y - 40, r, { size: 34, color: '#ffe45c', force: true });
        this.sfx.sproing();
      }
      return;
    }
    const along = cue.vx * e.dx + cue.vy * e.dy;
    if (!e.screw && along < -80) {
      e.screw = true;
      fx.pops.add('SCREW BACK!', cue.x, cue.y - 40, r, { size: 36, color: '#8fc2ff', force: true });
      this.sfx.sproing();
    } else if (!e.whee && along > 80 && sp > Math.hypot(e.after.vx, e.after.vy) + 120) {
      e.whee = true;
      fx.pops.add('WHEEE!', cue.x, cue.y - 40, r, { size: 36, color: '#b8ff8a', force: true });
      this.sfx.sproing();
    }
  }

  /** Where the cue ball's eyes should look. */
  lookTarget(pointer: { x: number; y: number } | null): { x: number; y: number } | null {
    const g = this.game;
    const c = g.cue;
    if (g.phase === 'spin') {
      const a = g.aim + Math.PI;
      return { x: c.x + Math.cos(a) * 200, y: c.y + Math.sin(a) * 200 };
    }
    if (g.phase === 'plan') {
      if (!g.charging && pointer) return pointer;
      return { x: c.x + Math.cos(g.aim) * 200, y: c.y + Math.sin(g.aim) * 200 };
    }
    return pointer;
  }
}
