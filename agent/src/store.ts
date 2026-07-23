// Recent-events store — an in-memory ring buffer the chat uses for context
// ("who came by today?"). Intentionally simple: history resets on restart.
// Persisting to disk is a roadmap item, not an MVP need.

import type { EventRecord } from "./types.ts";

const MAX = 200;
const events: EventRecord[] = [];

export function add(record: EventRecord): void {
  events.push(record);
  if (events.length > MAX) events.shift();
}

// Newest first.
export function recent(limit = 50): EventRecord[] {
  return events.slice(-limit).reverse();
}

// Events since a given epoch-seconds cutoff (newest first) — used by the chat
// to answer time-scoped questions like "today".
export function since(tsSeconds: number, limit = 100): EventRecord[] {
  return events
    .filter((e) => e.ts >= tsSeconds)
    .slice(-limit)
    .reverse();
}
