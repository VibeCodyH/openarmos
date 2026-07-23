import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createBatteryController } from "./battery.ts";

type Call = [string, boolean];

const setup = (t: TestContext, cameras = ["front_door"], activeSeconds = 60) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: Call[] = [];
  const c = createBatteryController({
    publish: (camera, on) => calls.push([camera, on]),
    cameras,
    activeSeconds,
  });
  return { c, calls };
};

test("sleepAll turns every managed camera OFF", (t) => {
  const { c, calls } = setup(t, ["front_door", "yard"]);
  c.sleepAll();
  assert.deepEqual(calls, [["front_door", false], ["yard", false]]);
});

test("wake turns the camera ON once, then OFF after the window", (t) => {
  const { c, calls } = setup(t);
  c.wake("front_door");
  assert.deepEqual(calls, [["front_door", true]]);
  assert.deepEqual(c.awake(), ["front_door"]);
  t.mock.timers.tick(60_000);
  assert.deepEqual(calls, [["front_door", true], ["front_door", false]]);
  assert.deepEqual(c.awake(), []);
});

test("repeated wake within the window extends it without re-publishing ON", (t) => {
  const { c, calls } = setup(t);
  c.wake("front_door");
  t.mock.timers.tick(40_000);
  c.wake("front_door"); // extend — camera already awake
  assert.deepEqual(calls, [["front_door", true]], "no redundant ON");
  t.mock.timers.tick(40_000); // 80s since first wake, only 40s since the extend
  assert.deepEqual(calls, [["front_door", true]], "not asleep yet — window was extended");
  t.mock.timers.tick(20_000); // now 60s of quiet since the extend
  assert.deepEqual(calls, [["front_door", true], ["front_door", false]]);
});

test("wake ignores cameras it does not manage", (t) => {
  const { c, calls } = setup(t);
  c.wake("garage");
  assert.deepEqual(calls, []);
  assert.deepEqual(c.awake(), []);
});

test("wakeAll wakes every managed camera", (t) => {
  const { c, calls } = setup(t, ["front_door", "yard"]);
  c.wakeAll();
  assert.deepEqual(calls, [["front_door", true], ["yard", true]]);
  assert.deepEqual(c.awake().sort(), ["front_door", "yard"]);
});

test("observeEnabled re-sleeps a camera enabled outside a wake window", (t) => {
  // The core anti-drain guarantee: Frigate boots/restarts enabled -> force OFF.
  const { c, calls } = setup(t);
  c.observeEnabled("front_door", true);
  assert.deepEqual(calls, [["front_door", false]]);
  assert.deepEqual(c.status(), [{ camera: "front_door", state: "asleep" }]);
});

test("observeEnabled does NOT re-sleep a camera that is in its wake window", (t) => {
  const { c, calls } = setup(t);
  c.wake("front_door"); // opens the window (publishes ON)
  c.observeEnabled("front_door", true); // Frigate confirms it came up
  assert.deepEqual(calls, [["front_door", true]], "no spurious OFF during a wake");
  assert.deepEqual(c.status(), [{ camera: "front_door", state: "awake" }]);
});

test("observeEnabled ignores unmanaged cameras", (t) => {
  const { c, calls } = setup(t);
  c.observeEnabled("garage", true);
  assert.deepEqual(calls, []);
});

test("status reports waking (window open, not yet confirmed) then awake", (t) => {
  const { c } = setup(t);
  c.wake("front_door");
  assert.deepEqual(c.status(), [{ camera: "front_door", state: "waking" }]);
  c.observeEnabled("front_door", true);
  assert.deepEqual(c.status(), [{ camera: "front_door", state: "awake" }]);
});
