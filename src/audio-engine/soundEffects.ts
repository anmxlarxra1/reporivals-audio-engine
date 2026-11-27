import type { SFXName } from "./types";

/**
 * Original synthesized battle sound effects (Web Audio API only, no samples).
 * Each effect schedules its nodes on `out` starting at `t` and returns its length in seconds.
 */
type FX = (ctx: BaseAudioContext, out: AudioNode, t: number) => number;

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const curveCache = new Map<number, Float32Array<ArrayBuffer>>();
const SILENT = 0.0001;

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function distCurve(amount: number): Float32Array<ArrayBuffer> {
  let c = curveCache.get(amount);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    curveCache.set(amount, c);
  }
  return c;
}

/** Attack/decay gain envelope. */
function envGain(ctx: BaseAudioContext, t: number, peak: number, attack: number, dur: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, attack));
  g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
  return g;
}

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  start?: number;
  dur: number;
  peak?: number;
  attack?: number;
  detune?: number;
  lowpass?: number;
  drive?: number;
  /** Vibrato/FM: [rateHz, depthHz] */
  fm?: [number, number];
}

function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts): void {
  const s = t + (o.start ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, s);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, s + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  let node: AudioNode = osc;
  if (o.fm) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.fm[0];
    depth.gain.value = o.fm[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(s);
    lfo.stop(s + o.dur + 0.05);
  }
  if (o.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = distCurve(o.drive);
    node = node.connect(ws);
  }
  if (o.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lowpass;
    node = node.connect(f);
  }
  node.connect(envGain(ctx, s, o.peak ?? 0.3, o.attack ?? 0.005, o.dur)).connect(out);
  osc.start(s);
  osc.stop(s + o.dur + 0.05);
}

interface NoiseOpts {
  start?: number;
  dur: number;
  peak?: number;
  attack?: number;
  filter?: BiquadFilterType;
  f0?: number;
  f1?: number;
  q?: number;
}

function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOpts): void {
  const s = t + (o.start ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "lowpass";
  f.frequency.setValueAtTime(o.f0 ?? 2000, s);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, s + o.dur);
  f.Q.value = o.q ?? 1;
  src.connect(f).connect(envGain(ctx, s, o.peak ?? 0.3, o.attack ?? 0.003, o.dur)).connect(out);
  src.start(s, Math.random() * 1.5);
  src.stop(s + o.dur + 0.05);
}

