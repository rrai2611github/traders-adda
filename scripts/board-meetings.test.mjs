import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, nseDateToIso, resultsDates } from "../src/lib/market/boardMeetings.ts";

test("NSE dates are converted and bad ones rejected", () => {
  assert.equal(nseDateToIso("22-Oct-2026"), "2026-10-22");
  assert.equal(nseDateToIso("4-Nov-2026"), "2026-11-04");
  assert.equal(nseDateToIso("2026-10-22"), null);
  assert.equal(nseDateToIso("22-Foo-2026"), null);
});

test("only result meetings count, the soonest upcoming one wins, past ones are ignored", () => {
  const rows = [
    { bm_symbol: "AAA", bm_date: "30-Oct-2026", bm_purpose: "Financial Results" },
    { bm_symbol: "AAA", bm_date: "22-Oct-2026", bm_purpose: "Financial Results" },
    { bm_symbol: "AAA", bm_date: "19-Oct-2026", bm_purpose: "Board Meeting Intimation" },
    { bm_symbol: "BBB", bm_date: "10-Oct-2026", bm_purpose: "Financial Results" },
    { bm_symbol: "CCC", bm_date: "18-Oct-2026", bm_purpose: "Financial Results" },
    { bm_symbol: "DDD", bm_date: "bad", bm_purpose: "Financial Results" },
    { bm_date: "20-Oct-2026", bm_purpose: "Financial Results" },
  ];
  assert.deepEqual(resultsDates(rows, "2026-10-18"), { AAA: "2026-10-22", CCC: "2026-10-18" });
});

test("days until counts whole days", () => {
  assert.equal(daysUntil("2026-10-22", "2026-10-18"), 4);
  assert.equal(daysUntil("2026-10-18", "2026-10-18"), 0);
});
