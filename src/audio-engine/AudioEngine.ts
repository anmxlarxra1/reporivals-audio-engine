import { MusicPlayer } from "./music";
import { SFX } from "./soundEffects";
import { SpeechManager } from "./speech";
import type {
  AudioEngineOptions,
  BattleEventMap,
  BattleEventName,
  SFXName,
  SpeakOptions,
  SpeakerId,
  SpeechPriority,
  VoiceProfile,
  VolumeChannel,
} from "./types";

/** Playful default lines. Jokes only — never presented as technical findings. */
export const DIALOGUES = {
  announcer: {
    start: ["Ladies and gentlemen... let the code chaos begin!"],
    critical: ["Ooh! That's going to need a hotfix!"],
    comeback: ["What a comeback! Somebody give this developer a raise!"],
    winner: ["And we have a winner! No debugging required!"],
  },
  warriorA: [
    "Oops! Did I just break your build?",
    "My code is clean. My attacks? Not so much!",
    "Have you tried turning yourself off and on again?",
    "Catch this... refactoring strike!",
  ],
  warriorB: [
    "Cute attack. Did ChatGPT write that?",
    "Your confidence is bigger than your test coverage!",
    "I have seen spaghetti with better architecture.",
    "Wait... that wasn't supposed to happen!",
  ],
};

const pick = <T,>(arr: readonly T[], last?: T): T => {
  const pool = arr.length > 1 ? arr.filter((x) => x !== last) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
};

type AnyPayload = BattleEventMap[BattleEventName] & Record<string, unknown>;

interface EventSpec {
  sfx?: SFXName;
  /** Default announcer line when no `dialogue` is supplied. Never invents technical findings. */
  line?: (p: AnyPayload) => string | undefined;
  /** Keep the announcer line even when `dialogue` is supplied (dialogue follows it). */
  callout?: boolean;
  priority: SpeechPriority;
  music?: "start" | "stop";
  /** Chance (0..1) that a warrior quip follows when no `dialogue` is supplied. */
  quip?: number;
}

const EVENTS: Record<BattleEventName, EventSpec> = {
  "scan:start": {
    sfx: "scan",
    priority: "normal",
    line: (p) => (p.repoA && p.repoB ? `Scanning ${p.repoA}... and ${p.repoB}!` : "Scanning the repositories!"),
  },
  "scan:complete": { sfx: "click", priority: "normal", line: () => "Scan complete! Two repositories. One arena." },
  "character:enter": {
    sfx: "entrance",
    priority: "normal",
    line: (p) => (p.name ? `${p.name} enters the arena!` : undefined),
  },
  "battle:start": {
    sfx: "battleStart",
    priority: "high",
    music: "start",
    line: (p) =>
      p.repoA && p.repoB
        ? `${p.repoA}... versus... ${p.repoB}! Ladies and gentlemen... let the code chaos begin!`
        : "Warriors, ready? Ladies and gentlemen... let the code chaos begin!",
  },
  "attack:normal": { sfx: "normalAttack", priority: "low", quip: 0.35 },
  "attack:critical": {
    sfx: "criticalHit",
    priority: "high",
    callout: true,
    line: (p) => (p.finding ? `Critical hit! ${p.finding}!` : `Critical hit! ${DIALOGUES.announcer.critical[0]}`),
  },
  "attack:ultimate": { sfx: "ultimate", priority: "critical", line: () => "Ultimate attack... unleashed!" },
  "defence:shield": { sfx: "shield", priority: "low", line: () => "Shield activated!" },
  "defence:break": {
    sfx: "shieldBreak",
    priority: "high",
    callout: true,
    line: (p) => (p.finding ? `The shield is down! ${p.finding}!` : "Ooh! The shield is shattered!"),
    quip: 0.5,
  },
  "character:damage": { sfx: "damage", priority: "low" },
  "character:low-health": {
    sfx: "lowHealth",
    priority: "normal",
    line: (p) => (p.target ? `Uh oh... ${p.target} is on the brink!` : "Uh oh... health is critical!"),
  },
  "character:transform": {
    sfx: "transform",
    priority: "high",
    line: (p) => (p.name ? `${p.name} is transforming! ${DIALOGUES.announcer.comeback[0]}` : `Transformation! ${DIALOGUES.announcer.comeback[0]}`),
  },
  "battle:victory": {
    sfx: "victory",
    priority: "critical",
    music: "stop",
    line: (p) => (p.winner ? `And we have a winner... ${p.winner}! No debugging required!` : DIALOGUES.announcer.winner[0]),
  },
  "battle:defeat": {
    sfx: "defeat",
    priority: "critical",
    music: "stop",
    line: () => "Build failed! Refactor... and return stronger.",
  },
  "battle:draw": { sfx: "draw", priority: "critical", music: "stop", line: () => "It's a draw! Both repositories... still compile." },
  "battle:end": { priority: "normal", music: "stop" },
  "ui:click": { sfx: "click", priority: "low" },
};

