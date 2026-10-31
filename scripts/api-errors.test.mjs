import assert from "node:assert/strict";
import { test } from "node:test";
import { universeWarmingResponse } from "../src/lib/market/apiErrors.ts";

test("omits an ETA before there is enough progress or elapsed time to estimate from", async () => {
  const body = await universeWarmingResponse({ phase: "history", done: 5, total: 2000, startedAt: Date.now() }).json();
  assert.equal(body.error, "Loading NSE universe daily history: 5 of 2000 symbols.");
});

test("adds a seconds-based ETA once there is enough progress and elapsed time", async () => {
  // 100 done in 10s -> rate 10/s -> 1900 remaining / 10/s = 190s, rounds to minutes.
  const startedAt = Date.now() - 10_000;
  const body = await universeWarmingResponse({ phase: "quotes", done: 100, total: 2000, startedAt }).json();
  assert.match(body.error, /^Loading NSE universe quotes: 100 of 2000 symbols\. — about \d+ min left$/);
});

test("uses seconds under a minute remaining", async () => {
  // 990 done of 1000 in 10s -> rate 99/s -> 10 remaining / 99/s ≈ 0.1s, still < 60s.
  const startedAt = Date.now() - 10_000;
  const body = await universeWarmingResponse({ phase: "history", done: 990, total: 1000, startedAt }).json();
  assert.match(body.error, /about \d+s left$/);
});

test("carries warming status, 503 and Retry-After through unchanged", async () => {
  const res = universeWarmingResponse({ phase: "history", done: 0, total: 100, startedAt: Date.now() });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "5");
  const body = await res.json();
  assert.equal(body.warming, true);
});
