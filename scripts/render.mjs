#!/usr/bin/env node
// Batch renderer: drives the engine in a (headless) Chromium, steps every frame deterministically
// and pipes lossless PNG frames into ffmpeg (x264) — perfectly smooth clips regardless of GPU speed.
//
//   npm run render -- --scene pythagorean
//   npm run render -- --scene all --aspect 9:16 --fps 60
//   npm run render -- --scene chaos --seed 42 --duration 30 --handle @myspacepage
//
// Requires ffmpeg on PATH (or FFMPEG_PATH) and a Playwright browser
// (`npx playwright install chromium`, or pass --channel chrome to use installed Chrome).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ASPECTS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };

function parseArgs(argv) {
  const o = { scene: 'pythagorean', seed: 1, aspect: '9:16', fps: 60, out: 'renders', captions: true, crf: 16, preset: 'slow', headed: false, channel: undefined, jpeg: false, scale: 1, handle: '', cube: 1024 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--scene': o.scene = next(); break;
      case '--seed': o.seed = Number(next()); break;
      case '--aspect': o.aspect = next(); break;
      case '--width': o.width = Number(next()); break;
      case '--height': o.height = Number(next()); break;
      case '--scale': o.scale = Number(next()); break;
      case '--fps': o.fps = Number(next()); break;
      case '--duration': o.duration = Number(next()); break;
      case '--out': o.out = next(); break;
      case '--no-captions': o.captions = false; break;
      case '--handle': o.handle = next(); break;
      case '--crf': o.crf = Number(next()); break;
      case '--preset': o.preset = next(); break;
      case '--headed': o.headed = true; break;
      case '--channel': o.channel = next(); break;
      case '--executable': o.executable = next(); break;
      case '--jpeg': o.jpeg = true; break;
      case '--cube': o.cube = Number(next()); break;
      case '--particles': o.particles = Number(next()); break;
      case '--list': o.list = true; break;
      case '-h':
      case '--help': o.help = true; break;
      default:
        console.error(`Unknown option ${a}`);
        process.exit(2);
    }
  }
  return o;
}

const HELP = `Usage: npm run render -- [options]
  --scene <id|all|a,b,c>   scene(s) to render (default pythagorean; --list to see ids)
  --seed <n>               seed for seeded scenes (default 1)
  --aspect 9:16|1:1|4:5|16:9   frame preset (default 9:16, 1080x1920)
  --width/--height <px>    explicit size (overrides aspect)
  --scale <f>              multiply the preset size (e.g. 2 for 4K-ish, 0.5 for drafts)
  --fps <n>                frames per second (default 60)
  --duration <s>           cap the clip length (default: the scene's own ending)
  --no-captions            clean plate without text
  --handle <text>          watermark line at the bottom (e.g. @yourpage)
  --crf <n> --preset <p>   x264 quality (default 16 / slow)
  --out <dir>              output directory (default renders/)
  --channel chrome|msedge  use an installed browser (GPU + faster), --headed to show it
  --executable <path>      explicit Chromium/Chrome binary (or CHROME_PATH)
  --jpeg                   faster frame transfer (slightly lossy)
  --particles <f>          particle-count multiplier (e.g. 0.4 for quick drafts)`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');

  const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const addr = server.httpServer.address();
  const base = `http://127.0.0.1:${addr.port}/`;

  const browser = await chromium.launch({
    headless: !o.headed,
    channel: o.channel,
    executablePath: o.executable ?? process.env.CHROME_PATH,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${base}?test=1&cube=${o.cube}&particles=${o.particles ?? 1}`);
  await page.waitForFunction(() => window.gravitasReady || window.gravitasError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.gravitasError);
  if (err) throw new Error(err);
  const all = await page.evaluate(() => window.gravitas.scenes());
  if (o.list) {
    for (const s of all) console.log(`${s.id.padEnd(18)} ${s.category.padEnd(12)} ${s.title}${s.seeded ? '  (seeded)' : ''}`);
    await browser.close();
    await server.close();
    return;
  }
  const renderer = await page.evaluate(() => {
    const gl = window.gravitas.app.renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log(`GPU: ${renderer}`);
  if (/swiftshader/i.test(renderer)) console.log('  (software rendering: expect a few frames per second — try --channel chrome --headed for GPU speed)');

  const ids = o.scene === 'all' ? all.map((s) => s.id) : o.scene.split(',');
  const [bw, bh] = ASPECTS[o.aspect] ?? ASPECTS['9:16'];
  const width = Math.round(((o.width ?? bw) * o.scale) / 2) * 2;
  const height = Math.round(((o.height ?? bh) * o.scale) / 2) * 2;
  fs.mkdirSync(path.resolve(root, o.out), { recursive: true });

  for (const id of ids) {
    if (!all.some((s) => s.id === id)) {
      console.error(`Unknown scene "${id}". Use --list.`);
      continue;
    }
    const file = path.resolve(root, o.out, `${id}${o.seed !== 1 ? `-seed${o.seed}` : ''}-${width}x${height}-${o.fps}fps.mp4`);
    const info = await page.evaluate((a) => window.gravitas.beginClip(a), {
      scene: id,
      seed: o.seed,
      width,
      height,
      fps: o.fps,
      duration: o.duration,
      captions: o.captions,
      handle: o.handle,
    });
    console.log(`\n▶ ${info.title} → ${path.relative(root, file)} (${width}×${height} @ ${o.fps} fps, ~${(info.total / o.fps).toFixed(1)} s)`);
    const ff = spawn(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(o.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', '-r', String(o.fps), file,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const exited = new Promise((res, rej) => {
      ff.on('error', (e) => rej(new Error(`Could not start ffmpeg (${ffmpeg}): ${e.message}. Install ffmpeg or set FFMPEG_PATH.`)));
      ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}`))));
    });
    const t0 = Date.now();
    for (;;) {
      const r = await page.evaluate(({ n, jpeg }) => window.gravitas.nextFrames(n, jpeg ? 'image/jpeg' : 'image/png', 0.95), { n: 4, jpeg: o.jpeg });
      for (const url of r.frames) {
        const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
      }
      const el = (Date.now() - t0) / 1000;
      const fps = r.frame / Math.max(el, 1e-3);
      process.stdout.write(`\r  frame ${r.frame}/${r.total}  ${fps.toFixed(1)} fps  eta ${((r.total - r.frame) / Math.max(fps, 1e-3)).toFixed(0)} s   `);
      if (r.done) break;
    }
    ff.stdin.end();
    await exited;
    console.log(`\n  ✓ ${path.relative(root, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
  }
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
