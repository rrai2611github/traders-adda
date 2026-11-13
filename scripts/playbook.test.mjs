import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_RULES, trackerSettings } from "../src/lib/backtest/tracker.ts";
import { SETUP_BREADTH_MIN, setupStatus } from "../src/lib/screen/setupGate.ts";
import { TRADE_STATUS, TRADE_STATUS_ORDER } from "../src/lib/screen/tradeStatus.ts";
import { GLOSSARY } from "../src/lib/glossary.ts";
import { computePositionSize } from "../src/lib/screen/positionSize.ts";

const page = readFileSync(new URL("../src/components/PlaybookPage.tsx", import.meta.url), "utf8");
const settings = trackerSettings({ startDate: "2026-01-01", startedAt: 0, capital: 1_000_000, niftyGate: false, stopPercent: 12 });
const rules = LIVE_RULES.lines.join(" ");

test("the rules the playbook quotes are the rules the live strategy check actually runs", () => {
  assert.equal(settings.maxPositions, 10);
  assert.equal(settings.maxNewPerDay, 3);
  assert.equal(settings.sizing.riskPercent, 2);
  assert.equal(settings.positionCapPercent, 20);
  assert.equal(settings.costPercent, 0.25);
  assert.equal(settings.stop.percent, 12);
  assert.equal(settings.breadthMin, SETUP_BREADTH_MIN);
  for (const fragment of ["10 positions", "3 a day", "35%", "12%", "2% of the account", "20% of the account", "0.25%", "50-day average"]) {
    assert.ok(rules.includes(fragment), `LIVE_RULES should mention "${fragment}"`);
  }
});

test("the page takes the strategy text and the market check from the code, not from its own copy", () => {
  assert.match(page, /rules\.lines\.map/);
  assert.match(page, /SETUP_BREADTH_MIN/);
  assert.match(page, /TRADE_STATUS\[key\]\.meaning/);
  assert.match(page, /computePositionSize/);
  // It must not hard-code a competing market-check threshold.
  assert.doesNotMatch(page, /\b(30|40|45|50)% of (liquid )?stocks are above/);
});

test("the market check behaves as the page describes", () => {
  assert.equal(setupStatus(SETUP_BREADTH_MIN, null).allowed, true);
  assert.equal(setupStatus(SETUP_BREADTH_MIN - 1, null).allowed, false);
  // The Nifty 200-day line is information only, as the page says.
  assert.equal(setupStatus(SETUP_BREADTH_MIN + 10, { above: false, percent: -5 }).allowed, true);
});

test("each status the page explains exists, and the short status is the only one left out", () => {
  const shown = TRADE_STATUS_ORDER.filter((key) => key !== "short-ready");
  assert.deepEqual(shown, ["buy-ready", "watch", "extended", "avoid"]);
  for (const key of shown) assert.ok(TRADE_STATUS[key].meaning.length > 10);
});

test("the glossary lines the page prints carry the same numbers as the rules", () => {
  assert.match(GLOSSARY.positionSize.text, /2%/);
  assert.match(GLOSSARY.positionSize.text, /20%/);
  assert.ok(GLOSSARY.backtest.text.length > 20 && GLOSSARY.winRate.text.length > 20 && GLOSSARY.drawdown.text.length > 20);
});

test("the worked example on the page sizes a 12% stop the way the rules say", () => {
  // ₹10 lakh account, ₹500 buy, 12% stop, 2% risk: risk budget ₹20,000, loss per share ₹60, so 333 shares, ₹1.665 lakh in.
  const size = computePositionSize({ accountSize: 1_000_000, entry: 500, stop: 440, riskPercent: 2 });
  assert.equal(size.quantity, 333);
  assert.equal(size.riskBudget, 20_000);
  assert.ok(size.capitalRequired / 1_000_000 < 0.2); // under the 20% cap
  // A wider stop means fewer shares, never more.
  assert.ok(computePositionSize({ accountSize: 1_000_000, entry: 500, stop: 400, riskPercent: 2 }).quantity < size.quantity);
  // A stop that cannot be afforded gives zero shares, which the page tells the reader to skip.
  assert.equal(computePositionSize({ accountSize: 1_000, entry: 500, stop: 440, riskPercent: 1 }).tooSmall, true);
});
