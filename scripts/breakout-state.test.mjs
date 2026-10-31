import test from "node:test";
import assert from "node:assert/strict";
import { breakoutState, STATES_BY_STAGE } from "../src/lib/screen/breakoutState.ts";

test("forming bases split into coiled, near pivot and building", () => {
  assert.equal(breakoutState("forming", { pivot: -2, coil: 0.6 }), "coiled");
  assert.equal(breakoutState("forming", { pivot: -2, coil: 0.9 }), "near-pivot");
  assert.equal(breakoutState("forming", { pivot: -4.5, coil: 0.5 }), "near-pivot");
  assert.equal(breakoutState("forming", { pivot: -12, coil: 0.4 }), "building");
});

test("unknown tightening never counts as coiled", () => {
  assert.equal(breakoutState("forming", { pivot: -1, coil: 0 }), "near-pivot");
  assert.equal(breakoutState("forming", { pivot: -1, coil: null }), "near-pivot");
});

test("breakouts use the 5% buy zone and 20% strong threshold", () => {
  assert.equal(breakoutState("breakouts", { pivot: 3 }), "buy-zone");
  assert.equal(breakoutState("breakouts", { pivot: 5 }), "buy-zone");
  assert.equal(breakoutState("climbing", { pivot: 8 }), "extended");
  assert.equal(breakoutState("climbing", { pivot: 20 }), "strong");
  assert.equal(breakoutState("climbing", { pivot: -1 }), "buy-zone");
});

test("played-out breakouts are paid off, failed or faded", () => {
  assert.equal(breakoutState("played-out", { pivot: 0, resultPercent: 12, exitReason: "closed below its 50-day line" }), "paid-off");
  assert.equal(breakoutState("played-out", { pivot: 0, resultPercent: -8, exitReason: "hit the 8% stop" }), "failed");
  assert.equal(breakoutState("played-out", { pivot: 0, resultPercent: -3, exitReason: "closed below its 50-day line" }), "faded");
});

test("every stage state is reachable from its own stage list", () => {
  for (const [stage, states] of Object.entries(STATES_BY_STAGE)) {
    assert.ok(states.length === 3, stage);
  }
});
