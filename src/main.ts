import './ui/style.css';
import { Sfx } from './audio/sfx';
import { createRng, randomSeed } from './core/rng';
import { installDebugApi } from './debug/api';
import { Director } from './fx/director';
import { Fx } from './fx/fx';
import { Autopilot } from './game/demo';
import { Game } from './game/game';
import { FREE_RULES } from './game/ruleset';
import { fullTray } from './game/toys';
import { Input } from './input/input';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { RAIL_W, TABLE_H, TABLE_W } from './config';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
const demo = params.get('demo') === '1';
// Until the remix and the Toy Box hand out toys: one of every toy in the tray, with ?toys=1 (or
// in a playtest build, made with VITE_TOYS=1).
const toys = params.get('toys') === '1' || (import.meta.env.VITE_TOYS === '1' && params.get('toys') !== '0');

const canvas = document.getElementById('world') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const game = new Game({ seed, persist: !demo, rules: FREE_RULES, tray: toys ? fullTray() : undefined });
const cam = new Camera();
const fx = new Fx(createRng(seed ?? randomSeed()).next);
const sfx = new Sfx();
if (params.get('mute') === '1') sfx.muted = true;

const gesture = () => sfx.unlock();
const toggleMute = (): boolean => {
  sfx.setMuted(!sfx.muted);
  return sfx.muted;
};
const hud = new Hud(hudRoot, game, {
  start: () => game.start(),
  restart: () => game.restart(),
  toggleMute,
  isMuted: () => sfx.muted,
  gesture,
  press: () => sfx.pop(),
  ouch: () => {
    sfx.poke();
    fx.balls.setMood(0, 'squeeze', 0.8);
    fx.pops.add('OW!', game.cue.x, game.cue.y - 50, fx.rand, { size: 30, color: '#ff8fa3', force: true });
  },
  beginPlace: (item, e) => input.beginPlace(item, e),
});
const input: Input = new Input(canvas, cam, game, {
  gesture,
  toggleMute: () => {
    toggleMute();
    hud.refreshMute();
  },
  overTray: (cx, cy) => hud.tray.contains(cx, cy),
});
const renderer = new Renderer(canvas, game, fx, cam, () => input.view());
game.events.on('dragStart', () => input.endTutorial());
const director = new Director(game, fx, sfx, cam, hud);
const autopilot = demo ? new Autopilot(game, createRng((seed ?? randomSeed()) ^ 0x5eed)) : null;
fx.reset(game);

// Canvas text only uses a web font once it has loaded, so ask for both up front.
void document.fonts?.load('32px Bangers');
void document.fonts?.load('700 20px Fredoka');

const resize = () => {
  // On tall screens there is height to spare: keep the table clear of the HUD bars. (On wide
  // screens height is what limits the table, so it keeps all of it.) A toy tray down the left side
  // always gets its own room.
  hud.update();
  const tall = window.innerHeight > window.innerWidth * 1.15;
  const bands = hud.bands();
  cam.padTop = tall ? bands.top + 4 : 0;
  cam.padBottom = tall ? bands.bottom + 4 : 0;
  cam.padLeft = bands.left > 0 ? bands.left + 4 : 0;
  cam.padRight = 0;
  renderer.resize();
  const c = bands.cluster;
  if (!tall && c.width > 0) {
    // Keep the bottom-right pocket out from under the shoot controls, sliding the table left
    // into spare width (and only shrinking it if there is none).
    const corner = cam.homeToScreen(TABLE_W + RAIL_W + 10, TABLE_H + RAIL_W + 10);
    const over = corner.x - c.left;
    if (over > 0 && corner.y > c.top) {
      cam.padRight = 2 * over + 8;
      renderer.resize();
    }
  }
};
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);
// A new game may bring a tray (or take one away): make room once the HUD has caught up.
game.events.on('newGame', () => requestAnimationFrame(resize));
resize();

let manual = false;
function step(dt: number): void {
  fx.down = cam.screenToWorldDir(0, 1);
  game.update(dt);
  autopilot?.update(dt);
  director.update(dt);
  fx.update(dt, game, director.lookTarget(input.pointer));
  cam.update(dt, fx.rand);
  hud.update();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!manual) step(dt);
  renderer.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

installDebugApi({
  game,
  cam,
  extras: { sfx, fx },
  step,
  draw: () => renderer.draw(),
  setManual: (on) => {
    manual = on;
  },
});
