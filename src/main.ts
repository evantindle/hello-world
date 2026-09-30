import './ui/style.css';
import { Sfx } from './audio/sfx';
import { createRng, randomSeed } from './core/rng';
import { installDebugApi } from './debug/api';
import { Director } from './fx/director';
import { Fx } from './fx/fx';
import { Autopilot } from './game/demo';
import { Game } from './game/game';
import { Input } from './input/input';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
const demo = params.get('demo') === '1';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const game = new Game({ seed, persist: !demo });
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
});
const input = new Input(canvas, cam, game, {
  gesture,
  toggleMute: () => {
    toggleMute();
    hud.refreshMute();
  },
});
const renderer = new Renderer(canvas, game, fx, cam, () => input.view());
game.events.on('dragStart', () => input.endTutorial());
const director = new Director(game, fx, sfx, cam, hud);
const autopilot = demo ? new Autopilot(game, createRng((seed ?? randomSeed()) ^ 0x5eed)) : null;
fx.reset(game);

// Canvas text only uses a web font once it has loaded, so ask for both up front.
void document.fonts?.load('32px Bangers');
void document.fonts?.load('700 20px Fredoka');

const resize = () => renderer.resize();
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);
resize();

let manual = false;
function step(dt: number): void {
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
