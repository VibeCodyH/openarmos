// Shared shapes for the agent.

// A normalized detection, distilled from a Frigate MQTT event.
export interface DetectionEvent {
  id: string;
  camera: string;
  label: string; // person | car | dog | cat | ...
  face: string | null; // sub_label from double-take, when present
  zones: string[]; // current zones the object is in
  confidence: number; // detector confidence, 0..1
  ts: number; // epoch seconds
}

export type ThreatLevel = "info" | "notice" | "alert" | "critical";

export interface ThreatAssessment {
  score: number; // 0..100
  level: ThreatLevel;
  reasons: string[]; // human-readable factors that drove the score
  lockdown: boolean; // whether to trigger the away-mode lockdown routine
}

// An assessed event, kept in the recent-events store for the chat context.
export interface EventRecord extends DetectionEvent {
  assessment: ThreatAssessment;
  summary: string; // the natural-language line sent to the user
}
