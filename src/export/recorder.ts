// Frame-exact clip export. A fresh runtime of the current scene is stepped at a fixed dt,
// rendered at the export resolution and encoded with WebCodecs into an MP4 (Mediabunny).

import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, Quality, type VideoCodec } from 'mediabunny';
import type { App } from '../app.ts';
import { Runtime } from '../engine/runtime.ts';

export interface ClipOptions {
  width: number;
  height: number;
  fps: number;
  /** Hard cap on clip length (s); defaults to the scene's own ending. */
  duration?: number;
  captions: boolean;
}

/** Deterministic frame stepper shared by the in-browser exporter and the CLI renderer. */
export class ClipSession {
  readonly rt: Runtime;
  readonly opts: ClipOptions;
  frame = 0;
  private maxFrames: number;

  constructor(app: App, opts: ClipOptions) {
    this.opts = opts;
    this.rt = new Runtime(app.renderer, app.overlay, app.scene, { seed: app.seed, captions: opts.captions, duration: opts.duration });
    app.runtime = this.rt;
    this.maxFrames = Math.ceil((opts.duration ?? 180) * opts.fps);
  }

  get done(): boolean {
    return this.rt.done || this.frame >= this.maxFrames;
  }

  /** Estimated total frames (the scene may end early once it resolves). */
  get totalFrames(): number {
    return Math.min(this.maxFrames, Math.ceil(this.rt.endAt * this.opts.fps));
  }

  step() {
    const { fps, width, height } = this.opts;
    this.rt.update(1 / fps);
    this.rt.render(width, height);
    this.frame++;
  }
}

export interface ExportProgress {
  frame: number;
  total: number;
  elapsed: number;
  eta: number;
}

export interface ExportResult {
  blob: Blob;
  codec: VideoCodec;
  frames: number;
  seconds: number;
  filename: string;
}

export function supportsExport(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

export async function exportClip(
  app: App,
  opts: ClipOptions & { onProgress?: (p: ExportProgress) => void; signal?: AbortSignal; bitsPerPixel?: number },
): Promise<ExportResult> {
  if (!supportsExport()) {
    throw new Error('This browser cannot encode video (no WebCodecs). Use Chrome, Edge or Safari 17+, or the CLI renderer (npm run render).');
  }
  const { width: w, height: h, fps } = opts;
  // Particles, grain and fine trails are expensive to compress: be generous.
  const bitrate = Math.round(w * h * fps * (opts.bitsPerPixel ?? 0.2));
  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h, bitrate });
  if (!codec) throw new Error(`No video encoder available for ${w}×${h}.`);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(app.canvas, { codec, quality: new Quality({ bitrate, bitrateMode: 'variable' }), keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  app.busy = true;
  const session = new ClipSession(app, opts);
  const t0 = performance.now();
  try {
    while (!session.done) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      session.step();
      await source.add((session.frame - 1) / fps, 1 / fps);
      if (session.frame % 3 === 0) {
        const elapsed = (performance.now() - t0) / 1000;
        const total = session.totalFrames;
        opts.onProgress?.({ frame: session.frame, total, elapsed, eta: (elapsed / session.frame) * Math.max(0, total - session.frame) });
        // Let the page repaint the progress UI.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    app.busy = false;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Encoder produced no data.');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    codec,
    frames: session.frame,
    seconds: session.frame / fps,
    filename: `gravitas-${app.scene.id}${app.scene.seeded ? `-seed${app.seed}` : ''}-${w}x${h}-${fps}fps-${stamp}.mp4`,
  };
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
