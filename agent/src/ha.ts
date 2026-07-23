// Home Assistant actions. The agent only *acts* on the house during lockdown;
// everything else HA already handles. All calls are local, bearer-authenticated.

import { config } from "./config.ts";

async function callService(domain: string, service: string, entityId: string): Promise<void> {
  if (!config.haToken) {
    console.warn(`[ha] no HA_TOKEN — skipping ${domain}.${service} on ${entityId}`);
    return;
  }
  try {
    const res = await fetch(`${config.haUrl}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.haToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ entity_id: entityId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    console.log(`[ha] ${domain}.${service} -> ${entityId}`);
  } catch (err) {
    console.error(`[ha] ${domain}.${service} on ${entityId} failed:`, err);
  }
}

// Lock every configured lock and close the gate. Best-effort: one failure does
// not abort the rest.
export async function lockdown(): Promise<void> {
  const actions: Promise<void>[] = config.haLocks.map((lock) => callService("lock", "lock", lock));
  if (config.haGate) {
    const [domain] = config.haGate.split(".");
    // A gate is usually a cover; fall back to switch-off for relay-style gates.
    actions.push(
      domain === "switch"
        ? callService("switch", "turn_off", config.haGate)
        : callService("cover", "close_cover", config.haGate),
    );
  }
  if (actions.length === 0) {
    console.warn("[ha] lockdown requested but no HA_LOCKS/HA_GATE configured");
    return;
  }
  await Promise.allSettled(actions);
}
