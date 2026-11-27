import { AudioEngine, DIALOGUES } from "./AudioEngine";

/** Shared singleton. Safe to import during SSR: nothing touches browser APIs until init()/emit()/speak(). */
export const audioEngine = new AudioEngine();

export { AudioEngine, DIALOGUES };
export { SFX_NAMES } from "./soundEffects";
export { DEFAULT_PROFILES } from "./speech";
export type * from "./types";
export default audioEngine;
