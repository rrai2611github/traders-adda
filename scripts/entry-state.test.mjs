import test from "node:test";
import assert from "node:assert/strict";
import { entryNoteText, entryState } from "../src/lib/alerts/entryState.ts";

test("below the trigger the setup is waiting and says by how much", () => {
  const s = entryState(98, 100, 103);
  assert.equal(s.kind, "waiting");
  assert.ok(Math.abs(s.gapPercent - 2.0408) < 0.001);
  assert.equal(entryNoteText(s), "2.0% below the trigger");
});

test("at or above the trigger it has fired; above the skip level it must not be chased", () => {
  assert.equal(entryState(100, 100, 103).kind, "triggered");
  assert.equal(entryState(103, 100, 103).kind, "triggered", "the skip level itself is still inside the buy zone");
  const skip = entryState(103.5, 100, 103);
  assert.equal(skip.kind, "skip");
  assert.equal(entryNoteText(skip), "now above the skip level, do not chase");
  assert.equal(entryNoteText(entryState(101, 100, 103)), "trigger reached");
});

test("without a skip level only triggered and waiting are possible; no state gives no note", () => {
  assert.equal(entryState(150, 100).kind, "triggered");
  assert.equal(entryNoteText(undefined), "");
});
