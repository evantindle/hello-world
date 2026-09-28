// Minimal studio UI: scene gallery, transport controls, camera handling and the export dialog.
// Everything auto-hides so the canvas can be screen-recorded cleanly too.

import { ASPECTS, type App } from '../app.ts';
import { download, exportClip, renderStill, supportsExport } from '../export/recorder.ts';
import { SCENES } from '../scenes/index.ts';
import type { SceneDef } from '../scenes/types.ts';

const CATEGORIES: SceneDef['category'][] = ['Three-Body', 'N-Body', 'Black Holes', 'Galactic', 'Math'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
  rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
};

export function mountUI(app: App) {
  const root = document.getElementById('ui')!;
  root.innerHTML = '';

  // ---- top bar ----
  const top = el('header', 'topbar');
  const brand = el('div', 'brand', '<span class="mark"></span><span>GRAVITAS</span>');
  const title = el('div', 'scene-title');
  const galleryBtn = el('button', 'icon-btn', ICON.grid);
  galleryBtn.title = 'Scenes (G)';
  galleryBtn.setAttribute('aria-label', 'Scenes');
  const hideBtn = el('button', 'icon-btn', ICON.eye);
  hideBtn.title = 'Hide interface (H)';
  hideBtn.setAttribute('aria-label', 'Hide interface');
  const topRight = el('div', 'top-actions');
  topRight.append(galleryBtn, hideBtn);
  top.append(brand, title, topRight);

  // ---- gallery ----
  const gallery = el('aside', 'gallery');
  const galHead = el('div', 'gallery-head', '<h2>Scenes</h2>');
  const galClose = el('button', 'icon-btn', ICON.close);
  galClose.setAttribute('aria-label', 'Close scenes');
  galHead.append(galClose);
  gallery.append(galHead);
  const items = new Map<string, HTMLElement>();
  for (const cat of CATEGORIES) {
    const sec = el('section');
    sec.append(el('h3', '', cat));
    for (const s of SCENES.filter((x) => x.category === cat)) {
      const it = el('button', 'scene-item', `<b>${s.title}</b><span>${s.blurb}</span>`);
      it.onclick = () => {
        app.load(s, s.seeded ? app.seed : 1);
        if (window.innerWidth < 900) gallery.classList.remove('open');
      };
      items.set(s.id, it);
      sec.append(it);
    }
    gallery.append(sec);
  }

  // ---- bottom controls ----
  const bar = el('footer', 'controls');
  const playBtn = el('button', 'icon-btn', ICON.pause);
  playBtn.title = 'Play / pause (Space)';
  playBtn.setAttribute('aria-label', 'Play or pause');
  const restartBtn = el('button', 'icon-btn', ICON.restart);
  restartBtn.title = 'Restart (R)';
  restartBtn.setAttribute('aria-label', 'Restart');
  const speed = el('select', 'select');
  speed.id = 'speed';
  speed.title = 'Playback speed';
  speed.setAttribute('aria-label', 'Playback speed');
  for (const v of [0.25, 0.5, 1, 1.5, 2, 4]) speed.append(new Option(`${v}×`, String(v), v === 1, v === 1));
  const aspect = el('select', 'select');
  aspect.id = 'aspect';
  aspect.title = 'Frame';
  aspect.setAttribute('aria-label', 'Frame shape');
  for (const a of ASPECTS) aspect.append(new Option(a.id, a.id, a === app.aspect, a === app.aspect));
  const capLabel = el('label', 'toggle', '<input type="checkbox" id="captions" checked><span>Captions</span>');
  const capInput = capLabel.querySelector('input')!;
  capInput.checked = app.captions;
  const seedWrap = el('div', 'seed');
  const seedInput = el('input', 'seed-input') as HTMLInputElement;
  seedInput.id = 'seed';
  seedInput.setAttribute('aria-label', 'Seed');
  seedInput.type = 'number';
  seedInput.min = '1';
  seedInput.title = 'Seed';
  const diceBtn = el('button', 'icon-btn', ICON.dice);
  diceBtn.title = 'New random system (N)';
  diceBtn.setAttribute('aria-label', 'New random system');
  seedWrap.append(el('span', 'seed-label', 'seed'), seedInput, diceBtn);
  const stillBtn = el('button', 'icon-btn', ICON.camera);
  stillBtn.title = 'Save this frame as a full-resolution PNG (S)';
  stillBtn.setAttribute('aria-label', 'Save still image');
  const recBtn = el('button', 'rec-btn', `${ICON.rec}<span>Export MP4</span>`);
  recBtn.title = 'Render this clip to video (E)';
  const fpsEl = el('div', 'fps');
  bar.append(playBtn, restartBtn, speed, aspect, capLabel, seedWrap, el('div', 'spacer'), fpsEl, stillBtn, recBtn);

  // ---- export modal ----
  const modal = el('div', 'modal');
  modal.innerHTML = `
    <div class="sheet">
      <div class="sheet-head"><h2>Export clip</h2></div>
      <p class="muted">Renders the scene frame by frame from the start, so the video is perfectly smooth no matter how fast your machine is.</p>
      <div class="field"><label for="exp-res">Resolution</label><select class="select" id="exp-res" data-k="res"></select></div>
      <div class="field"><label for="exp-fps">Frame rate</label><select class="select" id="exp-fps" data-k="fps"><option value="60" selected>60 fps</option><option value="30">30 fps</option></select></div>
      <div class="field"><label for="exp-dur">Length</label><select class="select" id="exp-dur" data-k="dur"><option value="auto" selected>Whole story (auto)</option><option value="15">15 s</option><option value="30">30 s</option><option value="45">45 s</option><option value="60">60 s</option></select></div>
      <label class="toggle"><input type="checkbox" id="exp-cap" data-k="cap" checked><span>Burn in captions</span></label>
      <div class="progress"><div class="bar"></div></div>
      <div class="status muted"></div>
      <div class="actions"><button class="ghost" data-k="cancel">Cancel</button><button class="primary" data-k="go">Render</button></div>
    </div>`;
  const q = <T extends HTMLElement>(k: string) => modal.querySelector(`[data-k="${k}"]`) as T;
  const resSel = q<HTMLSelectElement>('res');
  const progBar = modal.querySelector('.progress .bar') as HTMLElement;
  const status = modal.querySelector('.status') as HTMLElement;
  const goBtn = q<HTMLButtonElement>('go');
  const cancelBtn = q<HTMLButtonElement>('cancel');
  let abort: AbortController | null = null;

  const toast = el('div', 'toast');
  root.append(top, gallery, bar, modal, toast);

  function showToast(msg: string, ms = 3200) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), ms);
  }

  function fillResolutions() {
    resSel.innerHTML = '';
    const a = app.aspect;
    const presets = [
      { k: 'hd', f: 1, label: `${a.w}×${a.h}` },
      { k: 'sd', f: 2 / 3, label: `${Math.round((a.w * 2) / 3 / 2) * 2}×${Math.round((a.h * 2) / 3 / 2) * 2} (faster)` },
      { k: '4k', f: 2, label: `${a.w * 2}×${a.h * 2} (4K, slow)` },
    ];
    for (const p of presets) resSel.append(new Option(p.label, String(p.f), p.k === 'hd', p.k === 'hd'));
  }

  function sync() {
    const rt = app.runtime;
    title.textContent = app.scene.title;
    for (const [id, it] of items) it.classList.toggle('active', id === app.scene.id);
    seedWrap.style.display = app.scene.seeded ? '' : 'none';
    seedInput.value = String(app.seed);
    playBtn.innerHTML = rt?.paused ? ICON.play : ICON.pause;
    try {
      const url = new URL(location.href);
      url.searchParams.set('scene', app.scene.id);
      if (app.scene.seeded) url.searchParams.set('seed', String(app.seed));
      else url.searchParams.delete('seed');
      url.searchParams.set('aspect', app.aspect.id);
      history.replaceState(null, '', url);
    } catch {
      // Sandboxed frames may refuse history updates; the URL is only a convenience.
    }
  }
  app.onSceneChange = (rt) => {
    rt.director.userSpeed = Number(speed.value);
    sync();
  };

  // ---- wiring ----
  playBtn.onclick = () => {
    if (app.busy) return;
    if (app.runtime) app.runtime.paused = !app.runtime.paused;
    sync();
  };
  restartBtn.onclick = () => app.restart();
  speed.onchange = () => {
    if (app.runtime) app.runtime.director.userSpeed = Number(speed.value);
  };
  aspect.onchange = () => {
    app.aspect = ASPECTS.find((a) => a.id === aspect.value) ?? ASPECTS[0];
    fillResolutions();
    sync();
  };
  capInput.onchange = () => {
    if (app.busy) {
      capInput.checked = app.captions;
      return;
    }
    app.captions = capInput.checked;
    app.overlay.enabled = app.captions;
  };
  seedInput.onchange = () => app.load(app.scene, Math.max(1, Math.floor(Number(seedInput.value) || 1)));
  diceBtn.onclick = () => app.load(app.scene, 1 + Math.floor(Math.random() * 99999));
  galleryBtn.onclick = () => gallery.classList.toggle('open');
  galClose.onclick = () => gallery.classList.remove('open');
  hideBtn.onclick = () => {
    root.classList.add('hidden');
    showToast('Interface hidden — press H or tap twice to bring it back');
  };

  stillBtn.onclick = async () => {
    if (app.busy) return;
    try {
      const still = await renderStill(app, app.aspect.w, app.aspect.h);
      const outcome = await download(still.blob, still.filename);
      showToast(outcome === 'saved' ? `Saved ${still.filename}` : 'Download cancelled');
    } catch (e) {
      showToast(`Could not save the image: ${e instanceof Error ? e.message : e}`, 5000);
    }
  };

  recBtn.onclick = () => {
    if (app.busy) return;
    if (!supportsExport()) {
      showToast('This browser cannot encode video. Use Chrome / Edge / Safari 17+, or `npm run render`.', 5000);
      return;
    }
    fillResolutions();
    q<HTMLInputElement>('cap').checked = app.captions;
    progBar.style.width = '0%';
    status.textContent = `Scene: ${app.scene.title}${app.scene.seeded ? ` · seed ${app.seed}` : ''}`;
    goBtn.disabled = false;
    modal.classList.add('open');
  };
  cancelBtn.onclick = () => {
    if (abort) abort.abort();
    else modal.classList.remove('open');
  };
  goBtn.onclick = async () => {
    if (app.busy) return;
    const f = Number(resSel.value);
    const w = Math.round((app.aspect.w * f) / 2) * 2;
    const h = Math.round((app.aspect.h * f) / 2) * 2;
    const fps = Number(q<HTMLSelectElement>('fps').value);
    const durV = q<HTMLSelectElement>('dur').value;
    abort = new AbortController();
    goBtn.disabled = true;
    root.classList.add('exporting');
    try {
      const res = await exportClip(app, {
        width: w,
        height: h,
        fps,
        duration: durV === 'auto' ? undefined : Number(durV),
        captions: q<HTMLInputElement>('cap').checked,
        signal: abort.signal,
        onProgress: (p) => {
          progBar.style.width = `${Math.min(100, (100 * p.frame) / Math.max(1, p.total)).toFixed(1)}%`;
          status.textContent = `Frame ${p.frame} / ~${p.total} · ${p.elapsed.toFixed(0)} s elapsed · ~${p.eta.toFixed(0)} s left`;
        },
      });
      progBar.style.width = '100%';
      status.textContent = `Done: ${res.seconds.toFixed(1)} s of ${res.codec.toUpperCase()} video (${(res.blob.size / 1e6).toFixed(1)} MB).`;
      const outcome = await download(res.blob, res.filename);
      showToast(outcome === 'saved' ? `Saved ${res.filename}` : 'Download cancelled');
      setTimeout(() => modal.classList.remove('open'), 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.textContent = /cancel/i.test(msg) ? 'Export cancelled.' : `Export failed: ${msg}`;
    } finally {
      abort = null;
      goBtn.disabled = false;
      root.classList.remove('exporting');
      app.restart();
    }
  };

  // ---- camera: drag to orbit, wheel to zoom, double-click to reset ----
  const canvas = app.canvas;
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !app.runtime) return;
    const cam = app.runtime.camera;
    cam.userYaw -= (e.clientX - drag.x) * 0.25;
    cam.userPitch = Math.max(-80, Math.min(80, cam.userPitch + (e.clientY - drag.y) * 0.2));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!app.runtime) return;
      e.preventDefault();
      const cam = app.runtime.camera;
      cam.userZoom = Math.max(0.2, Math.min(6, cam.userZoom * Math.exp(e.deltaY * 0.0012)));
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => {
    if (root.classList.contains('hidden')) {
      root.classList.remove('hidden');
      return;
    }
    if (!app.runtime) return;
    const cam = app.runtime.camera;
    cam.userYaw = 0;
    cam.userPitch = 0;
    cam.userZoom = 1;
  });

  // ---- keyboard ----
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (app.busy) {
      // While a clip renders, only Escape (cancel) is live.
      if (e.key === 'Escape' && abort) abort.abort();
      return;
    }
    const idx = SCENES.indexOf(app.scene);
    switch (e.key) {
      case ' ':
        e.preventDefault();
        playBtn.click();
        break;
      case 'r':
      case 'R':
        app.restart();
        break;
      case 'h':
      case 'H':
        root.classList.toggle('hidden');
        break;
      case 'g':
      case 'G':
        gallery.classList.toggle('open');
        break;
      case 'n':
      case 'N':
        if (app.scene.seeded) diceBtn.click();
        break;
      case 'e':
      case 'E':
        recBtn.click();
        break;
      case 's':
      case 'S':
        stillBtn.click();
        break;
      case 'c':
      case 'C':
        capInput.checked = !capInput.checked;
        capInput.onchange?.(new Event('change'));
        break;
      case 'ArrowRight':
        app.load(SCENES[(idx + 1) % SCENES.length], 1);
        break;
      case 'ArrowLeft':
        app.load(SCENES[(idx - 1 + SCENES.length) % SCENES.length], 1);
        break;
      case 'Escape':
        gallery.classList.remove('open');
        if (!abort) modal.classList.remove('open');
        break;
    }
  });

  // ---- auto-hide while idle ----
  let idleTimer = 0;
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!gallery.classList.contains('open') && !modal.classList.contains('open')) root.classList.add('idle');
    }, 3500);
  };
  window.addEventListener('pointermove', wake);
  window.addEventListener('keydown', wake);
  wake();

  setInterval(() => {
    fpsEl.textContent = app.busy ? 'rendering…' : `${app.fps.toFixed(0)} fps`;
  }, 500);

  if (window.innerWidth >= 900) gallery.classList.add('open');
  sync();
}
