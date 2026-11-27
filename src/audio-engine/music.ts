/**
 * Background music: either a looping local audio file (HTMLAudioElement routed into Web Audio)
 * or an original synthesized battle loop (lookahead sequencer).
 */
export class MusicPlayer {
  private fade: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private el: HTMLAudioElement | null = null;
  private elSource: MediaElementAudioSourceNode | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {}

  get playing(): boolean {
    return this.fade !== null;
  }

  start(url?: string, fadeIn = 1.5): void {
    this.stop(0);
    const ctx = this.ctx;
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(0.0001, ctx.currentTime);
    fade.gain.exponentialRampToValueAtTime(1, ctx.currentTime + Math.max(0.05, fadeIn));
    fade.connect(this.out);
    this.fade = fade;

    if (url) {
      const el = new Audio(url);
      el.loop = true;
      el.crossOrigin = "anonymous";
      this.el = el;
      try {
        this.elSource = ctx.createMediaElementSource(el);
        this.elSource.connect(fade);
      } catch {
        /* element plays directly if routing fails */
      }
      el.play().catch(() => {
        /* autoplay or load failure: ignore, never crash */
      });
      return;
    }

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    const tick = () => this.schedule();
    tick();
    this.timer = setInterval(tick, 50);
  }

  stop(fadeOut = 1.2): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const fade = this.fade;
    const el = this.el;
    const src = this.elSource;
    this.fade = null;
    this.el = null;
    this.elSource = null;
    if (!fade) return;
    const kill = () => {
      try {
        el?.pause();
        if (el) el.src = "";
        src?.disconnect();
        fade.disconnect();
      } catch {
        /* ignore */
      }
    };
    if (fadeOut <= 0) return kill();
    const now = this.ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(Math.max(0.0001, fade.gain.value), now);
    fade.gain.exponentialRampToValueAtTime(0.0001, now + fadeOut);
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      kill();
    }, fadeOut * 1000 + 100);
  }

  /** Original 16-step battle loop: A-minor driving bass, kick/snare/hats, pulsing pad. 132 BPM. */
  private schedule(): void {
    const ctx = this.ctx;
    const out = this.fade;
    if (!out) return;
    const stepDur = 60 / 132 / 4;
    // Avoid huge catch-up bursts after a tab was backgrounded.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    const roots = [45, 41, 43, 40]; // A, F, G, E (midi)
    while (this.nextTime < ctx.currentTime + 0.25) {
      const t = this.nextTime;
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % roots.length;
      const root = roots[bar];

      if (s === 0 || s === 6 || s === 8 || s === 11) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.05 : 0.03);
      const bassPattern = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 7, 12, 10];
      this.bass(t, midi(root + bassPattern[s]), stepDur * 0.9);
      if (s === 0) for (const iv of [12, 15, 19]) this.pad(t, midi(root + iv), stepDur * 16);

      this.nextTime += stepDur;
      this.step++;
    }
  }

  private env(t: number, peak: number, dur: number, attack = 0.005): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.fade!);
    return g;
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.15);
    o.connect(this.env(t, 0.5, 0.25));
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, dur: number) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(t, peak, dur));
    src.start(t);
  }

  private snare(t: number) {
    this.noiseHit(t, "bandpass", 1800, 0.25, 0.18);
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(this.env(t, 0.15, 0.1));
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, peak: number) {
    this.noiseHit(t, "highpass", 7000, peak, 0.04);
  }

  private bass(t: number, freq: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    o.connect(f).connect(this.env(t, 0.12, dur));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private pad(t: number, freq: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.4);
    g.gain.setValueAtTime(0.035, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.fade!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
