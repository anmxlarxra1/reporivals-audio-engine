// Standalone playground. The engine (src/audio-engine) never imports from here.
import { audioEngine, SFX_NAMES } from "./audio-engine";
import type { BattleEventName, SpeakerId, SpeechPriority, VolumeChannel } from "./audio-engine";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $("log");
const statusEl = $("status");

function log(msg: string) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.textContent = (line + (logEl.textContent ?? "")).slice(0, 8000);
}

audioEngine.configure({ onLog: log, onError: (e) => console.warn("[audio]", e) });

function btn(parent: HTMLElement, label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
}

// --- Enable ------------------------------------------------------------------
$("enable").onclick = async () => {
  const ok = await audioEngine.init();
  statusEl.textContent = ok
    ? `Audio enabled. Speech synthesis: ${audioEngine.speechSupported ? "supported" : "NOT supported"}.`
    : "Audio could not be initialized (see log).";
  $<HTMLButtonElement>("demo").disabled = !ok;
  renderVoices();
};

// --- SFX buttons ---------------------------------------------------------------
for (const name of SFX_NAMES) btn($("sfx"), name, () => audioEngine.playSFX(name));

// --- Event buttons (mock data only) -------------------------------------------
const A = "Project Alpha";
const B = "Project Beta";
const mockEvents: [BattleEventName, Record<string, unknown>?][] = [
  ["scan:start", { repoA: A, repoB: B }],
  ["scan:complete"],
  ["character:enter", { name: A, side: "A" }],
  ["battle:start", { repoA: A, repoB: B }],
  ["attack:normal", { attacker: A, target: B }],
  ["attack:critical", { attacker: A, target: B, finding: "High cyclomatic complexity", dialogue: "Your own logic has become your enemy!" }],
  ["attack:ultimate", { attacker: B, dialogue: "Ultimate attack unleashed!" }],
  ["defence:shield", { defender: B }],
  ["defence:break", { defender: B }],
  ["character:damage", { target: B, amount: 12 }],
  ["character:low-health", { target: B }],
  ["character:transform", { name: A }],
  ["battle:victory", { winner: A }],
  ["battle:defeat", { loser: B }],
  ["battle:draw"],
  ["battle:end"],
  ["ui:click"],
];
for (const [name, payload] of mockEvents) {
  btn($("events"), name, () => audioEngine.emit(name, payload as never));
}

// --- Demo battle -------------------------------------------------------------
let demoTimers: ReturnType<typeof setTimeout>[] = [];
function clearDemo() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
}
$("demo").onclick = () => {
  clearDemo();
  audioEngine.stopAll();
  const steps: [number, () => void][] = [
    [0, () => audioEngine.emit("scan:start", { repoA: A, repoB: B })],
    [2200, () => audioEngine.emit("scan:complete")],
    [4500, () => audioEngine.emit("character:enter", { name: A, side: "A" })],
    [6500, () => audioEngine.emit("character:enter", { name: B, side: "B", speak: false })],
    [7200, () => audioEngine.speak("Your code cannot defeat me!", { speaker: "warriorB" })],
    [12500, () => audioEngine.emit("battle:start", { repoA: A, repoB: B })],
    [18500, () => audioEngine.emit("attack:normal", { attacker: A, target: B })],
    [18800, () => audioEngine.emit("character:damage", { target: B })],
    [20000, () => audioEngine.emit("defence:shield", { defender: B })],
    [22000, () => audioEngine.emit("attack:critical", { attacker: A, target: B, finding: "High cyclomatic complexity", dialogue: "Your own complexity has become your greatest enemy." })],
    [27500, () => audioEngine.emit("attack:ultimate", { attacker: A, dialogue: "Ultimate attack unleashed!" })],
    [32000, () => audioEngine.emit("battle:victory", { winner: A })],
  ];
  for (const [ms, fn] of steps) demoTimers.push(setTimeout(fn, ms));
  log("Demo battle started (mock data)");
};

// --- Controls ----------------------------------------------------------------
$("mute").onclick = () => {
  const muted = audioEngine.toggleMute();
  $("mute").textContent = muted ? "Unmute" : "Mute";
  log(muted ? "Muted" : "Unmuted");
};
$("music").onclick = () => {
  if (audioEngine.musicPlaying) audioEngine.stopMusic();
  else audioEngine.startMusic();
  setTimeout(() => ($("music").textContent = audioEngine.musicPlaying ? "Stop Music" : "Start Music"), 0);
};
$("stop").onclick = () => {
  clearDemo();
  audioEngine.stopAll();
  $("music").textContent = "Start Music";
  log("Stopped all audio");
};
$("dispose").onclick = () => {
  clearDemo();
  audioEngine.dispose();
  $<HTMLButtonElement>("demo").disabled = true;
  statusEl.textContent = "Disposed. Click “Enable Audio” to reinitialize.";
  log("Disposed engine");
};

// --- Voices ------------------------------------------------------------------
const speakers: [SpeakerId, string, string][] = [
  ["announcer", "Announcer", "Two repositories. One arena. Let the code battle begin!"],
  ["warriorA", "Warrior A", "Build successful. Exit code zero. Bring it on!"],
  ["warriorB", "Warrior B", "Your own complexity has become your greatest enemy."],
];
function renderVoices() {
  const wrap = $("voices");
  wrap.innerHTML = "";
  const voices = audioEngine.getAvailableVoices();
  for (const [id, label, sample] of speakers) {
    const l = document.createElement("span");
    l.textContent = label;
    const sel = document.createElement("select");
    sel.innerHTML =
      `<option value="">Auto (${audioEngine.getVoiceFor(id) ?? "browser default"})</option>` +
      voices.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join("");
    sel.onchange = () => audioEngine.setVoice(id, sel.value || undefined);
    wrap.append(l, sel);
    btn(wrap, "Preview", () => audioEngine.speak(sample, { speaker: id, priority: "high", interrupt: true }));
  }
  if (!voices.length) log("No voices listed yet (they may load asynchronously) — refresh list after a moment.");
}
renderVoices();
window.speechSynthesis?.addEventListener?.("voiceschanged", renderVoices);

$("say").onclick = () => {
  audioEngine.speak($<HTMLInputElement>("text").value, {
    speaker: $<HTMLSelectElement>("speaker").value as SpeakerId,
    priority: $<HTMLSelectElement>("priority").value as SpeechPriority,
  });
};

// --- Volumes -----------------------------------------------------------------
for (const ch of ["master", "speech", "sfx", "music"] as VolumeChannel[]) {
  const label = document.createElement("label");
  label.className = "vol";
  label.innerHTML = `<span>${ch}</span>`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.01";
  input.value = String(audioEngine.getVolume(ch));
  const out = document.createElement("output");
  out.textContent = input.value;
  input.oninput = () => {
    audioEngine.setVolume(ch, Number(input.value));
    out.textContent = Number(input.value).toFixed(2);
  };
  label.append(input, out);
  $("volumes").appendChild(label);
}
