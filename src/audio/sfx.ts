/**
 * Every sound in the game is synthesised on the fly with Web Audio: no audio files.
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */

type Wave = OscillatorType;

interface Loop {
  oscs: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
}

const MUTE_KEY = 'bendy-billiards.muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private strain: Loop | null = null;
  private squeak: Loop | null = null;
  private pitch = 1;
  private voices: number[] = [];
  muted = false;

  constructor() {
    try {
      this.muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 18000;
      this.bus = ctx.createGain();
      this.bus.connect(this.filter).connect(comp).connect(this.master).connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
    if (m) {
      this.strainStop();
      this.squeakStop();
    }
  }

  setSlowmo(on: boolean): void {
    this.pitch = on ? 0.62 : 1;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(on ? 900 : 18000, t, on ? 0.08 : 0.25);
    if (on && this.ready) this.slide('sawtooth', 380, 70, 0.9, 0.12, 700);
  }

  // ------------------------------------------------------------------ primitives

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Voice limiter: returns false if too many sounds started very recently. */
  private allow(maxPer100ms = 10): boolean {
    const t = this.now();
    this.voices = this.voices.filter((v) => t - v < 0.1);
    if (this.voices.length >= maxPer100ms) return false;
    this.voices.push(t);
    return true;
  }

  private tone(
    wave: Wave,
    f0: number,
    dur: number,
    gain: number,
    opts: { f1?: number; delay?: number; attack?: number; vibrato?: [number, number]; lp?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0 * this.pitch, t0);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1 * this.pitch), t0 + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = o;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.bus);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = opts.vibrato[0];
      lg.gain.value = opts.vibrato[1] * this.pitch;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private slide(wave: Wave, f0: number, f1: number, dur: number, gain: number, lp?: number, delay = 0): void {
    this.tone(wave, f0, dur, gain, { f1, delay, lp, attack: 0.01 });
  }

  private hiss(
    dur: number,
    gain: number,
    type: BiquadFilterType,
    freq: number,
    q = 1,
    delay = 0,
    freq1?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.pitch;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  private startLoop(waves: [Wave, number][], lp: number, gain: number): Loop | null {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return null;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.03);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const oscs = waves.map(([w, fr]) => {
      const o = ctx.createOscillator();
      o.type = w;
      o.frequency.value = fr;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(g).connect(this.bus);
    return { oscs, gain: g, filter: f };
  }

  private stopLoop(l: Loop | null): void {
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setTargetAtTime(0.0001, t, 0.04);
    for (const o of l.oscs) o.stop(t + 0.3);
  }

  // ------------------------------------------------------------------ the sounds

  tick(speed: number): void {
    if (!this.allow(14)) return;
    const f = 1500 + Math.min(1800, speed * 60);
    this.hiss(0.02, 0.18, 'bandpass', 3800, 4);
    this.tone('sine', f, 0.03, 0.05);
  }

  /** Ball on ball. strength 0..1 */
  clack(strength: number): void {
    if (!this.allow()) return;
    const s = Math.min(1, Math.max(0.08, strength));
    const detune = 0.92 + Math.random() * 0.16;
    this.hiss(0.05, 0.5 * s, 'bandpass', 2600 * detune, 1.4);
    this.tone('triangle', 1250 * detune, 0.05, 0.3 * s, { f1: 950 * detune });
    if (s > 0.6) this.tone('square', 190 * detune, 0.08, 0.06 * s, { f1: 120, lp: 1200 });
  }

  /** Ball on cushion: a springy cartoon boing. strength 0..1 */
  boing(strength: number): void {
    if (!this.allow()) return;
    const s = Math.min(1, Math.max(0.1, strength));
    const base = 150 + Math.random() * 60;
    this.tone('sine', base * 2.2, 0.28, 0.2 * s, { f1: base, vibrato: [18, 25] });
    this.tone('sine', 110, 0.12, 0.28 * s, { f1: 55 });
  }

  whack(power: number): void {
    const p = Math.max(0.2, power);
    this.hiss(0.09, 0.7 * p, 'lowpass', 2200);
    this.tone('sine', 95, 0.18, 0.8 * p, { f1: 40 });
    this.tone('square', 900, 0.025, 0.12 * p);
  }

  whoosh(): void {
    this.hiss(0.35, 0.18, 'bandpass', 500, 2, 0, 2400);
  }

  gulp(): void {
    this.slide('sine', 820, 240, 0.3, 0.25);
    this.tone('sine', 130, 0.12, 0.35, { f1: 60, delay: 0.26 });
  }

  burp(): void {
    this.tone('sawtooth', 95, 0.42, 0.2, { f1: 70, vibrato: [28, 30], lp: 520, delay: 0.32, attack: 0.03 });
  }

  chomp(): void {
    this.hiss(0.05, 0.4, 'lowpass', 700, 1);
    this.hiss(0.05, 0.4, 'lowpass', 600, 1, 0.09);
    this.tone('square', 70, 0.05, 0.12, { delay: 0.09, lp: 400 });
  }

  growl(level: number): void {
    this.tone('sawtooth', 62 + level * 6, 0.6, 0.16, { vibrato: [26, 18], lp: 380, attack: 0.08 });
  }

  trombone(): void {
    const notes: [number, number][] = [
      [196, 0.32],
      [185, 0.32],
      [174.6, 0.32],
      [164.8, 1.0],
    ];
    let d = 0;
    for (const [f, dur] of notes) {
      this.tone('sawtooth', f, dur, 0.16, {
        delay: d,
        lp: 900,
        attack: 0.04,
        vibrato: dur > 0.5 ? [5.5, 6] : undefined,
      });
      d += dur * 0.95;
    }
  }

  fanfare(): void {
    const arp = [523.25, 659.25, 783.99, 1046.5];
    arp.forEach((f, i) => this.tone('square', f, 0.14, 0.09, { delay: i * 0.1, lp: 3200 }));
    for (const f of arp) this.tone('square', f, 0.9, 0.06, { delay: 0.42, lp: 2600, attack: 0.02 });
    this.tone('triangle', 261.6, 0.9, 0.12, { delay: 0.42 });
  }

  nope(): void {
    if (!this.allow(4)) return;
    this.tone('square', 180, 0.07, 0.08, { lp: 1400 });
    this.tone('square', 135, 0.11, 0.08, { delay: 0.09, lp: 1400 });
  }

  pop(): void {
    this.tone('sine', 520, 0.07, 0.14, { f1: 980 });
  }

  poke(): void {
    if (!this.allow(6)) return;
    this.tone('sine', 420, 0.12, 0.18, { f1: 190, vibrato: [30, 20] });
  }

  spit(): void {
    this.hiss(0.07, 0.3, 'highpass', 1200);
    this.tone('sine', 420, 0.12, 0.2, { f1: 980 });
  }

  land(): void {
    this.tone('sine', 150, 0.12, 0.35, { f1: 60 });
    this.hiss(0.08, 0.2, 'lowpass', 900);
  }

  sproing(): void {
    this.tone('sine', 220, 0.3, 0.18, { f1: 880, vibrato: [22, 30] });
  }

  ding(level: number): void {
    const f = 880 * 2 ** (Math.min(level, 6) / 6);
    this.tone('triangle', f, 0.5, 0.14);
    this.tone('sine', f * 2, 0.35, 0.06, { delay: 0.01 });
  }

  spinStart(): void {
    this.whoosh();
    this.tone('sine', 300, 0.2, 0.08, { f1: 700 });
  }

  // ------------------------------------------------------------------ loops

  strainStart(): void {
    this.strainStop();
    this.strain = this.startLoop(
      [
        ['sawtooth', 90],
        ['sawtooth', 91.5],
      ],
      700,
      0.07,
    );
  }

  strainSet(power: number): void {
    const l = this.strain;
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = (90 + 280 * power) * this.pitch;
    const wobble = power > 0.98 ? Math.sin(t * 60) * 12 : 0;
    l.oscs[0]!.frequency.setTargetAtTime(f + wobble, t, 0.03);
    l.oscs[1]!.frequency.setTargetAtTime(f * 1.012 + wobble, t, 0.03);
    l.filter.frequency.setTargetAtTime(600 + 1800 * power, t, 0.05);
    l.gain.gain.setTargetAtTime(0.05 + 0.08 * power, t, 0.05);
  }

  strainStop(): void {
    this.stopLoop(this.strain);
    this.strain = null;
  }

  /** Rubbery stretching noise while dragging the table. */
  squeakStart(): void {
    this.squeakStop();
    this.squeak = this.startLoop([['triangle', 300]], 2200, 0.0001);
  }

  squeakSet(speed: number): void {
    const l = this.squeak;
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 900);
    l.oscs[0]!.frequency.setTargetAtTime((260 + 520 * s + Math.sin(t * 40) * 30) * this.pitch, t, 0.02);
    l.gain.gain.setTargetAtTime(0.0001 + 0.09 * s, t, 0.04);
  }

  squeakStop(): void {
    this.stopLoop(this.squeak);
    this.squeak = null;
  }

  // ------------------------------------------------------------------ v2: arena sounds

  /** A big cartoon wrench bolting something down. */
  clank(): void {
    if (!this.allow(6)) return;
    this.tone('square', 740, 0.09, 0.07, { lp: 3200 });
    this.tone('square', 1110, 0.07, 0.05, { lp: 4000, delay: 0.005 });
    this.hiss(0.06, 0.25, 'bandpass', 3200, 4);
    this.tone('square', 690, 0.1, 0.06, { lp: 3000, delay: 0.16 });
    this.hiss(0.05, 0.2, 'bandpass', 2900, 4, 0.16);
  }

  /** A picky pocket spitting out a ball it does not fancy. */
  bleh(): void {
    if (!this.allow(6)) return;
    this.tone('sawtooth', 150, 0.28, 0.07, { f1: 90, vibrato: [32, 22], lp: 900 });
  }

  /** A cork popping out of a pocket. */
  cork(): void {
    this.tone('sine', 1100, 0.09, 0.2, { f1: 320 });
    this.hiss(0.05, 0.18, 'highpass', 2500);
  }

  // ------------------------------------------------------------------ v2: toys and oddballs

  /** Pinball bumper: a bright two-note bell. */
  bumper(power: number): void {
    if (!this.allow(8)) return;
    const g = 0.06 + 0.1 * Math.min(1, power);
    this.tone('triangle', 1318, 0.22, g);
    this.tone('triangle', 1760, 0.18, g * 0.8, { delay: 0.03 });
  }

  /** Glass: a high ping when it cracks... */
  glassTink(): void {
    if (!this.allow(8)) return;
    this.tone('sine', 2600, 0.12, 0.1);
    this.tone('sine', 3900, 0.08, 0.05, { delay: 0.01 });
  }

  /** ...and a crash when it goes. */
  glassSmash(): void {
    this.hiss(0.5, 0.35, 'highpass', 3000, 1, 0, 6000);
    for (let i = 0; i < 5; i++) this.tone('sine', 2200 + i * 530, 0.1, 0.05, { delay: 0.03 * i });
  }

  eggCrack(): void {
    if (!this.allow(6)) return;
    this.hiss(0.06, 0.3, 'bandpass', 1800, 3);
    this.hiss(0.05, 0.25, 'bandpass', 1400, 3, 0.05);
  }

  splat(): void {
    this.hiss(0.18, 0.35, 'lowpass', 900, 1, 0, 200);
    this.tone('sine', 180, 0.15, 0.2, { f1: 60 });
  }

  boom(): void {
    this.hiss(0.9, 0.55, 'lowpass', 1200, 0.7, 0, 90);
    this.tone('sine', 90, 0.7, 0.45, { f1: 30 });
    this.tone('square', 60, 0.25, 0.08, { lp: 300 });
  }

  bawk(): void {
    if (!this.allow(4)) return;
    this.tone('square', 620, 0.09, 0.07, { f1: 900, lp: 2400 });
    this.tone('square', 760, 0.16, 0.07, { f1: 420, lp: 2400, delay: 0.1 });
  }

  // ------------------------------------------------------------------ v2: floor toys

  /** Speed pad: a rising saw slide. */
  zoom(): void {
    if (!this.allow(6)) return;
    this.slide('sawtooth', 220, 1300, 0.28, 0.08, 2600);
    this.hiss(0.25, 0.12, 'bandpass', 900, 2, 0, 4200);
  }

  /** Portal: a hissing sweep down then up. */
  warp(): void {
    if (!this.allow(6)) return;
    this.hiss(0.32, 0.2, 'bandpass', 3800, 3, 0, 500);
    this.slide('sine', 1400, 300, 0.16, 0.12);
    this.slide('sine', 300, 1600, 0.18, 0.1, undefined, 0.14);
  }

  /** Black hole: a long wobbly slide down the drain... */
  glorp(): void {
    this.tone('sawtooth', 520, 0.6, 0.12, { f1: 45, vibrato: [11, 40], lp: 1400 });
    this.hiss(0.6, 0.15, 'lowpass', 1600, 2, 0, 120);
  }

  /** ...and the pop when it spits a ball back out. */
  bloop(): void {
    this.tone('sine', 180, 0.14, 0.3, { f1: 720 });
    this.tone('sine', 900, 0.08, 0.1, { delay: 0.1 });
  }

  /** Ice: a bright skate scrape. */
  shing(): void {
    if (!this.allow(4)) return;
    this.hiss(0.22, 0.16, 'highpass', 5000, 1, 0, 9000);
    this.tone('sine', 3100, 0.18, 0.04);
  }

  /** Sand: a soft gritty thud. */
  fwump(): void {
    if (!this.allow(4)) return;
    this.hiss(0.16, 0.25, 'lowpass', 1400, 0.8, 0, 300);
  }
}