/** Brass-like note: detuned saws through an enveloped lowpass. */
function brass(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, start: number, dur: number, peak = 0.12) {
  const s = t + start;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 2;
  f.frequency.setValueAtTime(300, s);
  f.frequency.linearRampToValueAtTime(3200, s + 0.06);
  f.frequency.exponentialRampToValueAtTime(1200, s + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, s);
  g.gain.linearRampToValueAtTime(peak, s + 0.03);
  g.gain.setValueAtTime(peak * 0.8, s + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(SILENT, s + dur);
  f.connect(g).connect(out);
  for (const d of [-8, 7]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = d;
    o.connect(f);
    o.start(s);
    o.stop(s + dur + 0.05);
  }
}

const N = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/*
 * Mix notes: energy is kept mostly in 200 Hz – 4 kHz so effects are audible on laptop/phone
 * speakers. Layer peaks are sized so a full effect peaks around 0.6–0.9 before the master limiter.
 */
export const SFX: Record<SFXName, FX> = {
  // Playful digital scan: chirpy chip blips over a wobbling sweep.
  scan(ctx, out, t) {
    const notes = [84, 88, 91, 86, 89, 93, 88, 91];
    notes.forEach((n, i) => tone(ctx, out, t, { type: "square", f0: N(n), start: i * 0.09, dur: 0.06, peak: 0.12, lowpass: 3500 }));
    tone(ctx, out, t, { type: "sine", f0: 400, f1: 1600, dur: 0.8, peak: 0.25, attack: 0.05, fm: [12, 60] });
    tone(ctx, out, t, { type: "triangle", f0: N(96), start: 0.78, dur: 0.25, peak: 0.25 });
    return 1.05;
  },

  // Rising "whoooOMP" entrance with a sparkly landing.
  entrance(ctx, out, t) {
    tone(ctx, out, t, { type: "sawtooth", f0: 160, f1: 900, dur: 0.7, peak: 0.3, attack: 0.55, lowpass: 2500 });
    noise(ctx, out, t, { filter: "bandpass", f0: 500, f1: 4000, q: 1.5, dur: 0.7, peak: 0.6, attack: 0.6 });
    tone(ctx, out, t, { type: "square", f0: 520, f1: 180, start: 0.68, dur: 0.25, peak: 0.3, lowpass: 2200 });
    noise(ctx, out, t, { start: 0.68, f0: 3000, f1: 400, dur: 0.3, peak: 0.55 });
    for (const [n, s] of [[84, 0.75], [88, 0.82], [91, 0.89]] as const)
      tone(ctx, out, t, { type: "triangle", f0: N(n), start: s, dur: 0.3, peak: 0.18 });
    return 1.2;
  },

  // Energetic arcade boxing bell: "ding-ding-ding!"
  battleStart(ctx, out, t) {
    const partials: [number, number, number][] = [[1, 0.3, 1.1], [2.0, 0.12, 0.8], [2.76, 0.1, 0.6], [4.07, 0.05, 0.4]];
    for (const s of [0, 0.17, 0.34]) {
      for (const [r, p, d] of partials) tone(ctx, out, t, { f0: 1046 * r, start: s, dur: d, peak: p, attack: 0.002 });
      noise(ctx, out, t, { start: s, filter: "bandpass", f0: 3500, q: 2, dur: 0.03, peak: 0.3 });
    }
    // punchy "GO!" chord
    for (const n of [72, 76, 79]) tone(ctx, out, t, { type: "square", f0: N(n), start: 0.55, dur: 0.45, peak: 0.08, lowpass: 3000 });
    tone(ctx, out, t, { type: "triangle", f0: N(60), f1: N(48), start: 0.55, dur: 0.35, peak: 0.4 });
    return 1.5;
  },

  // Quick cartoon sword swoosh: "fwip!"
  normalAttack(ctx, out, t) {
    noise(ctx, out, t, { filter: "bandpass", f0: 700, f1: 3800, q: 1.6, dur: 0.11, peak: 1.0, attack: 0.05 });
    noise(ctx, out, t, { start: 0.1, filter: "bandpass", f0: 3800, f1: 900, q: 1.6, dur: 0.12, peak: 0.8 });
    tone(ctx, out, t, { type: "triangle", f0: 800, f1: 2400, dur: 0.14, peak: 0.15, attack: 0.06 });
    tone(ctx, out, t, { f0: N(91), start: 0.12, dur: 0.18, peak: 0.12 }); // tiny "ting"
    return 0.35;
  },

  // Punchy arcade impact: "KA-POW!"
  criticalHit(ctx, out, t) {
    noise(ctx, out, t, { filter: "bandpass", f0: 900, f1: 4000, q: 1.5, dur: 0.07, peak: 0.6, attack: 0.03 });
    const h = 0.06;
    tone(ctx, out, t, { type: "square", f0: 620, f1: 140, start: h, dur: 0.22, peak: 0.32, lowpass: 2800, drive: 3 });
    tone(ctx, out, t, { type: "triangle", f0: 330, f1: 110, start: h, dur: 0.3, peak: 0.6 });
    noise(ctx, out, t, { start: h, f0: 5000, f1: 600, dur: 0.25, peak: 0.55 });
    tone(ctx, out, t, { type: "square", f0: 440, f1: 220, start: h + 0.09, dur: 0.15, peak: 0.2, lowpass: 2500 });
    for (const [n, s] of [[88, 0.18], [93, 0.24]] as const)
      tone(ctx, out, t, { type: "triangle", f0: N(n), start: s, dur: 0.2, peak: 0.18 });
    return 0.55;
  },

  // Magical shimmering shield: rising sparkle arpeggio + wobbly glow.
  shield(ctx, out, t) {
    tone(ctx, out, t, { f0: 500, f1: 1400, dur: 0.45, peak: 0.25, attack: 0.08, fm: [10, 40] });
    [79, 83, 86, 91, 95].forEach((n, i) =>
      tone(ctx, out, t, { type: "triangle", f0: N(n), start: i * 0.06, dur: 0.5, peak: 0.16, fm: [7, 10] }),
    );
    noise(ctx, out, t, { filter: "highpass", f0: 5000, dur: 0.6, peak: 0.1, attack: 0.15 });
    return 0.85;
  },

  // Cartoon glass shatter: crash + tinkling shards.
  shieldBreak(ctx, out, t) {
    noise(ctx, out, t, { filter: "highpass", f0: 2200, dur: 0.28, peak: 0.6 });
    noise(ctx, out, t, { filter: "bandpass", f0: 1200, q: 1, dur: 0.12, peak: 0.6 });
    tone(ctx, out, t, { type: "triangle", f0: 1400, f1: 400, dur: 0.25, peak: 0.25 });
    for (let i = 0; i < 14; i++) {
      tone(ctx, out, t, {
        type: i % 2 ? "triangle" : "sine",
        f0: 2200 + Math.random() * 3000,
        start: 0.03 + i * 0.03 + Math.random() * 0.03,
        dur: 0.1 + Math.random() * 0.15,
        peak: 0.13,
      });
    }
    return 0.75;
  },

  // Soft comedic bonk: hollow wood-block "bonk!"
  damage(ctx, out, t) {
    tone(ctx, out, t, { f0: 720, f1: 300, dur: 0.16, peak: 0.6 });
    tone(ctx, out, t, { type: "triangle", f0: 1440, f1: 600, dur: 0.08, peak: 0.15 });
    noise(ctx, out, t, { filter: "bandpass", f0: 1800, q: 3, dur: 0.03, peak: 0.35 });
    return 0.25;
  },

  // Dramatic energy buildup, then a big satisfying boom with sparkles.
  ultimate(ctx, out, t) {
    const b = 1.2;
    tone(ctx, out, t, { type: "sawtooth", f0: 120, f1: 960, dur: b, peak: 0.2, attack: b * 0.9, lowpass: 2600, fm: [9, 20] });
    tone(ctx, out, t, { type: "square", f0: 180, f1: 1440, dur: b, peak: 0.07, attack: b * 0.9, lowpass: 2000 });
    noise(ctx, out, t, { filter: "bandpass", f0: 400, f1: 5000, q: 2, dur: b, peak: 0.45, attack: b * 0.95 });
    // impact
    tone(ctx, out, t, { type: "square", f0: 400, f1: 70, start: b, dur: 0.5, peak: 0.28, drive: 4, lowpass: 2500 });
    tone(ctx, out, t, { type: "triangle", f0: 260, f1: 60, start: b, dur: 0.7, peak: 0.6 });
    noise(ctx, out, t, { start: b, f0: 5000, f1: 300, dur: 1.1, peak: 0.6 });
    for (const [n, s] of [[84, 0.25], [88, 0.32], [91, 0.39], [96, 0.46]] as const)
      tone(ctx, out, t, { type: "triangle", f0: N(n), start: b + s, dur: 0.5, peak: 0.14 });
    return b + 1.2;
  },

  // Heartbeat in an audible range + gentle warning beep.
  lowHealth(ctx, out, t) {
    tone(ctx, out, t, { type: "triangle", f0: 220, f1: 110, dur: 0.14, peak: 0.6 });
    tone(ctx, out, t, { type: "triangle", f0: 200, f1: 100, start: 0.2, dur: 0.17, peak: 0.45 });
    tone(ctx, out, t, { type: "square", f0: N(81), start: 0.45, dur: 0.1, peak: 0.1, lowpass: 2500 });
    return 0.6;
  },

  // Magical rising power-up.
  transform(ctx, out, t) {
    const notes = [60, 64, 67, 72, 76, 79, 84, 88];
    notes.forEach((n, i) => tone(ctx, out, t, { type: "square", f0: N(n), start: i * 0.07, dur: 0.12, peak: 0.12, lowpass: 3500 }));
    tone(ctx, out, t, { f0: 300, f1: 1500, dur: 0.6, peak: 0.25, attack: 0.4, fm: [14, 50] });
    noise(ctx, out, t, { filter: "bandpass", f0: 800, f1: 6000, q: 2, dur: 0.6, peak: 0.3, attack: 0.5 });
    for (const n of [72, 76, 79, 84]) tone(ctx, out, t, { type: "triangle", f0: N(n), start: 0.6, dur: 0.8, peak: 0.14, fm: [6, 5] });
    noise(ctx, out, t, { start: 0.6, filter: "highpass", f0: 6000, dur: 0.5, peak: 0.12 });
    return 1.45;
  },

  // Cheerful chiptune fanfare: "da-da-da-DAAA!"
  victory(ctx, out, t) {
    const seq: [number, number, number][] = [[72, 0, 0.1], [76, 0.11, 0.1], [79, 0.22, 0.1], [84, 0.33, 0.22], [79, 0.57, 0.1], [84, 0.68, 0.7]];
    for (const [n, s, d] of seq) {
      tone(ctx, out, t, { type: "square", f0: N(n), start: s, dur: d, peak: 0.16, attack: 0.005, lowpass: 4000 });
      tone(ctx, out, t, { type: "triangle", f0: N(n + 12), start: s, dur: d, peak: 0.06 });
    }
    for (const [n, s, d] of [[48, 0, 0.3], [55, 0.33, 0.3], [60, 0.68, 0.7]] as const)
      tone(ctx, out, t, { type: "triangle", f0: N(n), start: s, dur: d, peak: 0.35 });
    brass(ctx, out, t, N(72), 0.68, 0.7, 0.07);
    noise(ctx, out, t, { start: 0.68, filter: "highpass", f0: 6000, dur: 0.6, peak: 0.08 });
    return 1.45;
  },

  // Funny "wah wah wah waaah" sad trombone.
  defeat(ctx, out, t) {
    const seq: [number, number, number][] = [[67, 0, 0.38], [66, 0.42, 0.38], [65, 0.84, 0.38], [64, 1.26, 1.1]];
    for (const [n, s, d] of seq) {
      const last = s > 1;
      tone(ctx, out, t, {
        type: "sawtooth", f0: N(n - 12), f1: N(n - 12) * (last ? 0.94 : 0.98),
        start: s, dur: d, peak: 0.26, attack: 0.04, lowpass: 1400, fm: last ? [5, 6] : undefined,
      });
      tone(ctx, out, t, { type: "triangle", f0: N(n - 12), start: s, dur: d, peak: 0.15, attack: 0.04, fm: last ? [5, 6] : undefined });
    }
    return 2.45;
  },

  // Neutral ending: two calm tones and a quizzical slide.
  draw(ctx, out, t) {
    tone(ctx, out, t, { type: "triangle", f0: N(64), dur: 0.5, peak: 0.3 });
    tone(ctx, out, t, { type: "triangle", f0: N(71), start: 0.25, dur: 0.5, peak: 0.25 });
    tone(ctx, out, t, { type: "triangle", f0: N(67), f1: N(69), start: 0.6, dur: 0.6, peak: 0.25, fm: [5, 4] });
    return 1.25;
  },

  // Subtle UI feedback.
  click(ctx, out, t) {
    tone(ctx, out, t, { f0: 1500, f1: 1000, dur: 0.05, peak: 0.3 });
    noise(ctx, out, t, { filter: "bandpass", f0: 3000, q: 2, dur: 0.02, peak: 0.15 });
    return 0.07;
  },
};

export const SFX_NAMES = Object.keys(SFX) as SFXName[];
