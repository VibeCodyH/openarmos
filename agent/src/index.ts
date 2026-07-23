// Armos entrypoint — wire the pieces together:
//   Frigate event → assess threat → record + lock down NOW → enrich + notify async.

import { config, state } from "./config.ts";
import { startEvents } from "./events.ts";
import { assess } from "./score.ts";
import { summarize, maybePush, templateSummary } from "./notify.ts";
import { lockdown } from "./ha.ts";
import { startServer } from "./chat.ts";
import { createBatteryController, type BatteryController } from "./battery.ts";
import * as store from "./store.ts";
import type { DetectionEvent, EventRecord, ThreatAssessment } from "./types.ts";

// Set once battery mode is wired below; null when the feature is off.
let battery: BatteryController | null = null;

function handle(ev: DetectionEvent): void {
  const assessment = assess(ev, state);

  // Record immediately with a deterministic summary. The dashboard and any
  // lockdown must never wait on the language model.
  const record: EventRecord = { ...ev, assessment, summary: templateSummary(ev, assessment) };
  store.add(record);
  console.log(`[event] ${ev.camera} ${ev.label}${ev.face ? `(${ev.face})` : ""} zones=[${ev.zones.join(",")}] -> ${assessment.level} ${assessment.score}`);

  if (assessment.lockdown) {
    console.warn("[lockdown] intrusion signal — securing the house");
    lockdown().catch((err) => console.error("[lockdown] failed:", err));
  }

  // Enrich the summary with the model's phrasing and notify, off the critical path.
  void enrich(ev, assessment, record);
}

async function enrich(ev: DetectionEvent, assessment: ThreatAssessment, record: EventRecord): Promise<void> {
  try {
    const summary = await summarize(ev, assessment);
    record.summary = summary; // mutates the record already in the store
    await maybePush(assessment, summary);
  } catch (err) {
    console.error("[enrich] failed:", err);
  }
}

console.log(
  `🗿 OpenArmos agent starting (mode=${state.mode}, model=${config.ollamaModel}` +
    `${config.batteryMode ? ", battery mode ON" : ""})`,
);
const client = startEvents(handle);

if (config.batteryMode) {
  battery = createBatteryController({
    publish: (camera, on) => client.publish(`frigate/${camera}/enabled/set`, on ? "ON" : "OFF"),
    cameras: config.batteryCameras,
    activeSeconds: config.batteryActiveSeconds,
  });
  const stateTopics = config.batteryCameras.map((c) => `frigate/${c}/enabled/state`);

  // Reconcile against Frigate's real state. enabled/state is retained, so on every
  // (re)connect mosquitto replays each camera's actual state — this catches the
  // boot race, Frigate restarts, and manual UI toggles, all without clobbering an
  // open wake window (observeEnabled respects the timer).
  const onConnect = (): void => {
    battery!.sleepAll(); // fast path; the retained state below is the reliable one
    client.subscribe(stateTopics, (err) => {
      if (err) console.error("[battery] reconcile subscribe failed:", err);
    });
  };
  if (client.connected) onConnect();
  client.on("connect", onConnect); // also re-sleep + re-subscribe on reconnect

  client.on("message", (topic, buf) => {
    const m = topic.match(/^frigate\/(.+)\/enabled\/state$/);
    if (m?.[1]) {
      battery!.observeEnabled(m[1], buf.toString() === "ON");
      return;
    }
    // Any activity for a managed camera keeps it awake (new AND update events, so
    // a lingering visitor doesn't get cut off mid-window).
    if (topic === config.frigateEventsTopic) {
      try {
        const cam = (JSON.parse(buf.toString()) as { after?: { camera?: string } })?.after?.camera;
        if (cam) battery!.wake(cam);
      } catch {
        /* non-JSON payloads belong to the state branch above */
      }
    }
  });

  console.log(
    `[battery] managing [${config.batteryCameras.join(", ") || "(none — set BATTERY_CAMERAS)"}]` +
      `, wake window ${config.batteryActiveSeconds}s`,
  );
}

startServer(battery);
