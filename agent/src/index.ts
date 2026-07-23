// Armos entrypoint — wire the pieces together:
//   Frigate event → assess threat → record + lock down NOW → enrich + notify async.

import { config, state } from "./config.ts";
import { startEvents } from "./events.ts";
import { assess } from "./score.ts";
import { summarize, maybePush, templateSummary } from "./notify.ts";
import { lockdown } from "./ha.ts";
import { startServer } from "./chat.ts";
import * as store from "./store.ts";
import type { DetectionEvent, EventRecord, ThreatAssessment } from "./types.ts";

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

console.log(`🗿 OpenArmos agent starting (mode=${state.mode}, model=${config.ollamaModel})`);
startEvents(handle);
startServer();
