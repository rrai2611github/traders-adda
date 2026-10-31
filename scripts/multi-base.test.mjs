import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeBases } from "../src/lib/screen/multiBase.ts";

// Values a stock reports for each of its bases: a year-long outer base (level 1) and a young inner one (level 2).
const common = { rs: 80, vs50: 5, vs200: 20, fromHigh: 10, aboveLow: 60, turn: 20, mcap: 5000, coil: 0.8, dry: 0.7, listedWk: 300, ext: -8 };
const inner = { ...common, baseWk: 4, baseDepth: 12, level: 2 };
const outer = { ...common, baseWk: 70, baseDepth: 30, level: 1 };

test("a screen that only the outer base satisfies is claimed by the outer base", () => {
  const judged = judgeBases([{ id: "inner", v: inner }, { id: "outer", v: outer }], (c) => c.v);
  const byId = Object.fromEntries(judged.map((j) => [j.candidate.id, j]));
  // Multi-year breakouts needs a 52-week base and Blue sky needs level 1: only the outer base has either.
  assert.ok(byId.outer.claimed.includes("Multi-year breakouts"));
  assert.ok(byId.outer.claimed.includes("Blue sky"));
  assert.ok(!byId.inner.screens.includes("Multi-year breakouts"));
  assert.ok(!byId.inner.screens.includes("Blue sky"));
});

test("a screen both bases satisfy is claimed once, by the innermost", () => {
  const judged = judgeBases([{ id: "inner", v: inner }, { id: "outer", v: outer }], (c) => c.v);
  const claims = judged.flatMap((j) => j.claimed);
  assert.equal(new Set(claims).size, claims.length, "no screen is claimed twice");
  assert.equal(judged.find((j) => j.claimed.includes("VCP")).candidate.id, "inner");
});

test("screens already covered by the stock's main row are not claimed again", () => {
  const judged = judgeBases([{ id: "outer", v: outer }], (c) => c.v, ["Blue sky"]);
  assert.ok(judged[0].screens.includes("Blue sky"));
  assert.ok(!judged[0].claimed.includes("Blue sky"));
});

test("a base that satisfies nothing claims nothing", () => {
  const weak = { ...inner, rs: 20, vs50: -10, vs200: -20 };
  assert.deepEqual(judgeBases([{ id: "weak", v: weak }], (c) => c.v)[0].claimed, []);
});
