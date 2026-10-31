import test from "node:test";
import assert from "node:assert/strict";
import { actionLines, assessHolding, closedTrades, parseNewHolding, parseSale, ruleStop, summariseJournal } from "../src/lib/positions/positions.ts";

const NOW = Date.parse("2026-10-30T12:00:00+05:30");
// 60 daily candles ending 2026-10-30, closing steadily around `base`.
const candles = (n = 60, base = 100, step = 0.2, lowGap = 1) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.parse("2026-10-30T00:00:00Z") - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const close = base + (i - n + 1) * step;
    out.push({ date: d, low: close - lowGap, close });
  }
  return out;
};
const holding = (over = {}) => ({ id: "a", symbol: "TEST", qty: 100, buyPrice: 100, buyDate: "2026-09-01", stop: 92, ...over });

test("the rules' stop is 12% under the buy, on the 5-paise tick; 8% is the tighter option", () => {
  assert.equal(ruleStop(100), 88);
  assert.equal(ruleStop(333.33), 293.35);
  assert.equal(ruleStop(100, 8), 92);
});

test("a new position is validated, and the stop and date default sensibly", () => {
  const ok = parseNewHolding({ symbol: " kpittech ", qty: "50", buyPrice: "1200.5" }, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { symbol: "KPITTECH", qty: 50, buyPrice: 1200.5, buyDate: "2026-10-30", stop: ruleStop(1200.5) });
  const bad = (over) => parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 100, ...over }, NOW);
  assert.match(bad({ symbol: "A B" }).error, /symbol/i);
  assert.match(bad({ qty: 1.5 }).error, /whole number/);
  assert.match(bad({ qty: 0 }).error, /whole number/);
  assert.match(bad({ buyPrice: -1 }).error, /price/);
  assert.match(bad({ stop: 100 }).error, /below the price/);
  assert.match(bad({ stop: 120 }).error, /below the price/);
  assert.match(bad({ buyDate: "2026-11-02" }).error, /future/);
  assert.match(bad({ buyDate: "2026-02-31" }).error, /real date/);
  assert.equal(bad({ note: "x".repeat(500) }).value.note.length, 200);
});

test("a sale must follow the buy, not be in the future, and say why", () => {
  const h = holding();
  assert.equal(parseSale({ price: 120, date: "2026-10-20", reason: "own-call" }, h, NOW).ok, true);
  assert.match(parseSale({ price: 120, date: "2026-08-01", reason: "stop" }, h, NOW).error, /before the buy/);
  assert.match(parseSale({ price: 120, date: "2026-12-01", reason: "stop" }, h, NOW).error, /future/);
  assert.match(parseSale({ price: 0, reason: "stop" }, h, NOW).error, /sold at/);
  assert.match(parseSale({ price: 100, reason: "because" }, h, NOW).error, /why/);
  assert.match(parseSale({ price: 100, reason: "stop" }, holding({ sold: { date: "2026-10-01", price: 90, reason: "stop" } }), NOW).error, /already closed/);
  assert.equal(parseSale({ price: 100, reason: "stop" }, h, NOW).value.date, "2026-10-30");
});

test("a healthy position holds, with its gain in R", () => {
  // Closes rise 0.2 a day to 100 on the last day; bought at 90 with a stop at 82.8 (risk 7.2).
  const a = assessHolding(holding({ buyPrice: 90, stop: 82.8 }), candles(), NOW);
  assert.equal(a.status, "hold");
  assert.equal(a.last, 100);
  assert.ok(Math.abs(a.rNow - 10 / 7.2) < 1e-9);
  assert.equal(a.pnl, 1000);
  assert.match(a.headline, /above its 50-day average/);
  assert.equal(a.daysHeld, 59);
});

