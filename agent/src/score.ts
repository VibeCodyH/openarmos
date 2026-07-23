// Threat scoring — the core of Armos. Pure function, no I/O, so it's trivially
// testable and the rules are all in one readable place.
//
// The philosophy: score by *identity and context*, not raw motion. A known face
// in the driveway at noon is nothing; an unknown person at an armed gate at night
// while the house is in "away" mode is everything.

import type { DetectionEvent, ThreatAssessment, ThreatLevel } from "./types.ts";

export interface SystemState {
  mode: "home" | "away" | "night";
  armedZones: string[]; // lowercased zone names that count as "armed"
  knownFaces: string[]; // lowercased names considered trusted
}

// Base risk by object class.
const BASE: Record<string, number> = {
  person: 50,
  car: 30,
  truck: 30,
  motorcycle: 30,
  bicycle: 15,
  dog: 5,
  cat: 5,
  bird: 3,
};

// House-mode multiplier — away is when you actually care.
const MODE_MULTIPLIER = { home: 1.0, night: 1.25, away: 1.5 } as const;

// Perimeter/entry zones raise the stakes over interior/yard sightings.
const PERIMETER = /gate|driveway|door|entry|entrance|perimeter|porch/i;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

const levelFor = (score: number): ThreatLevel =>
  score >= 75 ? "critical" : score >= 50 ? "alert" : score >= 25 ? "notice" : "info";

export function assess(ev: DetectionEvent, state: SystemState): ThreatAssessment {
  const label = ev.label.toLowerCase();
  const face = ev.face?.toLowerCase() ?? null;
  const known = label === "person" && face !== null && state.knownFaces.includes(face);

  // A trusted identity is never a threat, whatever the zone or house mode.
  // We still record the sighting (info-level) so it shows on the dashboard.
  if (known) {
    return { score: 5, level: "info", reasons: [`known person: ${ev.face}`], lockdown: false };
  }

  const reasons: string[] = [];
  let score = BASE[label] ?? 15;

  if (label === "person") {
    reasons.push(face ? `unrecognized face: ${ev.face}` : "unknown person");
  }

  const mult = MODE_MULTIPLIER[state.mode];
  if (mult !== 1) {
    score *= mult;
    reasons.push(`${state.mode} mode (×${mult})`);
  }

  const zones = ev.zones.map((z) => z.toLowerCase());

  if (zones.some((z) => PERIMETER.test(z))) {
    score *= 1.3;
    reasons.push("perimeter zone");
  }

  const hitArmed = zones.filter((z) => state.armedZones.includes(z));
  if (hitArmed.length > 0) {
    score += 25;
    reasons.push(`armed zone: ${hitArmed.join(", ")}`);
  }

  score = Math.round(clamp(score, 0, 100));
  const level = levelFor(score);

  // Lock the house down only on a genuine intrusion signal: an unknown person
  // (known faces already returned above) hitting critical while nobody's home.
  const lockdown = state.mode === "away" && level === "critical" && label === "person";

  if (lockdown) reasons.push("lockdown triggered");

  return { score, level, reasons, lockdown };
}
