import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PARAMS, PARAM_GROUPS, PARAM_KEYS, cleanParam, cleanParams, paramSummary } from "../src/lib/chart/chartParams.ts";

test("cleanParam clamps to the range and snaps to the step", () => {
  assert.equal(cleanParam("ma1", 1), 2);
  assert.equal(cleanParam("ma1", 999), 400);
  assert.equal(cleanParam("ma1", 20.6), 21);
  assert.equal(cleanParam("bbMult", 2.34), 2.3);
  assert.equal(cleanParam("bbMult", "2.5"), 2.5);
});

test("cleanParam falls back to the default for unusable input", () => {
  assert.equal(cleanParam("rsiLength", ""), 14);
  assert.equal(cleanParam("rsiLength", "abc"), 14);
  assert.equal(cleanParam("rsiLength", null), 14);
  assert.equal(cleanParam("rsiLength", Number.NaN), 14);
});

test("cleanParams fills missing keys and ignores junk", () => {
  assert.deepEqual(cleanParams(null), DEFAULT_PARAMS);
  const p = cleanParams({ ma1: 9, stMult: 50, bogus: 1 });
  assert.equal(p.ma1, 9);
  assert.equal(p.stMult, 10);
  assert.equal(p.ma2, 50);
  assert.ok(!("bogus" in p));
  assert.equal(Object.keys(p).length, PARAM_KEYS.length);
});

test("paramSummary lists a group's inputs in order", () => {
  assert.equal(paramSummary("ma", DEFAULT_PARAMS), "20 50 200");
  assert.equal(paramSummary("bb", DEFAULT_PARAMS), "20 2");
  assert.equal(paramSummary("arbm", DEFAULT_PARAMS), "50 2 100 20% 1 2 3");
  for (const keys of Object.values(PARAM_GROUPS)) for (const k of keys) assert.ok(PARAM_KEYS.includes(k));
});
