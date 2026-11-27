# Integrating the audio engine into RepoRivals

Target time: ~10 minutes once you know where your battle events fire.

## 1. Copy files

Copy this **one folder** into the main app, e.g. to `src/lib/audio-engine/`:

```
src/audio-engine/
├── index.ts          ← entry point (exports audioEngine)
├── AudioEngine.ts
├── speech.ts
├── soundEffects.ts
├── music.ts
└── types.ts
```

**Dependencies: none.** No npm packages, no API keys, no server. It uses browser APIs only
(Web Audio, Speech Synthesis, HTMLAudioElement). Plain TypeScript, works with Vite, Next.js, CRA, etc.

## 2. Import

```ts
import { audioEngine } from "@/lib/audio-engine"; // adjust path
import type { BattleEventName, SpeakerId } from "@/lib/audio-engine";
```

Importing is SSR-safe: no `window`, `AudioContext` or `speechSynthesis` is touched until you call a method.
In the Next.js App Router, call it only from client components (`"use client"`).

## 3. Initialize from the Start Battle button

Browsers block audio until a user gesture. Call `init()` inside the click handler:

```tsx
"use client";
import { audioEngine } from "@/lib/audio-engine";

async function onStartBattle() {
  await audioEngine.init();              // safe to call every time; no duplicate contexts
  audioEngine.emit("battle:start", { repoA: repoA.name, repoB: repoB.name });
  startBattle();                          // your existing logic
}
```

`init()` never throws; it resolves `false` if audio is unavailable. All other methods are no-ops in that case.

## 4. Map your existing battle events

The engine only **reacts** — it never decides damage, health, outcomes or winners.
Add one `emit` line next to each existing handler:

```ts
// where your app already handles these:
onScanStart     → audioEngine.emit("scan:start", { repoA, repoB });
onScanDone      → audioEngine.emit("scan:complete");
onWarriorEnter  → audioEngine.emit("character:enter", { name: repo.name, side: "A" });
onAttack(hit)   → audioEngine.emit(hit.critical ? "attack:critical" : "attack:normal", {
                    attacker: hit.attacker, target: hit.target,
                    finding: hit.finding,        // only real findings from your analysis
                    dialogue: hit.aiDialogue,    // optional AI line
                  });
onUltimate      → audioEngine.emit("attack:ultimate", { attacker, dialogue });
onShieldUp      → audioEngine.emit("defence:shield", { defender });
onShieldBroken  → audioEngine.emit("defence:break", { defender, finding });
onDamage        → audioEngine.emit("character:damage", { target, amount });
onLowHealth     → audioEngine.emit("character:low-health", { target });
onTransform     → audioEngine.emit("character:transform", { name });
onWinner(w)     → audioEngine.emit("battle:victory", { winner: w.name });
onLose          → audioEngine.emit("battle:defeat", { loser });
onDraw          → audioEngine.emit("battle:draw");
onBattleOver    → audioEngine.emit("battle:end");
anyButton       → audioEngine.emit("ui:click");
```

Every payload is optional. Add `speak: false` to any payload to play only the sound effect.

## 5. Connect AI-generated dialogue

```ts
audioEngine.speak(line.text, { speaker: line.side === "A" ? "warriorA" : "warriorB" });

// options: speaker "announcer" | "warriorA" | "warriorB"
//          priority "low" | "normal" | "high" | "critical"  (critical interrupts everything)
//          interrupt: true, rate, pitch, volume, voiceName
```

Or pass it as `dialogue` in an event payload. If `speaker` is omitted, the engine infers
warriorA/warriorB by matching `attacker`/`name`/`winner` against the `repoA`/`repoB` from `battle:start`.

Speech never overlaps: lines are queued, outdated low-priority lines are dropped, and
`attack:ultimate` / `battle:victory|defeat|draw` interrupt older commentary.

Default announcer lines never invent technical details — findings are spoken only if you pass `finding`.

## 6. Volume and mute

```ts
audioEngine.setVolume("master", 0.8);  // master | speech | sfx | music, range 0..1
audioEngine.getVolume("sfx");
audioEngine.mute(); audioEngine.unmute(); audioEngine.toggleMute(); audioEngine.isMuted;
audioEngine.stopSpeech();
audioEngine.startMusic();              // synthesized loop; auto-starts on battle:start
audioEngine.startMusic("/audio/battle.mp3"); // or your own local file (put it in /public)
audioEngine.stopMusic(1.5);            // fade-out seconds; auto on victory/defeat/draw/end
audioEngine.configure({ musicUrl: "/audio/battle.mp3", autoMusic: true, onLog: console.log });
```