test("a close under the 50-day average is an exit signal", () => {
  // A stock that has been sliding for two months closes under its own 50-day average.
  const falling = assessHolding(holding({ buyPrice: 130, stop: 60 }), candles(60, 100, -0.5), NOW);
  assert.equal(falling.status, "exit-signal");
  const dropped = [...candles(59, 100, 0.2).map((c) => ({ ...c, low: c.close - 0.1 })), { date: "2026-10-30", low: 91, close: 92 }];
  const b = assessHolding(holding({ buyPrice: 95, stop: 80 }), dropped, NOW);
  assert.equal(b.status, "exit-signal");
  assert.match(b.action, /next open/);
});

test("a low through the stop after the buy day is a stop hit, even if the close recovered", () => {
  const cs = candles(60, 100, 0.2);
  cs[55] = { ...cs[55], low: 90 };
  const a = assessHolding(holding({ buyPrice: 95, stop: 91 }), cs, NOW);
  assert.equal(a.status, "stop-hit");
  assert.match(a.headline, /through your/);
});

test("the buy day's own low does not count as a stop hit", () => {
  const cs = candles(60, 100, 0.2);
  const buyDay = cs[59].date;
  cs[59] = { ...cs[59], low: 80 };
  const a = assessHolding(holding({ buyDate: buyDay, buyPrice: 99, stop: 91 }), cs, NOW);
  assert.notEqual(a.status, "stop-hit");
  assert.notEqual(a.status, "exit-signal");
});

test("within 3% of the stop is flagged, with a warning not to move it", () => {
  const cs = candles(60, 100, 0);
  const a = assessHolding(holding({ buyPrice: 110, stop: 98 }), cs.map((c) => ({ ...c, low: c.close - 0.5 })), NOW);
  assert.equal(a.status, "close-to-stop");
  assert.match(a.action, /Do not move the stop down/);
});

test("fewer than 50 candles cannot show an exit signal, and no candles means no data", () => {
  const short = candles(30, 100, 0.2);
  assert.equal(assessHolding(holding({ buyPrice: 90, stop: 82 }), short, NOW).sma50, null);
  const none = assessHolding(holding(), [], NOW);
  assert.equal(none.status, "no-data");
  assert.equal(none.pnl, null);
});

const sold = (buy, stop, price, reason, date = "2026-10-10") => ({ id: `${buy}-${price}-${reason}`, symbol: "X", qty: 10, buyPrice: buy, buyDate: "2026-09-01", stop, sold: { date, price, reason } });

test("closed trades carry R and rupee profit, newest sale first", () => {
  const t = closedTrades([sold(100, 92, 116, "fifty-day", "2026-10-01"), sold(100, 92, 92, "stop", "2026-10-20"), holding()]);
  assert.equal(t.length, 2);
  assert.equal(t[0].holding.sold.date, "2026-10-20");
  assert.equal(t[0].r, -1);
  assert.equal(t[0].pnl, -80);
  assert.equal(t[1].r, 2);
});

test("the journal refuses to judge fewer than 10 trades", () => {
  const j = summariseJournal(closedTrades([sold(100, 92, 116, "fifty-day"), sold(100, 92, 92, "stop")]));
  assert.equal(j.count, 2);
  assert.equal(j.winRate, 50);
  assert.match(j.lines[0], /Only 2 closed trades/);
  assert.equal(summariseJournal([]).lines[0].startsWith("No closed trades"), true);
});

test("the journal says when selling on your own call cost you", () => {
  const trades = [
    ...[1, 2, 3].map((i) => sold(100, 92, 100 + i * 12, "fifty-day")),
    ...[1, 2, 3, 4].map((i) => sold(100, 92, 101 + i * 0.1, "own-call")),
    ...[1, 2, 3].map(() => sold(100, 92, 92, "stop")),
  ];
  const j = summariseJournal(closedTrades(trades));
  assert.equal(j.count, 10);
  assert.ok(j.lines.some((l) => /Selling early is costing you/.test(l)));
  assert.deepEqual(j.byReason.map((g) => g.reason), ["stop", "fifty-day", "own-call"]);
});