/** Minimum seconds between repeats of the same SFX (prevents machine-gun stacking). */
const SFX_COOLDOWN: Partial<Record<SFXName, number>> = { ultimate: 0.5, battleStart: 0.5, victory: 1, defeat: 1, draw: 1 };
const MAX_VOICES = 10;
/** Makeup gain so SFX sit at speech level; the master limiter catches peaks. */
const SFX_TRIM = 1.3;

interface Voice {
  gain: GainNode;
  end: number;
  name: SFXName;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duck: GainNode | null = null;
  /** Final output node (for metering/debugging). */
  private output: AudioNode | null = null;
  private musicPlayer: MusicPlayer | null = null;
  private speech: SpeechManager | null = null;
  private voices: Voice[] = [];
  private lastPlayed: Partial<Record<SFXName, number>> = {};
  private volumes: Record<VolumeChannel, number> = { master: 0.8, speech: 0.9, sfx: 0.7, music: 0.3 };
  private muted = false;
  private opts: AudioEngineOptions = {};
  private repoA?: string;
  private repoB?: string;
  private initPromise: Promise<boolean> | null = null;
  private lastQuip?: string;
  private initAttempted = false;
  private pendingProfiles: Partial<Record<SpeakerId, Partial<VoiceProfile>>> = {};

  constructor(options: AudioEngineOptions = {}) {
    this.opts = { synthMusic: true, autoMusic: true, ...options };
  }

  /** Update options (music url, log/error callbacks) at any time. */
  configure(options: AudioEngineOptions): void {
    this.opts = { ...this.opts, ...options };
    if (this.speech) this.speech.onLog = this.opts.onLog;
  }

  /** @internal Final output node, for metering/debugging only. */
  get _outputNode(): AudioNode | null {
    return this.output;
  }

  get initialized(): boolean {
    return this.ctx !== null;
  }

  get speechSupported(): boolean {
    return this.getSpeech().supported;
  }

  /**
   * Initialize audio. MUST be called from a user gesture (click/tap) because of autoplay policies.
   * Safe to call repeatedly; never creates duplicate AudioContexts. Resolves false (never throws) on failure.
   */
  init(options?: AudioEngineOptions): Promise<boolean> {
    if (options) this.configure(options);
    if (this.initPromise) return this.initPromise.then(() => this.resume());
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<boolean> {
    try {
      this.getSpeech().init();
      if (typeof window === "undefined") return false;
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.log("Web Audio API not supported");
        return false;
      }
      const ctx = new Ctor();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      // Final safety: soft clipper guarantees the output never hard-clips.
      const clip = ctx.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5);
      }
      clip.curve = curve;
      limiter.connect(clip).connect(ctx.destination);
      this.output = clip;

