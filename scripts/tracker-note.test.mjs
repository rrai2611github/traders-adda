import test from "node:test";
import assert from "node:assert/strict";
import { trackerNote } from "../src/lib/backtest/trackerNoteFormat.ts";

const trade = (over) => ({ symbol: "X", entryDay: "2026-10-01", entryPrice: 100, exitDay: "2026-10-20", exitPrice: 92, quantity: 100, pnl: -800, r: -1.06, pnlPercent: -8, holdDays: 12, exitReason: "stop", rs: 90, ...over });
const result = (over = {}) => ({
  data: { symbols: 2500, firstDay: "2016-10-17", lastDay: "2026-10-20", sessions: 11 },
  markedValue: 1_012_000,
  equity: { days: [], account: [], benchmark: [1_000_000, 990_000], drawdown: [] },
  trades: [trade({ symbol: "HIT" }), trade({ symbol: "OLD", exitDay: "2026-10-10", exitReason: "trail", r: 0.5, pnl: 500 })],
  openPositions: [
    { symbol: "NEAR", entryDay: "2026-10-05", entryPrice: 100, quantity: 100, spent: 10000, last: 106, lastDay: "2026-10-20", stop: 92, exitLevel: 104, added: false, addPending: false, addAt: null, rs: 90 },
    { symbol: "FAR", entryDay: "2026-10-20", entryPrice: 200, quantity: 10, spent: 2000, last: 210, lastDay: "2026-10-20", stop: 184, exitLevel: 150, added: false, addPending: false, addAt: null, rs: 95 },
  ],
  pending: { signals: [{ symbol: "NEW", rs: 96, close: 300, stop: 276, quantity: 50, amount: 15000 }], breadth50: 42, breadthOk: true, niftyOk: null, slotsFree: 8 },
  ...over,
});

test("the daily note says what the account did, what closed or was bought today, and what is held", () => {
  const n = trackerNote(result(), 1_000_000, "2026-10-12");
  const text = n.lines.join("\n");
  assert.match(n.subject, /Live strategy check · \+1\.2% · 2 held · 1 closed · 2026-10-20/);
  assert.match(text, /account ₹10,12,000 \(\+₹12,000, \+1\.2%\) since 2026-10-12; Nifty 50 −1\.0%/);
  assert.match(text, /Closed today: HIT hit its stop \(−1\.06R, −₹800\)/);
  assert.doesNotMatch(text, /Closed today:.*OLD/);
  assert.match(text, /Bought at today's open: FAR at ₹200/);
  assert.match(text, /NEAR: ₹106 \(\+6\.0%\), stop ₹92, sell if it closes under ₹104 \(1\.9% away\) ⚠ close to its exit/);
  assert.match(text, /FAR: .*\(40\.0% away\)/);
  assert.doesNotMatch(text.split("FAR:")[1] ?? "", /close to its exit/);
  assert.match(text, /Next open the rules would buy: NEW \(RS 96, about 50 shares, stop ₹276\)/);
});

test("with the market check red the note says no buys, and with nothing held it says so", () => {
  const n = trackerNote(result({ openPositions: [], trades: [], pending: { signals: [], breadth50: 30, breadthOk: false, niftyOk: null, slotsFree: 10 } }), 1_000_000, "2026-10-12");
  const text = n.lines.join("\n");
  assert.match(text, /below the 35% the rules need/);
  assert.match(text, /Nothing is held\./);
  assert.match(text, /No trade opened or closed today\./);
  assert.match(text, /Next open: no buys, the market check is not passed\./);
  assert.match(n.subject, /no trades/);
});
