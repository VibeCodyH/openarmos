// Decides whether a Frigate event should surface as an alert. Two guards, both
// pure so they unit-test without MQTT:
//
//  1. id-dedup — Frigate streams many "update" messages per tracked object as it
//     moves; we act on the first sighting of each event id only.
//  2. cooldown — a single real visit can fragment into several tracked objects
//     (a brief occlusion, or an unstable just-woken battery stream), each with its
//     own id and a near-identical clip. We collapse repeats of the same
//     camera+label within a short window into one alert.

export interface Deduper {
  // True if this event should surface; false to drop it. `nowMs` is injected so
  // the cooldown is testable with a fake clock.
  accept(id: string, camera: string, label: string, nowMs: number): boolean;
}

export function createDeduper(opts: { cooldownSeconds: number }): Deduper {
  const seen = new Set<string>();
  const lastSurfaced = new Map<string, number>();

  return {
    accept(id, camera, label, nowMs) {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > 1000) seen.clear(); // crude cap; event ids are short-lived

      const key = `${camera}:${label}`;
      const last = lastSurfaced.get(key);
      if (last !== undefined && nowMs - last < opts.cooldownSeconds * 1000) return false;
      lastSurfaced.set(key, nowMs);
      return true;
    },
  };
}
