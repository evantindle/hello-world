import { App, ASPECTS } from './app.ts';
import { ClipSession } from './export/recorder.ts';
import { SCENES, sceneById } from './scenes/index.ts';
import './style.css';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLElement;

function fail(msg: string) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = msg;
  document.body.appendChild(el);
}

try {
  const app = new App(canvas, stage, {
    cubeSize: Number(params.get('cube') ?? 1024),
    previewLongEdge: Number(params.get('preview') ?? 1600),
    particleScale: Number(params.get('particles') ?? 1),
  });
  const aspect = ASPECTS.find((a) => a.id === params.get('aspect'));
  if (aspect) app.aspect = aspect;
  if (params.get('captions') === '0') app.captions = false;
  app.overlay.handle = params.get('handle') ?? '';
  const seed = Number(params.get('seed') ?? 1);
  app.load(sceneById(params.get('scene')), seed);

  // Automation API (used by scripts/render.mjs and the test harness).
  let session: ClipSession | null = null;
  (window as any).gravitas = {
    app,
    SCENES,
    sceneById,
    scenes: () => SCENES.map((s) => ({ id: s.id, title: s.title, category: s.category, seeded: !!s.seeded })),
    async beginClip(o: { scene: string; seed?: number; width: number; height: number; fps: number; duration?: number; captions?: boolean; handle?: string }) {
      await document.fonts?.ready;
      app.captions = o.captions ?? true;
      app.overlay.handle = o.handle ?? '';
      app.seed = o.seed ?? 1;
      app.scene = sceneById(o.scene);
      session = new ClipSession(app, { width: o.width, height: o.height, fps: o.fps, duration: o.duration, captions: app.captions });
      return { total: session.totalFrames, title: app.scene.title };
    },
    nextFrames(n: number, type = 'image/png', quality = 0.95) {
      if (!session) throw new Error('beginClip first');
      const frames: string[] = [];
      for (let i = 0; i < n && !session.done; i++) {
        session.step();
        frames.push(app.canvas.toDataURL(type, quality));
      }
      return { frames, done: session.done, frame: session.frame, total: session.totalFrames };
    },
  };
  if (params.get('test') !== '1') {
    const { mountUI } = await import('./ui/ui.ts');
    mountUI(app);
    app.start();
  }
  (window as any).gravitasReady = true;
} catch (e) {
  console.error(e);
  fail(e instanceof Error ? e.message : String(e));
  (window as any).gravitasError = String(e instanceof Error ? e.stack : e);
}
