import test from "node:test";
import assert from "node:assert/strict";
import { rollListMemory, diffList } from "../src/lib/listChanges.ts";

test("first visit has no baseline, so nothing is tagged", () => {
  const m = rollListMemory(null, 100, ["A", "B"]);
  const d = diffList(m, ["A", "B"]);
  assert.equal(d.hasBaseline, false);
  assert.equal(d.added.size, 0);
  assert.deepEqual(d.dropped, []);
});

test("same-day visits keep the baseline and only refresh the current list", () => {
  let m = rollListMemory(null, 100, ["A", "B"]);
  m = rollListMemory(m, 101, ["A", "C"]);
  m = rollListMemory(m, 101, ["A", "C", "D"]);
  assert.deepEqual(m.baseline, ["A", "B"]);
  assert.equal(m.baselineDay, 100);
  const d = diffList(m, ["A", "C", "D"]);
  assert.deepEqual([...d.added].sort(), ["C", "D"]);
  assert.deepEqual(d.dropped, ["B"]);
  assert.equal(d.since, 100);
});

test("a new day rolls the last-seen list into the baseline", () => {
  let m = rollListMemory(null, 100, ["A"]);
  m = rollListMemory(m, 101, ["A", "B"]);
  m = rollListMemory(m, 102, ["B"]);
  assert.deepEqual(m.baseline, ["A", "B"]);
  assert.deepEqual(diffList(m, ["B"]).dropped, ["A"]);
});

test("a clock that moved backwards does not become a baseline", () => {
  const m = rollListMemory({ day: 200, current: ["A"], baseline: ["A"], baselineDay: 199 }, 100, ["B"]);
  assert.equal(m.baseline, null);
});

test("an empty list today drops everything from the baseline", () => {
  const m = rollListMemory(rollListMemory(null, 100, ["A", "B"]), 101, []);
  assert.deepEqual(diffList(m, []).dropped, ["A", "B"]);
});
