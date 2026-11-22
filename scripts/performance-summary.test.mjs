import test from "node:test";
import assert from "node:assert/strict";
import { emailCheck, engineCheck, indexAutomation, indexPaperCard, monitoredQuote, positionsCard, stockAutomation, stockPaperCard, straddleAutomation, straddleCards, trackerAutomation, trackerCard } from "../src/lib/performance/summary.ts";

test("automation separates engine heartbeats, enabled entries and failed evaluations", () => {
  const now = Date.parse("2026-11-11T10:45:00+05:30");
  const engine = { running: true, lastTickAt: now, lastError: null, pausedReason: null };
  const stock = stockAutomation({ engine, orders: [] }, true, now);
  assert.equal(stock.status, "No active paper orders");
  assert.equal(stock.lastSuccessAt, null);
  const index = { engine, auto: { enabled: true, indexes: ["NIFTY"], log: [
    { index: "NIFTY", at: now, result: "skipped", message: "Could not evaluate: rate limit" },
    { index: "NIFTY", at: now - 3600000, result: "skipped", message: "No setup" },
  ] } };
  const cards = indexAutomation(index, true, now, true);
  assert.equal(cards[0].state, "error", "heartbeat cannot hide an evaluation error");
  assert.equal(cards[0].lastSuccessAt, now - 3600000);
  assert.equal(cards[1].status, "Automation off");
  assert.equal(cards[1].state, "idle");
  index.auto.log = [{ index: "NIFTY", at: now, result: "blocked", message: "Trade-time freshness unverified: new paper entries blocked." }];
  assert.equal(indexAutomation(index, true, now, true)[0].state, "watch");
  assert.equal(indexAutomation(index, true, now, true)[0].status, "Paper entries blocked");
  index.auto.log = [];
  assert.equal(indexAutomation(index, true, now, false)[0].status, "Fyers login required");
  assert.equal(indexAutomation(index, false, now, true)[0].status, "Market closed");
  assert.equal(indexAutomation(index, true, now, true)[0].lastSuccessAt, null);
});

test("daily replay and straddle statuses do not imply live execution or recovered history", () => {
  const tracker = trackerAutomation({ config: { capital: 100 }, job: { status: "done", result: { data: { lastDay: "2026-11-09" } } } });
  assert.equal(tracker.status, "Waiting for completed daily prices");
  assert.equal(tracker.lastSuccessAt, "2026-11-09");
  assert.match(tracker.cadence, /not intraday/);
  const now = Date.parse("2026-11-11T10:45:00+05:30");
  const s = { days: [{ index: "NIFTY", day: "2026-10-29", status: "open" }], lastRunAt: now, lastError: null };
  assert.equal(straddleAutomation(s, true, now, true).state, "watch");
  assert.equal(straddleAutomation(s, true, now, true).lastSuccessAt, null);
  assert.match(straddleAutomation(s, true, now, true).detail, /Expired contracts cannot be recreated/);
  assert.equal(straddleAutomation({ ...s, lastError: "rate limit" }, true, now, true).state, "error");
});

test("price monitoring distinguishes recent, stale, unverified, simulated and delayed prices", () => {
  const now = Date.now();
  const q = { source: "fyers", timestamp: now, tradeTimestamp: now - 1000, timestampBasis: "trade" };
  assert.equal(monitoredQuote(q, true, now).label, "Recent provider quote");
  assert.equal(monitoredQuote({ ...q, tradeTimestamp: now - 120001 }, true, now).label, "Stale price");
  assert.equal(monitoredQuote({ ...q, tradeTimestamp: now - 120000 }, true, now).label, "Recent provider quote");
  assert.equal(monitoredQuote({ ...q, tradeTimestamp: null }, true, now).label, "Freshness unverified");
  assert.equal(monitoredQuote({ ...q, source: "yahoo" }, true, now).label, "Delayed / fallback");
  assert.equal(monitoredQuote({ ...q, source: "mock" }, true, now).label, "Simulated");
  assert.equal(monitoredQuote(q, false, now).label, "Last available price");
  assert.equal(monitoredQuote(undefined, true, now).label, "Unavailable");
});

test("tracker excludes open marks from wins and uses the actual marked account value", () => {
  const state = {
    config: { capital: 1000 },
    history: { lastCandleDay: "2026-10-30" },
    job: { status: "done", result: {
      settings: { capital: 1000 }, markedValue: 1110,
      stats: { totalProfit: 100, totalReturnPercent: 10, maxDrawdownPercent: 3 },
      trades: [{ exitReason: "stop", pnl: -20, r: -1 }, { exitReason: "trail", pnl: 80, r: 4 }, { exitReason: "end", pnl: 40, r: 2 }],
      tradeCount: 3, openPositions: [{ quantity: 2, last: 75 }],
      equity: { benchmark: [100, 105] }, data: { lastDay: "2026-10-30" },
    } },
  };
  const c = trackerCard(state);
  assert.equal(c.closed, 2);
  assert.equal(c.open, 1);
  assert.equal(c.closedPnl, 60);
  assert.equal(c.openPnl, 50);
  assert.equal(c.totalPnl, 110);
  assert.equal(c.returnPct, 11);
  assert.equal(c.winRate, 50);
  assert.equal(c.expectancyR, 1.5);
  assert.ok(Math.abs(c.benchmarkPct - 5) < 1e-10);
  const capped = trackerCard({ ...state, job: { status: "done", result: { ...state.job.result, tradeCount: 100 } } });
  assert.equal(capped.winRate, null);
  assert.equal(capped.closedPnl, null);
  assert.equal(capped.totalPnl, 110);
});

