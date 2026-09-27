# Gravitas: a cinematic gravity engine

Gravitas makes short, vertical, share-ready clips of gravity at its most dramatic: three-body chaos, periodic choreographies, black-hole mergers, stars torn apart by black holes, and galaxy collisions. Each scene is a real simulation, and each clip ends when the system *resolves* (a star is exiled, two black holes merge, a galaxy is born).

The physics is accurate. The look is the point: HDR light, bloom, gravitational lensing, Doppler-beamed accretion disks, light-painting trails, hundreds of thousands of GPU particles, slow-motion at the key moments, and burned-in captions.

```
npm install
npm run dev        # open http://localhost:5173
```

Pick a scene, press **Export MP4**, and get a frame-perfect 1080×1920 / 60 fps video ready for Reels, TikTok or Shorts.

---

## Scenes

| Scene | What happens | How it resolves |
| --- | --- | --- |
| **The Pythagorean Problem** (`pythagorean`) | Burrau's 1913 puzzle: masses 3, 4, 5 on a 3-4-5 triangle, released from rest | After ~60 time units of chaos the lightest star is ejected and the other two lock into a binary (the known result, reproduced to the published ejection time) |
| **The Figure-Eight** (`figure-eight`) | Three equal suns sharing one orbit, lighting a dust nebula | Never: it is stable, the perfect loop |
| **Perfect Balance** (`lagrange`) | Lagrange's spinning equilateral triangle, one star nudged by 10⁻⁶ | The symmetry shatters after ~4 turns; one star is thrown out |
| **The Butterfly Effect** (`butterfly-effect`) | 48 copies of the Pythagorean system differing by one part in a billion, overlaid in a rainbow (they add up to white) | The white trail splits into 48 colours: 48 different fates |
| **Random Chaos** (`chaos`, seeded) | Random masses and positions, re-rolled until the system resolves within the clip | An ejection or a stellar collision (with debris) |
| **Butterfly / Moth / Dragonfly / Yin-Yang / Goggles** | Šuvakov–Dmitrašinović (2013) periodic orbits drawn as long-exposure light paintings | They repeat exactly |
| **Anatomy of a Black Hole** (`black-hole`) | A Gargantua-style accretion disk: the far side of the disk is lensed over the shadow, one side is Doppler-boosted | A slow push-in beauty shot |
| **Two Black Holes Collide** (`bh-merger`) | Two black holes with their own disks spiral in, radiating gravitational waves (visible as a spiral ripple in spacetime that chirps faster and faster) | Merger flash, gravitational-wave burst, recoil kick |
| **Spaghettification** (`tde`) | A star on a parabolic orbit is tidally stretched and ripped into a stream | Half the debris falls back into a glowing ring; the rest is flung away |
| **Three Become One** (`bh-triple`, seeded) | A third black hole crashes into a binary | Two successive mergers leave one survivor |
| **When Galaxies Collide** (`galaxies`) | Two spirals (~440k stars) pass each other, throwing out tidal tails | The cores sink together and merge; a quasar ignites |

Seeded scenes take `?seed=N` (or the dice button) and give a new, still-resolving system each time.

## Making clips

### In the browser (no install beyond `npm run dev`)

Press **Export MP4** (or `E`). The scene restarts and is rendered **frame by frame** at the chosen resolution, so the result is perfectly smooth even if your GPU can't run it in real time. The file downloads when it finishes.

* Resolutions: 1080×1920 (default), a faster ⅔ draft, or 2× (4K-class).
* 60 or 30 fps; the whole story (auto length) or a fixed 15/30/45/60 s cut.
* Uses H.264 when the browser can encode it (Chrome, Edge, Safari), otherwise HEVC/VP9/AV1 in MP4.
* Captions are burned in; untick "Burn in captions" for a clean plate.

### From the command line (batch, highest quality)

```
npx playwright install chromium      # once (or use --channel chrome)
npm run render -- --scene pythagorean
npm run render -- --scene all --aspect 9:16 --fps 60
npm run render -- --scene chaos --seed 1234 --handle @yourpage
npm run render -- --list
```

This drives the engine in headless Chromium and pipes lossless PNG frames into **ffmpeg** (x264, CRF 16, BT.709, `+faststart`). You need `ffmpeg` on your `PATH` (or `FFMPEG_PATH`). Useful flags:

| Flag | Meaning |
| --- | --- |
| `--aspect 9:16\|1:1\|4:5\|16:9` | Frame preset (1080×1920, 1080×1080, 1080×1350, 1920×1080) |
| `--scale 2` / `--scale 0.5` | 4K-class output / quick drafts |
| `--duration 30` | Cap the clip length |
| `--no-captions` | Clean plate |
| `--handle @name` | Small watermark line at the bottom |
| `--channel chrome --headed` | Use your installed Chrome with its GPU (much faster than headless software rendering) |
| `--particles 0.4` | Fewer particles (brightness is compensated), useful on weak GPUs |

Output lands in `renders/`.

## Controls

| Input | Action |
| --- | --- |
| Drag / wheel / double-click | Orbit / zoom / reset the camera |
| `Space` | Pause |
| `R` | Restart |
| `←` `→` | Previous / next scene |
| `G` | Scene gallery |
| `N` | New random seed (seeded scenes) |
| `C` | Toggle captions |
| `E` | Export MP4 |
| `H` | Hide the interface (double-click to bring it back) |

The interface also fades out after a few idle seconds, so screen recording works too.

URL parameters: `scene`, `seed`, `aspect` (`9:16`, `1:1`, `4:5`, `16:9`), `captions=0`, `handle=@you`, `particles=0.5` (lighter GPU load), `preview=1200` (live-preview resolution), `cube=512` (sky texture size).

## How it works

