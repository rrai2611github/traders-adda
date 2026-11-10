import test from "node:test";
import assert from "node:assert/strict";
import { deliverAlertBatch } from "../src/lib/alerts/alertDelivery.ts";
import { acknowledgeReadyAlert, decideReadyAlert, EMPTY_READY_STATE } from "../src/lib/alerts/readyAlertRules.ts";
import { acknowledgeTop5Alert, decideTop5Alert, EMPTY_TOP5_STATE } from "../src/lib/alerts/top5AlertRules.ts";

test("a failed Ready alert is retried without repeating an already accepted breakout", async () => {
  let saved = { lastReady: ["AAA", "BBB"], lastListDay: "2026-11-09", announced: {} };
  const reading = {
    day: "2026-11-11", afterClose: true,
    ready: [{ symbol: "CCC", rs: 92, underPivot: 2 }],
    broke: [{ symbol: "AAA", rs: 93, ext: 1 }, { symbol: "BBB", rs: 94, ext: 2 }],
  };
  const initial = structuredClone(saved);
  const decision = decideReadyAlert(saved, reading);
  let attempts = 0;
  await assert.rejects(deliverAlertBatch(saved, decision, async () => ++attempts === 1,
    (state, alert) => acknowledgeReadyAlert(state, alert, reading),
    (state) => { saved = state; }), /remains eligible for retry/);
  assert.deepEqual(initial.announced, {}, "deciding and acknowledging must not mutate previous state");
  assert.deepEqual(saved.announced, { AAA: reading.day });
  assert.equal(saved.lastListDay, "2026-11-09", "failed batch must not consume the after-close update");
  const retry = decideReadyAlert(saved, reading);
  assert.deepEqual(retry.alerts.map((alert) => alert.kind === "breakout" ? alert.symbol : alert.kind), ["BBB", "new"]);
  await deliverAlertBatch(saved, retry, async () => true,
    (state, alert) => acknowledgeReadyAlert(state, alert, reading), (state) => { saved = state; });
  assert.deepEqual(decideReadyAlert(saved, reading).alerts, []);
});

test("a failed Top-5 list email retries without repeating an accepted tier email", async () => {
  let saved = {
    ...EMPTY_TOP5_STATE, tier: "paper", pendingTier: "full", pendingCount: 1,
    lastSymbols: ["AAA"], lastListDay: "2026-11-09",
  };
  const reading = { tier: "full", symbols: ["BBB"], afterClose: true, day: "2026-11-11" };
  const decision = decideTop5Alert(saved, reading);
  assert.deepEqual(decision.alerts.map((alert) => alert.kind), ["tier", "list"]);
  await assert.rejects(deliverAlertBatch(saved, decision, async (alert) => alert.kind === "tier",
    (state, alert) => acknowledgeTop5Alert(state, alert, reading),
    (state) => { saved = state; }), /remains eligible for retry/);
  assert.equal(saved.tier, "full");
  assert.equal(saved.lastListDay, "2026-11-09");
  const retry = decideTop5Alert(saved, reading);
  assert.deepEqual(retry.alerts.map((alert) => alert.kind), ["list"]);
  await deliverAlertBatch(saved, retry, async () => true,
    (state, alert) => acknowledgeTop5Alert(state, alert, reading), (state) => { saved = state; });
  assert.deepEqual(decideTop5Alert(saved, reading).alerts, []);
});

test("false and thrown send failures never save an unaccepted alert", async () => {
  for (const send of [async () => false, async () => { throw new Error("SMTP unavailable"); }]) {
    const previous = { ...EMPTY_READY_STATE, lastReady: ["AAA"], lastListDay: "2026-11-09" };
    const reading = { day: "2026-11-11", afterClose: false, ready: [], broke: [{ symbol: "AAA", rs: 90, ext: 1 }] };
    let writes = 0;
    await assert.rejects(deliverAlertBatch(previous, decideReadyAlert(previous, reading), send,
      (state, alert) => acknowledgeReadyAlert(state, alert, reading), () => { writes += 1; }));
    assert.equal(writes, 0);
    assert.equal(decideReadyAlert(previous, reading).alerts.length, 1);
  }
});

test("an unaccepted tier change stays eligible on the next reading", async () => {
  const previous = { ...EMPTY_TOP5_STATE, tier: "paper", pendingTier: "full", pendingCount: 1 };
  const reading = { tier: "full", symbols: [], afterClose: false, day: "2026-11-11" };
  let writes = 0;
  await assert.rejects(deliverAlertBatch(previous, decideTop5Alert(previous, reading), async () => false,
    (state, alert) => acknowledgeTop5Alert(state, alert, reading), () => { writes += 1; }));
  assert.equal(writes, 0);
  assert.equal(decideTop5Alert(previous, reading).alerts[0].kind, "tier");
});

test("baseline-only and confirmation readings persist without sending email", async () => {
  for (const [previous, reading] of [
    [EMPTY_TOP5_STATE, { tier: "paper", symbols: ["AAA"], afterClose: true, day: "2026-11-11" }],
    [{ ...EMPTY_TOP5_STATE, tier: "paper" }, { tier: "full", symbols: [], afterClose: false, day: "2026-11-11" }],
  ]) {
    const decision = decideTop5Alert(previous, reading);
    let saved;
    await deliverAlertBatch(previous, decision, async () => assert.fail("no email expected"),
      (state, alert) => acknowledgeTop5Alert(state, alert, reading), (state) => { saved = state; });
    assert.deepEqual(saved, decision.state);
  }
});
