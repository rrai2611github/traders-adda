import test from "node:test";
import assert from "node:assert/strict";
import { assessHealth, healthLines, isLastSessionOfMonth, losingStreak95, percentileOf, rollingReturns } from "../src/lib/backtest/health.ts";

// A deterministic baseline: 120 trades, 40% winners at +2R, losers at -1R (average +0.2R), over three years of sessions.
const baseTrades = (n = 120, from = "2017-01-02") => Array.from({ length: n }, (_, i) => {
  const win = i % 5 < 2;
  const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 9 * 86_400_000).toISOString().slice(0, 10);
  return { r: win ? 2 : -1, pnl: win ? 2000 : -1000, entryDay: d, exitDay: d };
});
const account = (growthPerSession, n = 900) => Array.from({ length: n }, (_, i) => 1_000_000 * (1 + growthPerSession) ** i);

const baseline = (over = {}) => ({ trades: baseTrades(), account: account(0.0005), maxDrawdownPercent: -25, lastDay: "2026-10-30", ...over });

test("rolling returns and percentiles", () => {
  const r = rollingReturns([100, 110, 121, 133.1], 2);
  assert.deepEqual(r.map((x) => Math.round(x)), [21, 21]);
  assert.equal(percentileOf([1, 2, 3, 4], 2), 50);
  assert.equal(percentileOf([], 5), 50);
});

test("the losing-streak limit is reproducible and grows with the number of trades", () => {
  const wins = baseTrades().map((t) => t.pnl > 0);
  assert.equal(losingStreak95(wins, 30), losingStreak95(wins, 30));
  assert.ok(losingStreak95(wins, 200) >= losingStreak95(wins, 20));
  assert.ok(losingStreak95(wins, 20) >= 3);
});

test("with the live check not started the monitor reports the backtest only and says so", () => {
  const r = assessHealth({ baseline: baseline(), live: null });
  assert.ok(r.checks.some((c) => c.key === "live" && c.state === "early"));
  assert.ok(["on-track", "early"].includes(r.verdict));
});

test("fewer than 15 live trades can never raise an alarm, however bad", () => {
  const trades = Array.from({ length: 8 }, () => ({ r: -1, pnl: -1000, entryDay: "2026-09-01", exitDay: "2026-09-10" }));
  const r = assessHealth({ baseline: baseline(), live: { trades, maxDrawdownPercent: -9, sessions: 20, startDate: "2026-09-01" } });
  assert.ok(!r.checks.some((c) => c.state === "alert"));
  assert.ok(r.checks.some((c) => c.key === "live-trades" && c.state === "early"));
  assert.ok(r.checks.some((c) => c.key === "live-drawdown" && c.state === "early"));
});

test("live results in line with the backtest are on track; clearly worse ones are flagged for review", () => {
  const fair = Array.from({ length: 40 }, (_, i) => ({ r: i % 5 < 2 ? 2 : -1, pnl: i % 5 < 2 ? 2000 : -1000, entryDay: "2026-09-01", exitDay: "2026-09-10" }));
  const ok = assessHealth({ baseline: baseline(), live: { trades: fair, maxDrawdownPercent: -12, sessions: 120, startDate: "2026-06-01" } });
  assert.ok(!ok.checks.some((c) => c.state === "alert"));
  assert.equal(ok.verdict, "on-track");
  const bad = Array.from({ length: 40 }, (_, i) => ({ r: i % 10 === 0 ? 1 : -1, pnl: i % 10 === 0 ? 1000 : -1000, entryDay: "2026-09-01", exitDay: "2026-09-10" }));
  const review = assessHealth({ baseline: baseline(), live: { trades: bad, maxDrawdownPercent: -45, sessions: 120, startDate: "2026-06-01" } });
  assert.equal(review.verdict, "review");
  assert.ok(review.checks.some((c) => c.key === "live-r" && c.state === "alert"));
  assert.ok(review.checks.some((c) => c.key === "live-drawdown" && c.state === "alert"));
  assert.match(review.headline, /^Review the rules:/);
});

test("drift: a recent year in the bottom of all rolling years is flagged, and a normal one is not", () => {
  const flat = baseline({ account: [...account(0.0006, 700), ...account(-0.0002, 252).map((v) => v * 1.0)].map((v, i) => (i < 700 ? v : 1_000_000 * 1.5 * (1 - 0.0004) ** (i - 700))) });
  const r = assessHealth({ baseline: flat, live: null });
  assert.equal(r.checks.find((c) => c.key === "drift-return").state, "alert");
  const steady = assessHealth({ baseline: baseline(), live: null });
  assert.notEqual(steady.checks.find((c) => c.key === "drift-return").state, "alert");
});

test("a recent run of losing trades against a long good record shows up as watch or alert once there are enough of them", () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ r: -1, pnl: -1000, entryDay: `2026-0${(i % 9) + 1}-10`, exitDay: `2026-0${(i % 9) + 1}-20` }));
  const earlier = baseTrades(80, "2018-01-02");
  const r = assessHealth({ baseline: baseline({ trades: [...earlier, ...recent] }), live: null });
  const c = r.checks.find((x) => x.key === "drift-trade");
  assert.ok(c && ["watch", "alert"].includes(c.state));
});

test("the last session of a month is found, including a month that ends on a weekend", () => {
  const trading = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };
  assert.equal(isLastSessionOfMonth("2026-10-30", trading), true); // Fri; 31 Oct is Saturday
  assert.equal(isLastSessionOfMonth("2026-10-29", trading), false);
  assert.equal(isLastSessionOfMonth("2026-11-30", trading), true);
  assert.equal(isLastSessionOfMonth("2026-11-27", trading), false);
});

test("the owner lines carry every check with its state and the not-a-rule-change reminder", () => {
  const lines = healthLines(assessHealth({ baseline: baseline(), live: null }));
  assert.ok(lines.some((l) => /^\[EARLY\] Live strategy check/.test(l)));
  assert.match(lines.at(-1), /never changes a rule/);
});

test("a live check that was started but has no finished session yet says so, not 'not started'", () => {
  const waiting = assessHealth({ baseline: baseline(), live: null, liveStartedOn: "2026-10-31" });
  const check = waiting.checks.find((c) => c.key === "live");
  assert.equal(check.state, "early");
  assert.match(check.detail, /Started on 2026-10-31; waiting for its first finished session/);
  const never = assessHealth({ baseline: baseline(), live: null, liveStartedOn: null });
  assert.match(never.checks.find((c) => c.key === "live").detail, /^Not started/);
});
