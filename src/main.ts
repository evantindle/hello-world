import './ui/style.css';
import { Sfx } from './audio/sfx';
import { createRng, randomSeed } from './core/rng';
import { installDebugApi } from './debug/api';
import { Director } from './fx/director';
import { Fx } from './fx/fx';
import { Autopilot } from './game/demo';
import { Game, type GameSetup } from './game/game';
import { levelById } from './game/levels/rec-room';
import { setupFromLevel } from './game/levels/setup';
import { FREE_RULES, TOYBOX_RULES } from './game/ruleset';
import {
  codeFromHash,
  decodeShot,
  encodeShot,
  replaySourceOf,
  sharedFromRecord,
  shareUrl,
} from './game/share';
import { forToyBox, fullTray, toyBoxTray } from './game/toys';
import { loadBest } from './game/rules';
import { Input } from './input/input';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { RAIL_W, TABLE_H, TABLE_W } from './config';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : undefined;
const demo = params.get('demo') === '1';
// For testing: Free Play with one of every toy in the tray, with ?toys=1 (or in a build made with
// VITE_TOYS=1). The remix and the Toy Box hand out toys on their own.
const toys = params.get('toys') === '1' || (import.meta.env.VITE_TOYS === '1' && params.get('toys') !== '0');

const canvas = document.getElementById('world') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

// Free Play deals a remixed table every game (?remix=0 for the plain one); a new player's very
// first game is the plain table.
const remix = params.get('remix') !== '0';
const game = new Game({
  seed,
  persist: !demo,
  rules: FREE_RULES,
  tray: toys ? fullTray() : undefined,
  remix,
  remixLevel: loadBest() === null ? 0 : undefined,
});
const cam = new Camera();
// Players who ask for less motion get a gentler shake.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) cam.shakeScale = 0.3;
const fx = new Fx(createRng(seed ?? randomSeed()).next);
const sfx = new Sfx();
if (params.get('mute') === '1') sfx.muted = true;

const gesture = () => sfx.unlock();
const toggleMute = (): boolean => {
  sfx.setMuted(!sfx.muted);
  return sfx.muted;
};
const freeSetup = (): GameSetup => ({
  rules: FREE_RULES,
  seed: randomSeed(),
  tray: toys ? fullTray() : undefined,
  remix,
  remixLevel: loadBest() === null ? 0 : undefined,
});
const toyBoxSetup = (): GameSetup => ({
  rules: TOYBOX_RULES,
  seed: randomSeed(),
  tray: toyBoxTray(),
  name: 'TOY BOX',
});
// A shared shot's link stays in the address bar only while it is being watched.
const forgetLink = () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
};
const hud = new Hud(hudRoot, game, {
  freePlay: () => {
    // The game dealt at boot waits on the title screen; after that, every Free Play is a new deal.
    if (game.phase === 'title' && game.rules.mode === 'free' && game.shots === 0 && !game.lastOver)
      game.start();
    else game.load(freeSetup());
  },
  prepareLevel: (def) => game.prepare(setupFromLevel(def)),
  start: () => game.start(),
  restart: () => game.restart(),
  quit: () => game.quit(),
  screenTurn: () => (cam.rotated ? Math.PI / 2 : 0),
  dev: params.get('dev') === '1',
  toyBox: () => game.load(toyBoxSetup()),
  watch: (s) => game.watch(replaySourceOf(s), s.name ?? undefined),
  playShared: (s) => {
    forgetLink();
    const table = { ...s.pre.table, parts: forToyBox(s.pre.table.parts) };
    game.load({ ...toyBoxSetup(), table, balls: s.pre.balls, name: s.name ?? 'TOY BOX' });
  },
  leaveViewer: forgetLink,
  shareLink: async () => {
    const rec = game.history[game.history.length - 1];
    if (!rec) return null;
    const code = await encodeShot(sharedFromRecord(rec, game.rules.mode, game.tableName));
    return shareUrl(code, location);
  },
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
// ?level=rr-03: straight to that level's intro card.
const startLevel = levelById(params.get('level') ?? '');
if (startLevel) hud.openLevel(startLevel);
// #s=...: someone shared a shot.
const openLink = async (): Promise<boolean> => {
  const code = codeFromHash(location.hash);
  if (!code) return false;
  const shot = await decodeShot(code);
  if (shot) hud.openViewer(shot);
  else {
    forgetLink();
    hud.toast('THAT LINK IS BROKEN', 'bad');
  }
  return shot !== null;
};
void openLink();
window.addEventListener('hashchange', () => void openLink());
const input: Input = new Input(canvas, cam, game, {
  gesture,
  toggleMute: () => {
    toggleMute();
    hud.refreshMute();
  },
  overTray: (cx, cy) => hud.tray.contains(cx, cy),
  closeBox: () => hud.closeBox(),
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
  // The viewer's panel gets room on any screen (there is nothing to do but watch).
  cam.padBottom = tall || game.rules.mode === 'viewer' ? bands.bottom + 4 : 0;
  cam.padLeft = bands.left > 0 ? bands.left + 4 : 0;
  cam.padRight = 0;
  renderer.resize();
  if (!tall) {
    // A table that reaches up past the usual top rail (some levels and remixes) must not slide
    // under the top bar: give it just enough room.
    let top = Infinity;
    for (const v of game.table.verts) top = Math.min(top, v.y);
    const clear = () => cam.homeToScreen(TABLE_W / 2, top - RAIL_W).y >= bands.mid + 4;
    for (let p = 8; p <= 240 && !clear(); p += 8) {
      cam.padTop = p;
      renderer.resize();
    }
  }
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
  openLevel: (id) => {
    const def = levelById(id);
    if (def) hud.openLevel(def);
    return !!def;
  },
  shareLink: async () => {
    const rec = game.history[game.history.length - 1];
    if (!rec) return null;
    return shareUrl(await encodeShot(sharedFromRecord(rec, game.rules.mode, game.tableName)), location);
  },
  toyBox: () => game.load(toyBoxSetup()),
});
