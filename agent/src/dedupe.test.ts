import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeduper } from "./dedupe.ts";

test("accepts the first sighting of an id, rejects repeats of that id", () => {
  const d = createDeduper({ cooldownSeconds: 20 });
  assert.equal(d.accept("a", "front_door", "person", 0), true);
  assert.equal(d.accept("a", "front_door", "person", 0), false);
});

test("collapses a fragmented visit — a new id for the same camera+label within the cooldown", () => {
  const d = createDeduper({ cooldownSeconds: 20 });
  assert.equal(d.accept("first", "front_door", "person", 1_000), true);
  // The reported bug: Frigate splits one visit into a second tracked object 2s later.
  assert.equal(d.accept("second", "front_door", "person", 3_000), false);
});

test("surfaces again once the cooldown has elapsed", () => {
  const d = createDeduper({ cooldownSeconds: 20 });
  assert.equal(d.accept("first", "front_door", "person", 0), true);
  assert.equal(d.accept("later", "front_door", "person", 20_000), true);
});

test("cooldown is per camera+label — a different subject is not suppressed", () => {
  const d = createDeduper({ cooldownSeconds: 20 });
  assert.equal(d.accept("p", "front_door", "person", 0), true);
  assert.equal(d.accept("c", "front_door", "car", 1_000), true); // different label
  assert.equal(d.accept("p2", "driveway", "person", 1_000), true); // different camera
});
