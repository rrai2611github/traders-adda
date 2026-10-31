import test from "node:test";
import assert from "node:assert/strict";
import { decideTop5Alert, EMPTY_TOP5_STATE, top5AlertMessage } from "../src/lib/alerts/top5AlertRules.ts";

const reading = (tier, symbols = ["A", "B"], afterClose = false, day = "2026-10-19") => ({ tier, symbols, afterClose, day });

test("the first reading sets the baseline and sends nothing", () => {
  const { state, alerts } = decideTop5Alert(EMPTY_TOP5_STATE, reading("paper"));
  assert.equal(state.tier, "paper");
  assert.deepEqual(alerts, []);
});

test("a tier change needs two readings in a row", () => {
  let s = decideTop5Alert(EMPTY_TOP5_STATE, reading("paper")).state;
  let r = decideTop5Alert(s, reading("full"));
  assert.deepEqual(r.alerts, []);
  assert.equal(r.state.pendingTier, "full");
  r = decideTop5Alert(r.state, reading("full"));
  assert.deepEqual(r.alerts, [{ kind: "tier", from: "paper", to: "full" }]);
  assert.equal(r.state.tier, "full");
  assert.equal(r.state.pendingCount, 0);
});

test("a flicker back resets the pending change", () => {
  let s = decideTop5Alert(EMPTY_TOP5_STATE, reading("paper")).state;
  s = decideTop5Alert(s, reading("full")).state;
  const r = decideTop5Alert(s, reading("paper"));
  assert.deepEqual(r.alerts, []);
  assert.equal(r.state.pendingTier, null);
  assert.equal(decideTop5Alert(r.state, reading("full")).alerts.length, 0);
});

test("after the close the first list is the baseline, later changes alert once a day", () => {
  let r = decideTop5Alert({ ...EMPTY_TOP5_STATE, tier: "full" }, reading("full", ["A", "B"], true, "2026-10-19"));
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.state.lastSymbols, ["A", "B"]);
  r = decideTop5Alert(r.state, reading("full", ["A", "C"], true, "2026-10-20"));
  assert.deepEqual(r.alerts, [{ kind: "list", added: ["C"], removed: ["B"] }]);
  r = decideTop5Alert(r.state, reading("full", ["A", "D"], true, "2026-10-20"));
  assert.deepEqual(r.alerts, [], "already checked today");
});

test("an unchanged list and a paper-only market send no list email", () => {
  let r = decideTop5Alert({ ...EMPTY_TOP5_STATE, tier: "paper" }, reading("paper", ["A"], true, "2026-10-19"));
  r = decideTop5Alert(r.state, reading("paper", ["B"], true, "2026-10-20"));
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.state.lastSymbols, ["B"]);
  let q = decideTop5Alert({ ...EMPTY_TOP5_STATE, tier: "full" }, reading("full", ["A"], true, "2026-10-19"));
  q = decideTop5Alert(q.state, reading("full", ["A"], true, "2026-10-20"));
  assert.deepEqual(q.alerts, []);
});

test("messages name the new market tier and list the picks", () => {
  const picks = [{ symbol: "AAA", rs: 98, close: 342.9, stop: 309.4, target: 443.3 }];
  const up = top5AlertMessage({ kind: "tier", from: "paper", to: "full" }, picks, 62);
  assert.match(up.subject, /Normal size/);
  assert.match(up.lines.join("\n"), /1\. AAA · RS 98/);
  assert.match(up.lines.join("\n"), /Breadth is 62%/);
  const list = top5AlertMessage({ kind: "list", added: ["X"], removed: ["Y"] }, picks, 55);
  assert.match(list.subject, /1 in, 1 out/);
  assert.match(list.lines.join("\n"), /New: X/);
  assert.match(list.lines.join("\n"), /Dropped: Y/);
});