test("the owner's note lists only positions that need a decision, and is empty otherwise", () => {
  const fine = { holding: holding(), assessment: { status: "hold", headline: "ok", action: "Hold." } };
  const out = { holding: holding({ symbol: "OUT" }), assessment: { status: "exit-signal", headline: "Closed under.", action: "Sell." } };
  assert.deepEqual(actionLines([fine]), []);
  const lines = actionLines([fine, out]);
  assert.match(lines[0], /1 of your 2 open positions needs a decision/);
  assert.match(lines[1], /^OUT \(100 shares bought at ₹100\)/);
  assert.equal(lines.some((l) => l.includes("TEST")), false);
});

import { backupsToDelete, holdingsCsv } from "../src/lib/positions/positions.ts";

test("the CSV lists open and closed positions with profit and R, oldest first, and escapes text", () => {
  const open = holding({ id: "o", symbol: "OPENCO", buyDate: "2026-10-01", note: 'say "hi", ok' });
  const closed = { ...holding({ id: "c", symbol: "CLOSEDCO", buyDate: "2026-09-01", qty: 10, buyPrice: 100, stop: 88 }), sold: { date: "2026-09-20", price: 76, reason: "stop" } };
  const lines = holdingsCsv([open, closed]).trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Symbol,Shares,Buy date,Buy price,Stop,Status,Sell date,Sell price,Why sold,Profit or loss \(Rs\),Result in R,Planned price,Paid vs plan \(%\),Note$/);
  assert.equal(lines[1], "CLOSEDCO,10,2026-09-01,100,88,Closed,2026-09-20,76,Stop was hit,-240,-2,,,");
  assert.equal(lines[2], 'OPENCO,100,2026-10-01,100,92,Open,,,,,,,,"say ""hi"", ok"');
});

test("text that would run as a spreadsheet formula is neutralised, but negative numbers are not touched", () => {
  const evil = holding({ id: "e", symbol: "=CMD()", note: "+SUM(A1)" });
  const csv = holdingsCsv([evil, { ...holding({ id: "l", symbol: "LOSS", buyDate: "2026-10-02" }), sold: { date: "2026-10-05", price: 90, reason: "own-call" } }]);
  assert.match(csv, /^'=CMD\(\),/m);
  assert.match(csv, /,'\+SUM\(A1\)\r$/m);
  assert.match(csv, /LOSS,100,2026-10-02,100,92,Closed,2026-10-05,90,My own call,-1000,-1.25,/);
  assert.equal(holdingsCsv([]).trim(), "Symbol,Shares,Buy date,Buy price,Stop,Status,Sell date,Sell price,Why sold,Profit or loss (Rs),Result in R,Planned price,Paid vs plan (%),Note");
});

test("only the newest 30 daily backups are kept, and unrelated files are never deleted", () => {
  const names = Array.from({ length: 33 }, (_, i) => `positions-2026-09-${String(i + 1).padStart(2, "0")}.json`.replace("2026-09-31", "2026-10-01").replace("2026-09-32", "2026-10-02").replace("2026-09-33", "2026-10-03"));
  const gone = backupsToDelete([...names, "notes.txt", "positions.json"], 30);
  assert.equal(gone.length, 3);
  assert.deepEqual(gone, ["positions-2026-09-01.json", "positions-2026-09-02.json", "positions-2026-09-03.json"]);
  assert.deepEqual(backupsToDelete(names.slice(0, 5), 30), []);
});

import { sectorConcentration, SECTOR_LIMIT } from "../src/lib/positions/positions.ts";

test("sector concentration: only sectors over the limit are reported, biggest first; unknown sectors are never counted", () => {
  assert.equal(SECTOR_LIMIT, 3);
  const pos = (symbol, sector) => ({ symbol, sector });
  const items = [pos("A", "Banks"), pos("B", "Banks"), pos("C", "Banks"), pos("D", "Banks"), pos("E", "IT"), pos("F", "IT"), pos("G", "IT"), pos("H", "IT"), pos("I", "IT"), pos("J", null), pos("K", null), pos("L", null), pos("M", null)];
  const crowd = sectorConcentration(items);
  assert.deepEqual(crowd.map((c) => [c.sector, c.count]), [["IT", 5], ["Banks", 4]]);
  assert.deepEqual(crowd[1].symbols, ["A", "B", "C", "D"]);
  assert.deepEqual(sectorConcentration(items.slice(0, 3)), []);
  assert.deepEqual(sectorConcentration(items.slice(0, 4), 4), []);
  assert.deepEqual(sectorConcentration([]), []);
});

import { fillSlippagePercent, fillSummary, suggestedShares } from "../src/lib/positions/positions.ts";

test("a planned price is optional, validated, saved, and shows in the CSV with how far the fill was from it", () => {
  const ok = parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 101, plannedPrice: "100" }, NOW);
  assert.equal(ok.value.plannedPrice, 100);
  assert.equal(parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 101 }, NOW).value.plannedPrice, undefined);
  assert.equal(parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 101, plannedPrice: "" }, NOW).value.plannedPrice, undefined);
  assert.match(parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 101, plannedPrice: -3 }, NOW).error, /planned price/);
  assert.match(parseNewHolding({ symbol: "ABC", qty: 10, buyPrice: 101, plannedPrice: "abc" }, NOW).error, /planned price/);
  const csv = holdingsCsv([{ ...holding({ id: "p", symbol: "PLANNED", buyPrice: 101, stop: 88 }), plannedPrice: 100 }]);
  assert.match(csv, /PLANNED,100,2026-09-01,101,88,Open,,,,,,100,1,/);
});

