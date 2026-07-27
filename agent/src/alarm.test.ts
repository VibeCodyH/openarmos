import { test } from "node:test";
import assert from "node:assert/strict";
import { haStateToMode, createAlarmPoller } from "./alarm.ts";

test("disarmed is home", () => {
  assert.equal(haStateToMode("disarmed"), "home");
});

test("occupied-armed states land on night", () => {
  assert.equal(haStateToMode("armed_home"), "night");
  assert.equal(haStateToMode("armed_night"), "night");
});

test("custom_bypass stays out of away — it must not reach the lockdown gate", () => {
  // Bypassing zones is what you do when you're staying in. score.ts only locks
  // down in `away`, so this mapping is what keeps auto-lockdown away from
  // someone who armed the panel from inside.
  assert.equal(haStateToMode("armed_custom_bypass"), "night");
});

test("unoccupied states land on away", () => {
  assert.equal(haStateToMode("armed_away"), "away");
  assert.equal(haStateToMode("armed_vacation"), "away");
});

test("triggered is away, never home", () => {
  assert.equal(haStateToMode("triggered"), "away");
});

test("transitional states hold rather than guess", () => {
  // Someone walking out during exit delay, or walking in before they disarm.
  assert.equal(haStateToMode("arming"), null);
  assert.equal(haStateToMode("pending"), null);
  assert.equal(haStateToMode("disarming"), null);
});

test("unavailable and unknown hold — they must never downgrade to home", () => {
  assert.equal(haStateToMode("unavailable"), null);
  assert.equal(haStateToMode("unknown"), null);
  assert.equal(haStateToMode("some_future_state"), null);
  assert.equal(haStateToMode(""), null);
});

test("state strings are normalized", () => {
  assert.equal(haStateToMode("  ARMED_AWAY  "), "away");
});

test("poller applies a confident mode", async () => {
  const applied: string[] = [];
  const poller = createAlarmPoller({
    read: async () => "armed_away",
    apply: (m) => applied.push(m),
    intervalMs: 60_000,
  });
  await poller.tick();
  poller.stop();
  assert.deepEqual(applied, ["away"]);
});

test("poller holds — does not apply — when the panel is unreachable", async () => {
  const applied: string[] = [];
  const poller = createAlarmPoller({
    read: async () => null,
    apply: (m) => applied.push(m),
    intervalMs: 60_000,
  });
  await poller.tick();
  poller.stop();
  assert.deepEqual(applied, [], "an unreachable panel must not change the mode");
});

test("poller holds through a transitional state", async () => {
  const applied: string[] = [];
  const poller = createAlarmPoller({
    read: async () => "arming",
    apply: (m) => applied.push(m),
    intervalMs: 60_000,
  });
  await poller.tick();
  poller.stop();
  assert.deepEqual(applied, []);
});

test("a panel going unavailable after arming keeps the armed mode", async () => {
  const applied: string[] = [];
  const reads = ["armed_away", "unavailable", "unavailable"];
  let i = 0;
  const poller = createAlarmPoller({
    read: async () => reads[i++] ?? null,
    apply: (m) => applied.push(m),
    intervalMs: 60_000,
  });
  await poller.tick();
  await poller.tick();
  await poller.tick();
  poller.stop();
  // Only the first read spoke; the drop-outs never walked it back to home.
  assert.deepEqual(applied, ["away"]);
});
