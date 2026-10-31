import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBreakoutEvents } from "../src/lib/screen/breakoutFeed.ts";

test("nested bases produce one breakout record per stock and session", () => {
  const events = [
    { d: "2026-09-28", symbol: "AAA", level: 3, pivot: 105, tags: ["VCP"] },
    { d: "2026-09-28", symbol: "AAA", level: 1, pivot: 110, tags: ["Blue sky"] },
    { d: "2026-09-28", symbol: "BBB", level: 2, pivot: 50, tags: [] },
    { d: "2026-09-25", symbol: "AAA", level: 1, pivot: 95, tags: ["IPO base"] },
  ];

  const result = canonicalBreakoutEvents(events);

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.find((event) => event.d === "2026-09-28" && event.symbol === "AAA"),
    {
      d: "2026-09-28",
      symbol: "AAA",
      level: 1,
      pivot: 110,
      tags: ["VCP", "Blue sky"],
    },
  );
  assert.ok(result.some((event) => event.d === "2026-09-25" && event.symbol === "AAA"));
});
