// Live arm state from the house's real alarm panel, via Home Assistant.
//
// Without this, `state.mode` is whatever MODE said at boot. Arm the panel at the
// keypad and the agent never finds out — so the two heaviest inputs in score.ts
// (the mode multiplier and the armed-zone bonus) stay at their calmest values
// exactly when the house is armed. This closes that gap for any panel HA speaks
// to (ELK M1, DSC, Honeywell, Qolsys, Konnected, ...), not one vendor.
//
// The mapping is a pure function so the rules stay readable and testable, in the
// same spirit as score.ts.

import type { Mode } from "./config.ts";

// HA's alarm_control_panel states, per the developer docs. `null` means "no
// opinion — hold whatever mode we already had". That distinction is the whole
// safety property: a panel that goes unavailable, or is mid-transition, must
// never silently downgrade us to `home` (the ×1.0 multiplier).
export function haStateToMode(haState: string): Mode | null {
  switch (haState.trim().toLowerCase()) {
    case "disarmed":
      return "home";

    // Armed while occupied — the perimeter is live but people are inside.
    // Sits between "home" and "away", which is exactly what `night` (×1.25) is.
    case "armed_home":
    case "armed_night":
      return "night";

    // Nobody home, or armed with zones bypassed. Bypass is ambiguous by design,
    // so it takes the higher multiplier: over-caring is the cheap failure here.
    case "armed_away":
    case "armed_vacation":
    case "armed_custom_bypass":
      return "away";

    // The alarm is going off. Nothing about that is a `home` situation.
    case "triggered":
      return "away";

    // Transitional and unknown states all hold. `arming` and `pending` are the
    // load-bearing ones: someone walking out during exit delay, or walking in
    // during entry delay before they disarm, must not trip a lockdown.
    case "arming":
    case "pending":
    case "disarming":
    case "unavailable":
    case "unknown":
    default:
      return null;
  }
}

// Single source of truth for "is the panel driving mode?". index.ts uses it to
// decide whether to poll and chat.ts to decide whether to refuse manual changes;
// if those two ever disagree, an entity set without a token would lock the user
// out of mode with nothing setting it.
export const panelOwnsMode = (entity: string, token: string): boolean => Boolean(entity && token);

export interface AlarmPollerDeps {
  // Reads the panel's current HA state string; returns null if unreachable.
  read: () => Promise<string | null>;
  // Applies a mode the panel is confident about.
  apply: (mode: Mode) => void;
  intervalMs: number;
}

export interface AlarmPoller {
  stop: () => void;
  // Exposed for the initial read so startup doesn't wait a full interval.
  tick: () => Promise<void>;
}

export function createAlarmPoller({ read, apply, intervalMs }: AlarmPollerDeps): AlarmPoller {
  let lastRaw: string | null = null;

  const tick = async (): Promise<void> => {
    const raw = await read();
    if (raw === null) {
      console.warn("[alarm] panel unreachable — holding last known mode");
      return;
    }
    const mode = haStateToMode(raw);
    if (mode === null) {
      if (raw !== lastRaw) console.log(`[alarm] ${raw} — holding last known mode`);
      lastRaw = raw;
      return;
    }
    if (raw !== lastRaw) {
      console.log(`[alarm] panel ${raw} -> mode ${mode}`);
      lastRaw = raw;
    }
    apply(mode);
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.(); // never hold the process open on this alone
  return { stop: () => clearInterval(timer), tick };
}

// Fetch the panel entity's state from HA's REST API. Returns null on any
// failure so the caller holds instead of guessing.
export function haPanelReader(haUrl: string, token: string, entityId: string): () => Promise<string | null> {
  return async () => {
    try {
      const res = await fetch(`${haUrl}/api/states/${encodeURIComponent(entityId)}`, {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { state?: unknown };
      return typeof body.state === "string" ? body.state : null;
    } catch (err) {
      console.error(`[alarm] read ${entityId} failed:`, err);
      return null;
    }
  };
}
