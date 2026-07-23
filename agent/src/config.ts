// Environment config + mutable runtime state for the Armos agent.
// Static wiring lives in `config`; things that change at runtime (mode, armed
// zones, known faces) live in `state` so the chat/API can mutate them live.

export type Mode = "home" | "away" | "night";

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Like `list` but preserves case — Frigate camera names are case-sensitive.
const listRaw = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const bool = (v: string | undefined): boolean => (v ?? "").toLowerCase() === "true";

const posNum = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const isMode = (v: string | undefined): v is Mode =>
  v === "home" || v === "away" || v === "night";

export const config = {
  mqttUrl: process.env.MQTT_URL ?? "mqtt://mosquitto:1883",
  frigateEventsTopic: process.env.FRIGATE_EVENTS_TOPIC ?? "frigate/events",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://ollama:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:14b",
  haUrl: process.env.HA_URL ?? "http://homeassistant:8123",
  haToken: process.env.HA_TOKEN ?? "",
  ntfyUrl: process.env.NTFY_URL ?? "",
  haLocks: list(process.env.HA_LOCKS),
  haGate: process.env.HA_GATE ?? "",
  // Browser-reachable Frigate base URL for clip/snapshot links on the dashboard.
  // The agent talks to Frigate over the internal network; the browser can't, so
  // this is the host-published (or Tailscale) address, not the compose hostname.
  frigatePublicUrl: process.env.FRIGATE_PUBLIC_URL ?? "https://localhost:8971",
  port: Number(process.env.PORT ?? 8099),
  // Battery-camera mode: keep battery/solar cameras asleep and only wake them
  // for an event, so a continuous stream doesn't flatten the battery.
  batteryMode: bool(process.env.BATTERY_MODE),
  batteryCameras: listRaw(process.env.BATTERY_CAMERAS),
  batteryActiveSeconds: posNum(process.env.BATTERY_ACTIVE_SECONDS, 60),
  // Collapse repeat detections of the same camera+object within this window into
  // one alert — a single visit can fragment into several Frigate tracked objects.
  eventCooldownSeconds: posNum(process.env.EVENT_COOLDOWN_SECONDS, 20),
} as const;

// Mutable runtime state — seeded from env, editable via the chat/API.
export const state: {
  mode: Mode;
  armedZones: string[];
  knownFaces: string[];
  muted: boolean; // when true, events are still recorded but no push is sent
} = {
  mode: isMode(process.env.MODE) ? process.env.MODE : "home",
  armedZones: list(process.env.ARMED_ZONES),
  knownFaces: list(process.env.KNOWN_FACES),
  muted: false,
};
