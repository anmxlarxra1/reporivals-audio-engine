// Node-side checks: SSR-safe import + speech queue logic with a mocked speechSynthesis.
import assert from "node:assert/strict";
import { audioEngine, AudioEngine } from "../src/audio-engine";

const g = globalThis as any;
assert.equal(typeof g.window, "undefined", "running without window");

// 1. SSR: importing + calling API without browser must not throw.
assert.equal(await audioEngine.init(), false);
audioEngine.emit("battle:start", { repoA: "A", repoB: "B" });
audioEngine.emit("attack:critical", { finding: "x", dialogue: "y" });
audioEngine.playSFX("criticalHit");
assert.equal(audioEngine.speak("hello"), false);
audioEngine.setVolume("master", 0.5);
audioEngine.mute(); audioEngine.unmute(); audioEngine.stopAll(); audioEngine.dispose();
console.log("ok  SSR-safe import and no-op API without browser");

// 2. Mock speech synthesis.
const spoken: any[] = [];
let current: any = null;
class Utter { text: string; onend: any; onerror: any; voice: any; lang = ""; rate = 1; pitch = 1; volume = 1; constructor(t: string) { this.text = t; } }
g.SpeechSynthesisUtterance = Utter;
g.speechSynthesis = {
  paused: false,
  getVoices: () => [
    { name: "Fred", lang: "en-US" }, { name: "Daniel", lang: "en-GB" }, { name: "Samantha", lang: "en-US" },
    { name: "Ava (Premium)", lang: "en-US" }, { name: "Karen", lang: "en-AU" }, { name: "Zarvox", lang: "en-US" },
  ],
  speak(u: any) { spoken.push(u); current = u; },
  cancel() { const c = current; current = null; c?.onerror?.({}); },
  resume() {}, addEventListener() {}, removeEventListener() {},
};
const finish = () => { const c = current; current = null; c?.onend?.({}); };
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const e = new AudioEngine();
const logs: string[] = [];
e.configure({ onLog: (m) => logs.push(m), quips: false });
await e.init(); // no window -> false, but speech initialized

// Voice profiles get distinct voices.
const va = e.getVoiceFor("announcer"), wa = e.getVoiceFor("warriorA"), wb = e.getVoiceFor("warriorB");
assert.deepEqual([va, wa, wb], ["Daniel", "Ava (Premium)", "Karen"]);
console.log("ok  distinct natural voices assigned (premium preferred, novelty skipped):", va, wa, wb);

// No overlap: queued lines play one at a time.
e.speak("one"); e.speak("two"); e.speak("three", { speaker: "warriorA" });
await tick();
assert.equal(spoken.length, 1); assert.equal(spoken[0].text, "one");
finish(); await tick();
assert.equal(spoken.length, 2); assert.equal(spoken[1].text, "two");
console.log("ok  speech queue prevents overlap");

// Critical interrupts current speech and clears lower-priority queue.
e.speak("stale commentary", { priority: "low" });
e.emit("attack:ultimate", { dialogue: "Ultimate attack unleashed!" });
await tick(120);
const last = spoken[spoken.length - 1];
assert.equal(last.text, "Ultimate attack unleashed!");
finish(); await tick();
assert.equal(spoken[spoken.length - 1].text, "Ultimate attack unleashed!", "stale lines were dropped");
assert.equal(current, null);
console.log("ok  critical event interrupts and drops outdated commentary");

// Critical attack: announcer callout then warrior dialogue (speaker inferred from repo names).
e.emit("battle:start", { repoA: "Alpha", repoB: "Beta", speak: false });
e.emit("attack:critical", { attacker: "Alpha", finding: "High cyclomatic complexity", dialogue: "Your logic is your enemy!" });
await tick(120);
assert.equal(current.text, "Critical hit! High cyclomatic complexity!");
finish(); await tick();
assert.equal(current.text, "Your logic is your enemy!");
assert.ok(Math.abs(current.pitch - 1.22) < 0.03, "warriorA profile pitch");
finish(); await tick();
console.log("ok  critical hit callout + inferred warriorA dialogue");

// No fabricated findings: normal attack speaks nothing.
const before = spoken.length;
e.emit("attack:normal"); await tick();
assert.equal(spoken.length, before);
console.log("ok  attack:normal speaks nothing without dialogue");

// Quips: enabled -> warrior lines from the pool, spoken by inferred side.
e.configure({ quips: true });
const r = Math.random; Math.random = () => 0.1;
e.emit("attack:normal", { attacker: "Beta" }); await tick();
Math.random = r;
assert.equal(current.pitch < 1, true, "warriorB speaks");
assert.ok(current.text.length > 0); console.log("ok  quip:", current.text); finish(); await tick();
e.configure({ quips: false });

// Volume applied to utterances.
e.setVolume("master", 0.5); e.setVolume("speech", 0.5);
e.speak("vol"); await tick();
assert.equal(current.volume, 0.25); finish(); await tick();
console.log("ok  speech volume = speech * master");

// Mute cancels and blocks speech.
e.speak("long line"); await tick();
e.mute();
assert.equal(current, null);
assert.equal(e.speak("muted"), false);
e.unmute();
assert.equal(e.speak("back"), true); await tick(); finish(); await tick();
console.log("ok  mute cancels/blocks speech; unmute restores");

// Rapid events do not grow the queue unbounded.
for (let i = 0; i < 50; i++) e.speak("spam " + i, { priority: "low" });
await tick();
let count = 0; while (current && count < 100) { finish(); count++; await tick(5); }
assert.ok(count <= 6, `spoken ${count} of 50 spammed lines`);
console.log(`ok  rapid spam bounded (${count} of 50 spoken)`);

// stopAll / dispose / reinit.
e.speak("x"); e.speak("y"); await tick();
e.stopAll(); assert.equal(current, null);
e.dispose();
await e.init();
e.speak("after reinit"); await tick();
assert.equal(current.text, "after reinit"); finish();
console.log("ok  stopAll, dispose and reinit");

// Unknown event never throws.
(e as any).emit("nope:event");
console.log("\nAll node checks passed.");
process.exit(0);
