// Turn an assessed event into a plain-English line and push it to the user.
// Push target is ntfy (self-hostable); if unconfigured, we log instead.

import { config, state } from "./config.ts";
import { generate } from "./ollama.ts";
import type { DetectionEvent, ThreatAssessment } from "./types.ts";

const SYSTEM =
  "You write home-security push notifications. Given an event, reply with ONE short, calm, " +
  "factual sentence a homeowner would want on their phone. No preamble, no emoji, no quotes.";

// Deterministic summary — used instantly on the critical path, and as the
// fallback when the local model is slow or unreachable.
export const templateSummary = (ev: DetectionEvent, a: ThreatAssessment): string => {
  const who = ev.label === "person" ? (ev.face ? ev.face : "An unknown person") : `A ${ev.label}`;
  const where = ev.zones[0] ? ` at the ${ev.zones[0].replace(/_/g, " ")}` : ` on the ${ev.camera} camera`;
  return `${who} detected${where} (${a.level}, score ${a.score}).`;
};

export async function summarize(ev: DetectionEvent, a: ThreatAssessment): Promise<string> {
  const prompt =
    `Event: ${ev.label}${ev.face ? ` identified as ${ev.face}` : " (unidentified)"}, ` +
    `camera "${ev.camera}", zones [${ev.zones.join(", ") || "none"}], ` +
    `threat ${a.level} (score ${a.score}). Factors: ${a.reasons.join("; ") || "none"}.`;
  try {
    const line = await generate(prompt, SYSTEM);
    return line || templateSummary(ev, a);
  } catch {
    return templateSummary(ev, a);
  }
}

// ntfy priority: 1 (min) .. 5 (max).
const PRIORITY = { info: "2", notice: "3", alert: "4", critical: "5" } as const;
const TAGS = { info: "eye", notice: "eyes", alert: "warning", critical: "rotating_light" } as const;

async function push(title: string, message: string, a: ThreatAssessment): Promise<void> {
  if (!config.ntfyUrl) {
    console.log(`[notify:${a.level}] ${title} — ${message}`);
    return;
  }
  try {
    await fetch(config.ntfyUrl, {
      method: "POST",
      headers: {
        Title: title,
        Priority: PRIORITY[a.level],
        Tags: TAGS[a.level],
      },
      body: message,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[notify] push failed:", err, "\n  message was:", message);
  }
}

// Push to the user unless it's info-level or muting is on. Recording of the
// event is the caller's job and is never gated on this.
export async function maybePush(a: ThreatAssessment, summary: string): Promise<void> {
  if (a.level === "info" || state.muted) return;
  await push(`OpenArmos: ${a.level.toUpperCase()}`, summary, a);
}