test("fill slippage: positive means paid more than planned; no plan means no figure", () => {
  assert.equal(fillSlippagePercent({ buyPrice: 101, plannedPrice: 100 }), 1);
  assert.ok(Math.abs(fillSlippagePercent({ buyPrice: 99, plannedPrice: 100 }) + 1) < 1e-9);
  assert.equal(fillSlippagePercent({ buyPrice: 101 }), null);
  assert.deepEqual(fillSummary([holding(), holding({ id: "b" })]), { count: 0, avgPercent: null });
  const s = fillSummary([{ ...holding(), buyPrice: 101, plannedPrice: 100 }, { ...holding({ id: "b" }), buyPrice: 100.5, plannedPrice: 100 }, holding({ id: "c" })]);
  assert.equal(s.count, 2);
  assert.ok(Math.abs(s.avgPercent - 0.75) < 1e-9);
});

test("share suggestion: 2% of the account at risk, one position never over 20% of it", () => {
  // 10 lakh, buy 100, 12% stop: 2% = 20,000 at risk, 12 a share = 1,666 shares; 20% = 2,00,000 = 2,000 shares, so risk is the limit.
  assert.deepEqual(suggestedShares({ capital: 1_000_000, buy: 100, stop: 88 }), { qty: 1666, invested: 166600, atRisk: 19992, limitedBy: "risk" });
  // A tight 3% stop would allow 6,666 shares by risk, so the 20% size cap (2,000 shares) binds.
  const b = suggestedShares({ capital: 1_000_000, buy: 100, stop: 97 });
  assert.deepEqual([b.qty, b.limitedBy], [2000, "size"]);
  assert.equal(suggestedShares({ capital: 500_000, buy: 360.3, stop: 317, riskPercent: 1 }).qty, Math.floor(5000 / 43.3));
  for (const bad of [{ capital: 0, buy: 100, stop: 88 }, { capital: 1e6, buy: 100, stop: 100 }, { capital: 1e6, buy: 100, stop: 120 }, { capital: 1e6, buy: 0, stop: 0 }, { capital: 1e6, buy: 100, stop: 88, riskPercent: 0 }]) {
    assert.equal(suggestedShares(bad).qty, 0);
  }
  // A stock so dear that one share exceeds the cap leaves zero.
  assert.equal(suggestedShares({ capital: 100_000, buy: 50_000, stop: 44_000 }).qty, 0);
});
