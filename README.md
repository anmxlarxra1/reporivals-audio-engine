# RepoRivals Audio Engine

Plug-and-play battle audio for RepoRivals: announcer + two warrior voices (Web Speech API),
15 original synthesized sound effects (Web Audio API) and an optional synthesized battle loop.
Zero runtime dependencies, no API keys, no backend, SSR-safe.

## Run the playground

```bash
npm install
npm run dev        # http://localhost:5173
```

Click **Enable Audio** first, then **Start Demo Battle** or any individual button.

## Scripts

- `npm run dev` — playground
- `npm run build` — typecheck + production build of the playground
- `npm run typecheck`
- `npm test` — Node checks: SSR-safe import, speech queue/priority/mute/cleanup (mocked speechSynthesis)

## Usage

```ts
import { audioEngine } from "./audio-engine";

await audioEngine.init();                                   // from a click
audioEngine.emit("battle:start", { repoA: "Alpha", repoB: "Beta" });
audioEngine.emit("attack:critical", { attacker: "Alpha", finding: "High cyclomatic complexity", dialogue: "Your own logic has become your enemy!" });
audioEngine.speak("Your code cannot defeat me!", { speaker: "warriorA" });
audioEngine.playSFX("criticalHit");
audioEngine.setVolume("music", 0.3);
audioEngine.stopAll();
```

The portable engine is `src/audio-engine/` (no imports from the playground). See [INTEGRATION.md](INTEGRATION.md).