```
src/
  physics/   dopri5.ts      adaptive Dormand–Prince 5(4) integrator (double precision)
             world.ts       N-body world: softening, collisions → mergers, ejection
                            detection, periapsis events, GW radiation reaction,
                            dynamical friction
  engine/    runtime.ts     a live scene: physics + director + camera + effects
             director.ts    pacing: sim-time per real second, automatic slow motion
             camera.ts      auto-framing, orbiting, shake, user orbit/zoom
             vfx.ts         flashes, flare rings, shockwaves, gravitational waves
             overlay.ts     titles, captions and labels (burned into the video)
  render/    renderer.ts    frame graph (all passes in linear HDR)
             sky.ts         procedural nebula cubemap + star catalogue
             lensing.ts     exact Schwarzschild deflection table
             particles.ts   GPGPU tracer particles (ping-pong float textures)
             trails.ts      ribbon trails from ring buffers in a float texture
             bodies.ts      stars, flashes, diffraction spikes
             post.ts        bloom mip chain, distortion, AgX tone mapping, grain
  scenes/    threebody.ts, blackholes.ts, galaxies.ts, orbits.ts, helpers.ts
  export/    recorder.ts    deterministic frame stepping + WebCodecs MP4 (Mediabunny)
scripts/     render.mjs     CLI batch renderer (Playwright + ffmpeg)
             verify-physics.ts  numerical checks (npm test)
```

**Physics.** Massive bodies are integrated in double precision with an adaptive Dormand–Prince 5(4) method (tolerances down to 1e-13). Every accepted step feeds the trails, so hairpin close encounters are sampled densely. Black-hole pairs lose energy through a drag term matched to Peters' quadrupole formula, which gives a real chirp. Mergers keep momentum, radiate a few percent of the mass and can add a recoil kick. `npm test` checks the published results: the figure-eight returns to its start after one period (error ~1e-11), the Šuvakov–Dmitrašinović orbits close, the Pythagorean problem ejects the mass-3 star at t≈59.7, and the inspiral time matches Peters' estimate to about 1%.

**Particles.** Massless tracers (dust, accretion disks, stellar debris, galaxy stars, jets, sparks) live entirely on the GPU. Each frame a fragment shader integrates every particle with kick-drift-kick leapfrog. Sub-steps are adaptive per particle, limited by the local dynamical time, so close passes don't produce numerical slingshots. Body positions are Hermite-interpolated across the frame. Black holes use a Paczyński–Wiita potential, so disks get a real inner edge (ISCO) and plunging gas. Disk colour comes from a temperature profile, relativistic Doppler beaming and gravitational redshift.

**Lensing.** The sky is lensed per pixel using the exact Schwarzschild deflection angle, integrated numerically and tabulated from the photon sphere to the weak-field limit. Everything else (stars, trails, particles) is lensed per vertex with the thin-lens equation, drawing both the primary and the secondary image. That is why the far side of an accretion disk arcs over the black hole, and why a star passing behind one flares into an Einstein ring.

**Look.** Everything renders into a half-float HDR buffer, then goes through a 13-tap / tent-filter bloom pyramid, optional screen-space distortion (shockwaves; the quadrupolar spiral of gravitational waves), AgX tone mapping with a punchy look, vignette, subtle chromatic aberration, film grain and dithering. Particles are energy-conserving, motion-blurred capsules (sub-pixel particles get dimmer instead of flickering). Trails are centripetal Catmull–Rom ribbons with a white-hot core.

**Pacing.** The director converts real time into simulation time. It caps how fast anything may cross the frame, so close encounters automatically drop into slow motion, and it adds bullet-time dips on events. The camera frames the tracked bodies with critically damped springs and a short "memory" of the largest recent radius, so periodic motion doesn't pump the zoom.

## Adding a scene

```ts
// src/scenes/myscene.ts
import { PALETTE } from '../core/color.ts';
import { World } from '../physics/world.ts';
import { embers } from './helpers.ts';
import type { SceneDef } from './types.ts';

export const binaryStar: SceneDef = {
  id: 'binary',
  title: 'A Binary Star',
  subtitle: 'Two suns',
  blurb: 'Two stars on elliptical orbits.',
  category: 'Three-Body',
  build: () => {
    const w = new World({ collisions: true });
    const trail = { fade: 4, maxAge: 12, width: 0.015, intensity: 1.4, core: 0.6 };
    w.add({ name: 'A', kind: 'star', m: 1, x: [-0.5, 0, 0], v: [0, -0.5, 0], radius: 0.04, color: PALETTE.cyan, trail, spikes: 0.8 });
    w.add({ name: 'B', kind: 'star', m: 1, x: [0.5, 0, 0], v: [0, 0.5, 0], radius: 0.04, color: PALETTE.gold, trail, spikes: 0.8 });
    return {
      worlds: [w],
      duration: 20,
      particles: embers(w, { count: 5000, life: 1.5, speed: 0.05, size: 0.004 }),
      camera: { elevation: 40 },
      director: { baseRate: 1.5 },
      captions: [{ at: 0.5, text: 'A Binary Star', sub: 'two suns, one orbit', duration: 5, kind: 'title' }],
    };
  },
};
```

Then add it to `SCENES` in `src/scenes/index.ts`. Hooks: `onEvent(ev, rt)` (merge / eject / periapsis), `onFrame(rt, dt)`, and `rt.resolve()` to start the outro. Particle recipes live in `helpers.ts` (`embers`, `sparks`, `diskInit`, `accretionDisk`).

## Requirements

* A browser with WebGL2 and `EXT_color_buffer_float`. That covers every current desktop browser and most phones.
* Export needs WebCodecs (Chrome/Edge 94+, Safari 17+, Firefox 130+).
* Node 22+ for the dev server, `npm test` and the CLI.
