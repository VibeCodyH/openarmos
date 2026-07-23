// Frigate event ingestion over MQTT. Normalizes Frigate's payload into a
// DetectionEvent and hands it to a callback. Dedupes so we assess an object
// once per distinct zone-set rather than on every frame update.

import mqtt from "mqtt";
import { config } from "./config.ts";
import type { DetectionEvent } from "./types.ts";

// Frigate's `frigate/events` payload (only the fields we use).
interface FrigateEvent {
  type: "new" | "update" | "end";
  after?: {
    id: string;
    camera: string;
    label: string;
    sub_label?: string | [string, number] | null;
    current_zones?: string[];
    top_score?: number;
    score?: number;
    start_time?: number;
  };
}

// Frigate encodes sub_label as either a string or a [name, score] tuple.
type SubLabel = string | [string, number] | null | undefined;
const faceOf = (sub: SubLabel): string | null => {
  if (!sub) return null;
  return Array.isArray(sub) ? (sub[0] ?? null) : sub;
};

export function startEvents(onEvent: (ev: DetectionEvent) => void): mqtt.MqttClient {
  const client = mqtt.connect(config.mqttUrl, { reconnectPeriod: 5000 });
  const seen = new Set<string>(); // event ids already alerted on

  client.on("connect", () => {
    client.subscribe(config.frigateEventsTopic, (err) => {
      if (err) console.error("[mqtt] subscribe failed:", err);
      else console.log(`[mqtt] connected ${config.mqttUrl}, subscribed ${config.frigateEventsTopic}`);
    });
  });

  client.on("error", (err) => console.error("[mqtt] error:", err));

  client.on("message", (_topic, buf) => {
    let msg: FrigateEvent;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const a = msg.after;
    // Alert once per tracked object, on first detection only. Frigate emits a
    // continuous stream of "update" messages as an object moves; acting on each
    // turns a single person into a flood of alerts.
    if (msg.type !== "new" || !a?.id || seen.has(a.id)) return;
    seen.add(a.id);
    if (seen.size > 1000) seen.clear(); // crude cap; ids are short-lived

    const zones = a.current_zones ?? [];

    onEvent({
      id: a.id,
      camera: a.camera,
      label: a.label,
      face: faceOf(a.sub_label ?? null),
      zones,
      confidence: a.top_score ?? a.score ?? 0,
      ts: Math.round(a.start_time ?? Date.now() / 1000),
    });
  });

  return client;
}
