import type { SpeakOptions, SpeakerId, SpeechPriority, VoiceProfile } from "./types";

const PRIORITY: Record<SpeechPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };
/** Queued low/normal lines older than this are considered outdated and skipped. */
const STALE_MS: Record<SpeechPriority, number> = { low: 3500, normal: 6000, high: 15000, critical: 30000 };
const MAX_QUEUE = 4;

export const DEFAULT_PROFILES: Record<SpeakerId, VoiceProfile> = {
  // Energetic, friendly arcade commentator.
  announcer: { rate: 1.0, pitch: 1.08, volume: 1 },
  // Playful hero: cheerful, mischievous, slightly higher.
  warriorA: { rate: 1.06, pitch: 1.22, volume: 1 },
  // Funny rival: calm, sarcastic, warm and slightly deeper.
  warriorB: { rate: 0.94, pitch: 0.9, volume: 1 },
};

/** Preferred voice names per profile (partial, case-insensitive). First available wins. */
const PREFERRED: Record<SpeakerId, string[]> = {
  announcer: ["Evan", "Nathan", "Tom", "Daniel", "Aaron", "Microsoft Andrew", "Microsoft Guy", "Microsoft Davis", "Google UK English Male", "Alex"],
  warriorA: ["Ava", "Zoe", "Samantha", "Allison", "Microsoft Ana", "Microsoft Jenny", "Microsoft Aria", "Google US English", "Susan"],
  warriorB: ["Oliver", "Arthur", "Malcolm", "Lee", "Rishi", "Microsoft Christopher", "Microsoft Ryan", "Microsoft Brian", "Google UK English Male", "Karen", "Moira"],
};

/** macOS novelty / legacy formant voices that sound robotic. Never auto-picked. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|fred|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/** Higher = more natural sounding. */
function quality(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let q = 0;
  if (n.includes("premium")) q += 40;
  else if (n.includes("enhanced")) q += 30;
  if (n.includes("natural") || n.includes("neural") || n.includes("online")) q += 30;
  if (n.startsWith("google")) q += 12;
  if (/^en[-_](us|gb|au|ie|ca)/i.test(v.lang)) q += 4;
  return q;
}

interface QueueItem {
  id: number;
  text: string;
  opts: SpeakOptions;
  priority: number;
  priorityName: SpeechPriority;
  queuedAt: number;
}

function synth(): SpeechSynthesis | null {
  try {
    const s = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    return s && typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function"
      ? s
      : null;
  } catch {
    return null;
  }
}

export class SpeechManager {
  profiles: Record<SpeakerId, VoiceProfile> = {
    announcer: { ...DEFAULT_PROFILES.announcer },
    warriorA: { ...DEFAULT_PROFILES.warriorA },
    warriorB: { ...DEFAULT_PROFILES.warriorB },
  };
  /** 0..1 multiplier supplied by the engine (speech * master, 0 when muted). */
  volume = 1;
  onSpeakingChange?: (speaking: boolean) => void;
  onLog?: (msg: string) => void;

  private queue: QueueItem[] = [];
  private current: QueueItem | null = null;
  private nextId = 1;
  private voices: SpeechSynthesisVoice[] = [];
  private assigned: Partial<Record<SpeakerId, SpeechSynthesisVoice | null>> = {};
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private readonly handleVoices = () => this.loadVoices();

  get supported(): boolean {
    return synth() !== null;
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  init(): void {
    const s = synth();
    if (!s) return;
    this.loadVoices();
    if (!this.listening) {
      try {
        s.addEventListener?.("voiceschanged", this.handleVoices);
        this.listening = true;
      } catch {
        /* ignore */
      }
    }
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  /** Force a voice for a speaker by (partial) name. Pass undefined to auto-pick. */
  setVoice(speaker: SpeakerId, voiceName?: string): void {
    this.profiles[speaker].voiceName = voiceName;
    delete this.assigned[speaker];
  }

  setProfile(speaker: SpeakerId, profile: Partial<VoiceProfile>): void {
    this.profiles[speaker] = { ...this.profiles[speaker], ...profile };
    if ("voiceName" in profile || "lang" in profile) delete this.assigned[speaker];
  }

  getAssignedVoice(speaker: SpeakerId): string | null {
    return this.pickVoice(speaker)?.name ?? null;
  }

  speak(text: string, opts: SpeakOptions = {}): boolean {
    const clean = String(text ?? "").trim();
    if (!clean) return false;
    const s = synth();
    if (!s) {
      this.onLog?.(`[speech unsupported] ${clean}`);
      return false;
    }
    if (this.volume <= 0) return false; // muted: never queue stale lines
    const priorityName = opts.priority ?? "normal";
    const item: QueueItem = {
      id: this.nextId++,
      text: clean,
      opts,
      priority: PRIORITY[priorityName],
      priorityName,
      queuedAt: Date.now(),
    };

    const interrupt =
      opts.interrupt === true ||
      priorityName === "critical" ||
      (this.current !== null && item.priority >= PRIORITY.high && item.priority > this.current.priority);

    if (interrupt) {
      // Drop outdated commentary: anything queued that is not more important than the new line.
      this.queue = this.queue.filter((q) => q.priority > item.priority && opts.interrupt !== true);
      this.cancelCurrent();
    }

    // Insert by priority (stable within same priority).
    const idx = this.queue.findIndex((q) => q.priority < item.priority);
    if (idx === -1) this.queue.push(item);
    else this.queue.splice(idx, 0, item);

    // Bound the queue: drop lowest-priority, oldest items.
    while (this.queue.length > MAX_QUEUE) {
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[worst].priority) worst = i;
      }
      this.queue.splice(worst, 1);
    }

    this.pump(interrupt ? 60 : 0);
    return true;
  }

