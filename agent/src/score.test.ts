import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, type SystemState } from "./score.ts";
import type { DetectionEvent } from "./types.ts";

const ev = (over: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id: "1",
  camera: "front",
  label: "person",
  face: null,
  zones: [],
  confidence: 0.9,
  ts: 0,
  ...over,
});

const st = (over: Partial<SystemState> = {}): SystemState => ({
  mode: "home",
  armedZones: [],
  knownFaces: ["cody"],
  ...over,
});

test("known person scores low and never locks down", () => {
  const a = assess(ev({ face: "Cody", zones: ["front_gate"] }), st({ mode: "away", armedZones: ["front_gate"] }));
  assert.ok(a.score < 25, `expected info-level, got ${a.score}`);
  assert.equal(a.level, "info");
  assert.equal(a.lockdown, false);
});

test("unknown person at armed gate while away is critical + lockdown", () => {
  const a = assess(ev({ zones: ["front_gate"] }), st({ mode: "away", armedZones: ["front_gate"] }));
  assert.equal(a.level, "critical");
  assert.equal(a.lockdown, true);
  assert.ok(a.reasons.some((r) => r.includes("armed zone")));
});

test("an animal is never a threat", () => {
  const a = assess(ev({ label: "cat", zones: ["driveway"] }), st({ mode: "away" }));
  assert.equal(a.level, "info");
  assert.equal(a.lockdown, false);
});

test("mode escalates the same sighting", () => {
  const home = assess(ev({ zones: ["yard"] }), st({ mode: "home" }));
  const away = assess(ev({ zones: ["yard"] }), st({ mode: "away" }));
  assert.ok(away.score > home.score);
});

test("lockdown requires away mode — a critical sighting at home does not lock down", () => {
  const a = assess(ev({ zones: ["front_gate"] }), st({ mode: "home", armedZones: ["front_gate"] }));
  assert.equal(a.lockdown, false);
});

test("score is always clamped to 0..100", () => {
  const a = assess(ev({ zones: ["front_gate", "driveway"] }), st({ mode: "away", armedZones: ["front_gate", "driveway"] }));
  assert.ok(a.score >= 0 && a.score <= 100);
});
