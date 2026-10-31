import test from "node:test";
import assert from "node:assert/strict";
import { scannerEdge, scannerEdgeSentence, sortByEdge } from "../src/lib/screen/scannerEdge.ts";

test("leader and up3 have an edge; fall4 and range do not", () => {
  assert.equal(scannerEdge("leader").level, "edge");
  assert.equal(scannerEdge("up3").level, "edge");
  assert.equal(scannerEdge("fall4").level, "weak");
  assert.equal(scannerEdge("range").level, "none");
  assert.equal(scannerEdge("pocket").level, "none");
});

test("a scanner with no backtest has no edge record", () => {
  assert.equal(scannerEdge("nope"), null);
});

test("the sentence names both markets and the verdict", () => {
  const s = scannerEdgeSentence("Relative Leader", scannerEdge("leader"));
  assert.match(s, /\+0\.34R/);
  assert.match(s, /−0\.12R/);
  assert.match(s, /strong markets/);
  assert.match(scannerEdgeSentence("Range Breakout", scannerEdge("range")), /No edge/);
});

test("sorting puts the best strong-market scanner first and unknown ones last", () => {
  assert.deepEqual(sortByEdge(["range", "nope", "leader", "up3"]), ["leader", "up3", "range", "nope"]);
});