      this.master = ctx.createGain();
      this.master.connect(limiter);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.duck = ctx.createGain();
      this.duck.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.duck);
      this.ctx = ctx;
      this.musicPlayer = new MusicPlayer(ctx, this.musicBus);
      this.applyVolumes();
      await this.resume();
      this.log(`Audio initialized (${ctx.state}, ${ctx.sampleRate} Hz)`);
      return true;
    } catch (e) {
      this.fail(e);
      this.initPromise = null;
      return false;
    }
  }

  private async resume(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") await ctx.resume();
    } catch (e) {
      this.fail(e);
    }
    return ctx.state === "running";
  }

  /** Trigger audio for a battle event. Never throws. */
  emit<E extends BattleEventName>(event: E, payload?: BattleEventMap[E]): void {
    try {
      const spec = EVENTS[event];
      if (!spec) {
        this.log(`Unknown event: ${String(event)}`);
        return;
      }
      const p = (payload ?? {}) as AnyPayload;
      if ((event === "battle:start" || event === "scan:start") && (p.repoA || p.repoB)) {
        this.repoA = (p.repoA as string) ?? this.repoA;
        this.repoB = (p.repoB as string) ?? this.repoB;
      }
      this.log(`emit ${event}${payload ? " " + JSON.stringify(payload) : ""}`);

      if (spec.sfx) this.playSFX(spec.sfx);

      if (spec.music === "start" && this.opts.autoMusic) this.startMusic();
      if (spec.music === "stop") this.stopMusic(event === "battle:end" ? 1 : 2.5);

      if (p.speak === false) return;
      const dialogue = typeof p.dialogue === "string" ? p.dialogue.trim() : "";
      const line = spec.line?.(p);
      if (line && (!dialogue || spec.callout)) {
        this.speak(line, { speaker: "announcer", priority: spec.priority });
      }
      if (dialogue) {
        // Dialogue after a callout must not interrupt it: queue at "high" instead of re-interrupting.
        const priority: SpeechPriority = line && spec.callout && spec.priority === "critical" ? "high" : spec.priority;
        this.speak(dialogue, { speaker: p.speaker ?? this.inferSpeaker(p), priority });
      } else if (spec.quip && this.opts.quips !== false && Math.random() < spec.quip) {
        let who = p.speaker ?? this.inferSpeaker(p);
        if (event === "defence:break" && p.defender) who = p.defender === this.repoB ? "warriorB" : p.defender === this.repoA ? "warriorA" : "warriorB";
        if (who === "announcer") who = Math.random() < 0.5 ? "warriorA" : "warriorB";
        const line = event === "defence:break" ? DIALOGUES.warriorB[3] : pick(DIALOGUES[who], this.lastQuip);
        this.lastQuip = line;
        this.speak(line, { speaker: who, priority: "low" });
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** Speak arbitrary text (e.g. AI-generated dialogue). Never throws. */
  speak(text: string, options: SpeakOptions = {}): boolean {
    try {
      const sp = this.getSpeech();
      sp.volume = this.muted ? 0 : this.volumes.speech * this.volumes.master;
      return sp.speak(text, options);
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  stopSpeech(): void {
    this.speech?.cancel();
  }

  /** Play a single sound effect by name. Never throws. */
  playSFX(name: SFXName): void {
    try {
      const fx = SFX[name];
      if (!fx || this.muted) return;
      if (!this.ctx) {
        // Not initialized yet (e.g. a button clicked before init()): init lazily, then play once.
        if (typeof window !== "undefined" && !this.initAttempted) {
          this.initAttempted = true;
          void this.init().then((ok) => ok && this.playSFX(name));
        } else this.log(`playSFX("${name}") ignored: call audioEngine.init() from a user gesture first`);
        return;
      }
      const ctx = this.ctx;
      if (!this.sfxBus) return;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const cd = SFX_COOLDOWN[name] ?? 0.04;
      if (now - (this.lastPlayed[name] ?? -Infinity) < cd) return;
      this.lastPlayed[name] = now;

      this.voices = this.voices.filter((v) => v.end > now);
      // Too many sounds: fade out the oldest to keep the mix clean.
      while (this.voices.length >= MAX_VOICES) this.killVoice(this.voices.shift()!, 0.05);
      // Avoid identical sounds stacking: duck the previous instance of the same sound.
      const same = this.voices.filter((v) => v.name === name);
      if (same.length >= 2) {
        this.killVoice(same[0], 0.05);
        this.voices = this.voices.filter((v) => v !== same[0]);
      }

      const gain = ctx.createGain();
      gain.gain.value = SFX_TRIM;
      gain.connect(this.sfxBus);
      const t = now + 0.01;
      const dur = fx(ctx, gain, t);
      const voice: Voice = { gain, end: t + dur + 0.1, name };
      this.voices.push(voice);
    } catch (e) {
      this.fail(e);
    }
  }

  private killVoice(v: Voice, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + fade);
      // Disconnect after the fade; scheduled sources stop themselves and are GC'd.
      setTimeout(() => {
        try {
          v.gain.disconnect();
        } catch {
          /* ignore */
        }
      }, fade * 1000 + 50);
    } catch {
      /* ignore */
    }
  }

  // --- Music -----------------------------------------------------------------

  /** Start looping background music. Uses `url`, configured `musicUrl`, or the synthesized loop. */
  startMusic(url?: string, fadeIn = 1.5): void {
    try {
      const src = url ?? this.opts.musicUrl;
      if (!this.musicPlayer) return;
      if (!src && !this.opts.synthMusic) return;
      if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => {});
      this.musicPlayer.start(src, fadeIn);
    } catch (e) {
      this.fail(e);
    }
  }

  stopMusic(fadeOut = 1.5): void {
    try {
      this.musicPlayer?.stop(fadeOut);
    } catch (e) {
      this.fail(e);
    }
  }

  get musicPlaying(): boolean {
    return this.musicPlayer?.playing ?? false;
  }

  // --- Volume / mute -----------------------------------------------------------

  setVolume(channel: VolumeChannel, value: number): void {
    if (!(channel in this.volumes)) return;
    this.volumes[channel] = Math.min(1, Math.max(0, Number(value) || 0));
    this.applyVolumes();
  }

  getVolume(channel: VolumeChannel): number {
    return this.volumes[channel];
  }

  mute(): void {
    this.muted = true;
    this.speech?.cancel();
    this.applyVolumes();
  }

  unmute(): void {
    this.muted = false;
    this.applyVolumes();
    void this.resume();
  }

  toggleMute(): boolean {
    if (this.muted) this.unmute();
    else this.mute();
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolumes(): void {
    if (this.speech) this.speech.volume = this.muted ? 0 : this.volumes.speech * this.volumes.master;
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ctx.currentTime;
    const set = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(v, t + 0.05);
    };
    set(this.master, this.muted ? 0 : this.volumes.master);
    set(this.sfxBus, this.volumes.sfx);
    set(this.musicBus, this.volumes.music);
  }

  /** Lower music while someone is speaking. */
  private setDuck(speaking: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const t = ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(this.duck.gain.value, t);
    this.duck.gain.linearRampToValueAtTime(speaking ? 0.3 : 1, t + (speaking ? 0.15 : 0.6));
  }

  // --- Voices ----------------------------------------------------------------

  getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.getSpeech().getVoices();
  }

  setVoice(speaker: SpeakerId, voiceName?: string): void {
    this.getSpeech().setVoice(speaker, voiceName);
  }

  setVoiceProfile(speaker: SpeakerId, profile: Partial<VoiceProfile>): void {
    this.pendingProfiles[speaker] = { ...this.pendingProfiles[speaker], ...profile };
    this.getSpeech().setProfile(speaker, profile);
  }

  getVoiceFor(speaker: SpeakerId): string | null {
    return this.getSpeech().getAssignedVoice(speaker);
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Stop all sounds, speech and music immediately. Engine stays usable. */
  stopAll(): void {
    try {
      this.speech?.cancel();
      this.musicPlayer?.stop(0.15);
      for (const v of this.voices) this.killVoice(v, 0.05);
      this.voices = [];
      this.lastPlayed = {};
    } catch (e) {
      this.fail(e);
    }
  }

  /** Release everything (AudioContext, speech listeners, timers). `init()` may be called again afterwards. */
  dispose(): void {
    try {
      this.stopAll();
      this.musicPlayer?.stop(0);
      this.speech?.dispose();
      const ctx = this.ctx;
      this.ctx = null;
      this.master = this.sfxBus = this.musicBus = this.duck = null;
      this.output = null;
      this.musicPlayer = null;
      this.speech = null;
      this.initPromise = null;
      this.initAttempted = false;
      this.repoA = this.repoB = undefined;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    } catch (e) {
      this.fail(e);
    }
  }

  // --- internals -------------------------------------------------------------

  private getSpeech(): SpeechManager {
    if (!this.speech) {
      const sp = new SpeechManager();
      sp.onLog = (m) => this.log(m);
      sp.onSpeakingChange = (s) => this.setDuck(s);
      for (const k of Object.keys(this.pendingProfiles) as SpeakerId[]) sp.setProfile(k, this.pendingProfiles[k]!);
      sp.volume = this.muted ? 0 : this.volumes.speech * this.volumes.master;
      this.speech = sp;
    }
    return this.speech;
  }

  private inferSpeaker(p: AnyPayload): SpeakerId {
    const who = (p.attacker ?? p.name ?? p.defender ?? p.winner) as string | undefined;
    if (who && who === this.repoA) return "warriorA";
    if (who && who === this.repoB) return "warriorB";
    return "announcer";
  }

  private log(msg: string): void {
    try {
      this.opts.onLog?.(msg);
    } catch {
      /* ignore */
    }
  }

  private fail(e: unknown): void {
    try {
      this.opts.onError?.(e);
      this.log(`[audio error] ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      /* ignore */
    }
  }
}