test("waiting tracker has no fabricated zero profit", () => {
  const c = trackerCard({ config: { capital: 1000000 }, history: { lastCandleDay: "2026-10-30" }, job: { status: "waiting", message: "Waiting for first session." } });
  assert.equal(c.totalPnl, null);
  assert.equal(c.winRate, null);
  assert.match(c.note, /Waiting/);
});

test("stock paper excludes demo exposure and retains net costs and partial-exit residual", () => {
  const c = stockPaperCard({
    initialCapital: 1000, engine: { lastTickAt: 123 },
    orders: [
      { id: "demo-1", status: "open", remainingQuantity: 999, entryPrice: 100 },
      { id: "real-1", source: "scan", status: "open", remainingQuantity: 2, entryPrice: 100 },
    ],
    totals: { net: 50 }, stats: { net: 20, closed: 1, winRate: 100, expectancyR: 1, maxDrawdown: 0 },
  });
  assert.equal(c.deployed, 200);
  assert.equal(c.open, 1);
  assert.equal(c.openPnl, 30);
  assert.equal(c.totalPnl, 50);
  assert.equal(c.returnPct, 5);
});

test("index paper never includes pending/cancelled orders in P&L", () => {
  const c = indexPaperCard({
    capital: 1000, risk: { marginUsed: 120 }, engine: { lastTickAt: 123 },
    orders: [{ status: "pending", netPnl: -50 }, { status: "cancelled", netPnl: -20 }, { status: "open", netPnl: 10 }],
    stats: { closed: 1, net: 20, winRate: 100, expectancyR: 1, maxDrawdown: 0 },
  });
  assert.equal(c.totalPnl, 30);
  assert.equal(c.returnPct, 3);
  assert.equal(c.open, 1);
});

test("straddles combine daily legs, split open days and do not invent capital", () => {
  const summary = { closedDays: 2, winDays: 1, netRs: 100, maxDrawdown: 80, needed: 40, realToModel: 0.87 };
  const cards = straddleCards({
    summary: { NIFTY: summary, BANKNIFTY: summary },
    days: [{ index: "NIFTY", day: "2026-10-30", status: "open", netRs: -40 }],
  }, "2026-10-30");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].winRate, 50);
  assert.equal(cards[0].totalPnl, 60);
  assert.equal(cards[0].returnPct, null);
  assert.equal(cards[0].capital, null);
});

test("unresolved older straddle days cannot masquerade as current P&L", () => {
  const summary = { closedDays: 2, winDays: 1, netRs: 100, maxDrawdown: 80, needed: 40, realToModel: 1 };
  const cards = straddleCards({
    summary: { NIFTY: summary, BANKNIFTY: summary },
    days: [{ index: "NIFTY", day: "2026-10-29", status: "open", netRs: 500 }],
  }, "2026-10-30");
  assert.equal(cards[0].closedPnl, 100);
  assert.equal(cards[0].totalPnl, null);
  assert.equal(cards[0].openPnl, null);
  assert.match(cards[0].note, /Older days remain open/);
});

test("recorded real trades remain gross and have no fabricated account return", () => {
  const c = positionsCard({ lastDay: "2026-10-30", open: [{}], journal: { count: 2, winRate: 50, avgR: 0.5, totalPnl: 100 }, exposure: { invested: 500, openPnl: -20 } });
  assert.equal(c.evidence, "Manually recorded");
  assert.equal(c.totalPnl, 80);
  assert.equal(c.capital, null);
  assert.equal(c.returnPct, null);
  assert.match(c.note, /Gross/);
});

test("engine status treats closed market as idle, but preserves errors and detects missed live heartbeats", () => {
  const engine = { running: true, lastTickAt: 1000, lastError: null, pausedReason: null };
  assert.equal(engineCheck("p", "Paper", engine, false, 1000000).state, "idle");
  assert.equal(engineCheck("p", "Paper", engine, true, 121001).state, "watch");
  assert.equal(engineCheck("p", "Paper", engine, true, 121000).state, "ok");
  assert.equal(engineCheck("p", "Paper", { ...engine, lastError: "No quote" }, false, 1000).state, "error");
});

test("email statuses distinguish disabled, pending slot and provider acceptance from delivery", () => {
  const s = { configured: true, autoSend: true, lastSentAt: 1, lastSentSlotKey: "today-10", lastError: null };
  assert.equal(emailCheck("e", "Email", s, "today-11").state, "watch");
  assert.equal(emailCheck("e", "Email", s, null).state, "ok");
  assert.equal(emailCheck("e", "Email", { ...s, autoSend: false }, null).state, "watch");
  assert.equal(emailCheck("e", "Email", { ...s, lastError: "Provider failed" }, null).state, "error");
  assert.match(emailCheck("e", "Email", s, null).detail, /inbox delivery is not verified/);
});
