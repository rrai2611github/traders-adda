import test from "node:test";
import assert from "node:assert/strict";
import { decideReadyAlert, EMPTY_READY_STATE, readyAlertMessage } from "../src/lib/alerts/readyAlertRules.ts";

const stock = (symbol, rs = 92, underPivot = 3) => ({ symbol, rs, underPivot });
const reading = (over = {}) => ({ day: "2026-10-19", afterClose: false, ready: [], broke: [], ...over });

test("the first after-close list is only the baseline", () => {
  const { state, alerts } = decideReadyAlert(EMPTY_READY_STATE, reading({ afterClose: true, ready: [stock("AAA")] }));
  assert.deepEqual(alerts, []);
  assert.deepEqual(state.lastReady, ["AAA"]);
  assert.equal(state.lastListDay, "2026-10-19");
});

test("a stock on the list that breaks out is announced once a day", () => {
  const prev = { lastReady: ["AAA"], lastListDay: "2026-10-16", announced: {} };
  const first = decideReadyAlert(prev, reading({ broke: [{ symbol: "AAA", rs: 93, ext: 1.2 }] }));
  assert.equal(first.alerts.length, 1);
  assert.equal(first.alerts[0].kind, "breakout");
  const second = decideReadyAlert(first.state, reading({ broke: [{ symbol: "AAA", rs: 93, ext: 2.5 }] }));
  assert.deepEqual(second.alerts, []);
});

test("a breakout of a stock that was not on the list is not announced", () => {
  const prev = { lastReady: ["AAA"], lastListDay: "2026-10-16", announced: {} };
  assert.deepEqual(decideReadyAlert(prev, reading({ broke: [{ symbol: "ZZZ", rs: 99, ext: 1 }] })).alerts, []);
});

test("after the close, only stocks new to the list are announced, once a day", () => {
  const prev = { lastReady: ["AAA"], lastListDay: "2026-10-16", announced: {} };
  const r = reading({ afterClose: true, ready: [stock("AAA"), stock("BBB")] });
  const first = decideReadyAlert(prev, r);
  assert.equal(first.alerts.length, 1);
  assert.deepEqual(first.alerts[0].added.map((s) => s.symbol), ["BBB"]);
  assert.deepEqual(decideReadyAlert(first.state, r).alerts, []);
});

test("nothing new, nothing sent", () => {
  const prev = { lastReady: ["AAA"], lastListDay: "2026-10-16", announced: {} };
  assert.deepEqual(decideReadyAlert(prev, reading({ afterClose: true, ready: [stock("AAA")] })).alerts, []);
});

test("messages carry the market check and a results warning", () => {
  const m = readyAlertMessage({ kind: "breakout", symbol: "AAA", rs: 93, ext: 1.2 }, { breadth50: 30, resultsInDays: { AAA: 4 } });
  assert.match(m.subject, /AAA is breaking out/);
  assert.match(m.lines.join("\n"), /results in 4 days/);
  assert.match(m.lines.join("\n"), /only 30%/);
  const n = readyAlertMessage({ kind: "new", added: [stock("BBB")] }, { breadth50: 60 });
  assert.match(n.lines.join("\n"), /BBB/);
  assert.match(n.lines.join("\n"), /allowed/);
});
