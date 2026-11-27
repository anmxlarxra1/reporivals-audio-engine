export type SpeakerId = "announcer" | "warriorA" | "warriorB";

export type VolumeChannel = "master" | "speech" | "sfx" | "music";

export type SFXName =
  | "scan"
  | "entrance"
  | "battleStart"
  | "normalAttack"
  | "criticalHit"
  | "shield"
  | "shieldBreak"
  | "damage"
  | "ultimate"
  | "lowHealth"
  | "transform"
  | "victory"
  | "defeat"
  | "draw"
  | "click";

/** Speech priority. Higher priority interrupts lower-priority/outdated speech. */
export type SpeechPriority = "low" | "normal" | "high" | "critical";

export interface VoiceProfile {
  /** Preferred voice name (exact or partial match). Falls back automatically. */
  voiceName?: string;
  lang?: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface SpeakOptions {
  speaker?: SpeakerId;
  priority?: SpeechPriority;
  /** Cancel current + queued speech before speaking. Implied by priority "critical". */
  interrupt?: boolean;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceName?: string;
}

/** Common optional fields any event may carry. */
export interface BaseEventPayload {
  /** Custom line to speak (e.g. AI-generated). Spoken instead of the default line. */
  dialogue?: string;
  /** Who speaks `dialogue`. Defaults depend on event. */
  speaker?: SpeakerId;
  /** Set false to play only SFX for this event. */
  speak?: boolean;
}

export interface BattleEventMap {
  "scan:start": BaseEventPayload & { repoA?: string; repoB?: string };
  "scan:complete": BaseEventPayload & { repoA?: string; repoB?: string };
  "character:enter": BaseEventPayload & { name?: string; side?: "A" | "B" };
  "battle:start": BaseEventPayload & { repoA?: string; repoB?: string };
  "attack:normal": BaseEventPayload & { attacker?: string; target?: string };
  "attack:critical": BaseEventPayload & { attacker?: string; target?: string; finding?: string };
  "attack:ultimate": BaseEventPayload & { attacker?: string; target?: string; finding?: string };
  "defence:shield": BaseEventPayload & { defender?: string };
  "defence:break": BaseEventPayload & { defender?: string; finding?: string };
  "character:damage": BaseEventPayload & { target?: string; amount?: number };
  "character:low-health": BaseEventPayload & { target?: string };
  "character:transform": BaseEventPayload & { name?: string };
  "battle:victory": BaseEventPayload & { winner?: string; loser?: string };
  "battle:defeat": BaseEventPayload & { loser?: string };
  "battle:draw": BaseEventPayload;
  "battle:end": BaseEventPayload;
  "ui:click": BaseEventPayload;
}

export type BattleEventName = keyof BattleEventMap;

export interface AudioEngineOptions {
  /** Path/URL to an optional local music file. If omitted, a synthesized loop is used. */
  musicUrl?: string;
  /** Use built-in synthesized battle loop when no musicUrl. Default true. */
  synthMusic?: boolean;
  /** Auto start music on battle:start. Default true. */
  autoMusic?: boolean;
  /** Speak occasional playful warrior quips when no dialogue is supplied. Default true. */
  quips?: boolean;
  /** Called on internal errors (never thrown). */
  onError?: (err: unknown) => void;
  /** Called for every handled event / speech (useful for logs). */
  onLog?: (msg: string) => void;
}
