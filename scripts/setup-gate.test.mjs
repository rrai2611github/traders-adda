import test from "node:test";
import assert from "node:assert/strict";
import { setupStatus, setupSize, SETUP_BREADTH_MIN } from "../src/lib/screen/setupGate.ts";

test("buying is allowed at 35% breadth, and the reason is about breadth", () => {
  const s = setupStatus(35, { above: true, percent: 2 });
  assert.equal(SETUP_BREADTH_MIN, 35);
  assert.equal(s.allowed, true);
  assert.match(s.reason, /35% of stocks are above their 50-day average/);
  assert.doesNotMatch(s.reason, /200-day/);
});

test("low breadth stops real buys; the Nifty under its 200-day average does not", () => {
  const lowBreadth = setupStatus(30.9, { above: true, percent: 1 });
  assert.equal(lowBreadth.allowed, false);
  assert.equal(lowBreadth.breadthOk, false);
  const niftyUnder = setupStatus(60, { above: false, percent: -4.9 });
  assert.equal(niftyUnder.allowed, true);
  assert.equal(niftyUnder.breadthOk, true);
  // The Nifty is still reported for display.
  assert.equal(niftyUnder.niftyOk, false);
  assert.doesNotMatch(niftyUnder.reason, /200-day/);
});

test("breadth alone decides, whatever the Nifty is; with no breadth nothing is allowed", () => {
  assert.equal(setupStatus(50, null).allowed, true);
  assert.equal(setupStatus(20, null).allowed, false);
  assert.equal(setupStatus(20, { above: true, percent: 6 }).allowed, false);
  assert.equal(setupStatus(null, null).allowed, false);
  assert.equal(setupStatus(null, { above: true, percent: 3 }).allowed, false);
  assert.match(setupStatus(null, null).reason, /unavailable/);
});

test("the trade-plan size note follows the setup check: normal size when it passes, paper trading when it does not", () => {
  const ok = setupSize(40, { above: true, percent: 1 });
  assert.equal(ok.key, "full");
  assert.match(ok.detail, /setup check is passed/);
  const no = setupSize(30, { above: true, percent: 1 });
  assert.equal(no.key, "paper");
  assert.match(no.detail, /30% of stocks are above their 50-day average \(the setup needs 35%\)/);
  assert.equal(setupSize(60, { above: false, percent: -4 }).key, "full");
});