Music automatically ducks while anyone is speaking.

Voices: `audioEngine.setVoice("announcer", "Daniel")`,
`audioEngine.setVoiceProfile("warriorB", { pitch: 0.6, rate: 0.8 })`,
`audioEngine.getAvailableVoices()`.

## 7. Cleanup when leaving the battle page

```tsx
"use client";
import { useEffect } from "react";
import { audioEngine } from "@/lib/audio-engine";

export function BattleAudio() {
  useEffect(() => () => audioEngine.stopAll(), []); // or dispose() to fully release
  return null;
}
```

- `stopAll()` — stops speech, SFX, music, keeps the engine ready (use between battles).
- `dispose()` — also closes the AudioContext; a later `init()` reinitializes cleanly.

## 8. Event reference

| Event | Sound | Default announcer line (if no `dialogue`) | Payload (all optional) |
|---|---|---|---|
| `scan:start` | digital scan | "Scanning {repoA}... and {repoB}!" | repoA, repoB |
| `scan:complete` | UI blip | "Scan complete! Two repositories. One arena." | |
| `character:enter` | rising energy | "{name} enters the arena!" (only if name) | name, side |
| `battle:start` | arcade bell + music | "{A}... versus... {B}! Ladies and gentlemen... let the code chaos begin!" | repoA, repoB |
| `attack:normal` | cartoon swoosh | — (35% chance of a warrior quip) | attacker, target |
| `attack:critical` | arcade impact | "Critical hit! {finding}!" or "Critical hit! Ooh! That's going to need a hotfix!", then dialogue | attacker, target, finding |
| `attack:ultimate` | buildup + boom | "Ultimate attack... unleashed!" (interrupts) | attacker, target, finding |
| `defence:shield` | magic shimmer | "Shield activated!" | defender |
| `defence:break` | glass shatter | "The shield is down! {finding}!" / "Ooh! The shield is shattered!" (+ 50% defender quip) | defender, finding |
| `character:damage` | comedic bonk | — | target, amount |
| `character:low-health` | heartbeat | "Uh oh... {target} is on the brink!" | target |
| `character:transform` | magic power-up | "{name} is transforming! What a comeback! Somebody give this developer a raise!" | name |
| `battle:victory` | chiptune fanfare, music fades | "And we have a winner... {winner}! No debugging required!" | winner, loser |
| `battle:defeat` | sad trombone | "Build failed! Refactor... and return stronger." | loser |
| `battle:draw` | neutral tones | "It's a draw! Both repositories... still compile." | |
| `battle:end` | music fades | — | |
| `ui:click` | click | — | |

All events also accept `dialogue`, `speaker`, `speak: false`.

Warrior quips (jokes, never technical claims) come from `DIALOGUES` (exported). Disable with
`audioEngine.configure({ quips: false })`. Supplying `dialogue` always replaces default lines and quips.

SFX names for `playSFX()`: `scan, entrance, battleStart, normalAttack, criticalHit, shield, shieldBreak,
damage, ultimate, lowHealth, transform, victory, defeat, draw, click`.

## 9. Troubleshooting

- **No sound at all** → `init()` must run inside a click/tap handler. Check `await audioEngine.init()` returns `true`. (`playSFX`/`emit` before `init()` now lazily initializes once, but only works if that call is itself inside a user gesture.)
- **Voices sound robotic (macOS)** → install a natural voice: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → e.g. Ava/Zoe/Evan/Nathan (Premium or Enhanced). The engine prefers Premium/Enhanced/Natural voices automatically and skips novelty voices (Fred, Zarvox, …).
- **SFX works, no voice** → the browser/OS has no speech voices (some Linux/Chromium builds). `audioEngine.speechSupported` tells you; the battle still runs.
- **All warriors sound alike** → the OS has only one voice; pitch/rate still differ. Pick voices with `setVoice()`.
- **First line silent in Chrome** → voices load asynchronously; the engine retries voice lookup on each line.
- **Speech stops mid-sentence in Chrome** → Chrome cuts very long utterances (~15 s). Keep AI lines short (1–2 sentences).
- **Sound stops after tab switch (iOS Safari)** → the engine resumes the context on the next event; call `init()` again from a tap if needed.
- **Music file doesn't play** → use a same-origin path (e.g. `/public/audio/battle.mp3` → `"/audio/battle.mp3"`).
- **Next.js "window is not defined"** → only call engine methods in client components/effects, never during render on the server. Importing is fine.