  /** Cancel current speech and clear the queue. */
  cancel(): void {
    this.queue = [];
    this.cancelCurrent();
  }

  dispose(): void {
    this.cancel();
    const s = synth();
    if (s && this.listening) {
      try {
        s.removeEventListener?.("voiceschanged", this.handleVoices);
      } catch {
        /* ignore */
      }
    }
    this.listening = false;
  }

  // ---------------------------------------------------------------------------

  private loadVoices(): void {
    const s = synth();
    if (!s) return;
    try {
      this.voices = s.getVoices() ?? [];
    } catch {
      this.voices = [];
    }
    this.assigned = {};
  }

  private pickVoice(speaker: SpeakerId): SpeechSynthesisVoice | null {
    if (speaker in this.assigned) return this.assigned[speaker] ?? null;
    if (!this.voices.length) this.loadVoices();
    const voices = this.voices;
    if (!voices.length) return null; // browser default voice; pitch/rate still differentiate
    const profile = this.profiles[speaker];
    const lang = (profile.lang ?? "en").toLowerCase();
    const english = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
    const pool = english.length ? english : voices;
    const find = (name: string) => pool.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));

    let voice: SpeechSynthesisVoice | undefined;
    if (profile.voiceName) voice = voices.find((v) => v.name === profile.voiceName) ?? find(profile.voiceName);
    if (!voice) {
      // Assign other speakers first (fixed order) so all three get distinct voices.
      const order: SpeakerId[] = ["announcer", "warriorA", "warriorB"];
      for (const other of order.slice(0, order.indexOf(speaker))) if (!(other in this.assigned)) this.pickVoice(other);
      const taken = new Set(
        (Object.keys(this.assigned) as SpeakerId[]).map((k) => this.assigned[k]?.name).filter(Boolean),
      );
      const prefs = PREFERRED[speaker].map((x) => x.toLowerCase());
      const candidates = pool.filter((v) => !NOVELTY.test(v.name) && !taken.has(v.name));
      let best = -Infinity;
      for (const v of candidates) {
        const name = v.name.toLowerCase();
        const idx = prefs.findIndex((p) => name === p || name.startsWith(p + " ") || name.includes(p));
        const score = idx >= 0 ? quality(v) + 30 - idx : quality(v) / 2;
        if (score > best) {
          best = score;
          voice = v;
        }
      }
      if (!voice) voice = pool.find((v) => !NOVELTY.test(v.name)) ?? pool[order.indexOf(speaker) % pool.length];
    }
    this.assigned[speaker] = voice ?? null;
    return voice ?? null;
  }

  private cancelCurrent(): void {
    this.clearTimers();
    const wasSpeaking = this.current !== null;
    this.current = null;
    const s = synth();
    try {
      s?.cancel();
    } catch {
      /* ignore */
    }
    if (wasSpeaking && this.queue.length === 0) this.onSpeakingChange?.(false);
  }

  private clearTimers(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.watchdog = null;
    this.startTimer = null;
  }

  private pump(delay = 0): void {
    if (this.current || this.startTimer) return;
    if (delay > 0) {
      // Chrome can drop an utterance spoken immediately after cancel().
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        this.pump();
      }, delay);
      return;
    }
    const s = synth();
    if (!s) return;

    let item: QueueItem | undefined;
    const now = Date.now();
    while ((item = this.queue.shift())) {
      if (now - item.queuedAt <= STALE_MS[item.priorityName]) break;
      this.onLog?.(`[speech skipped: outdated] ${item.text}`);
    }
    if (!item) {
      this.onSpeakingChange?.(false);
      return;
    }

    const speaker = item.opts.speaker ?? "announcer";
    const profile = this.profiles[speaker] ?? this.profiles.announcer;
    const Utter = (globalThis as unknown as { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance;
    const u = new Utter(item.text);
    const voice = item.opts.voiceName
      ? this.voices.find((v) => v.name.toLowerCase().includes(item!.opts.voiceName!.toLowerCase())) ?? null
      : this.pickVoice(speaker);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    // Tiny per-line variation keeps repeated lines from sounding identical/robotic.
    const jitter = () => 1 + (Math.random() - 0.5) * 0.04;
    u.rate = clamp(item.opts.rate ?? profile.rate * jitter(), 0.1, 3);
    u.pitch = clamp(item.opts.pitch ?? profile.pitch * jitter(), 0, 2);
    u.volume = clamp((item.opts.volume ?? profile.volume) * this.volume, 0, 1);

    const active = item;
    this.current = active;
    const done = () => {
      if (this.current !== active) return; // stale callback from a cancelled utterance
      this.clearTimers();
      this.current = null;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;

    // Watchdog in case the browser never fires onend.
    const est = 2500 + (item.text.length * 110) / u.rate;
    this.watchdog = setTimeout(() => {
      if (this.current === active) {
        this.onLog?.("[speech watchdog] forcing next line");
        try {
          s.cancel();
        } catch {
          /* ignore */
        }
        done();
      }
    }, est);

    this.onLog?.(`[speech:${speaker}] ${item.text}`);
    this.onSpeakingChange?.(true);
    try {
      if (s.paused) s.resume();
      s.speak(u);
    } catch (e) {
      this.onLog?.(`[speech error] ${String(e)}`);
      done();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}
