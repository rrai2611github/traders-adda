// Replays the live paper-trading engine on real past 5-minute prices for one Buy ready signal.
// Usage: node --use-system-ca --no-warnings scripts/paper-replay.mjs SYMBOL YYYY-MM-DD(entry day) [capital] [--json]
//   [--until=YYYY-MM-DDTHH:MM (IST; stop the replay there to show a pending/open order)] [--cancel (cancel while pending)]
//   [--demo=FILE (append the order, id prefixed "demo-", to a JSON array the app can load as demo data)]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadBacktestData, loadBenchmark } from "./backtest-common.mjs";

const [symbol = "ATHERENERG", entryDay = "2026-08-24", capitalArg = "500000"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const until = flag("until") ? Date.parse(`${flag("until")}:00+05:30`) : Infinity;
const capital = Number(capitalArg);
const { runScanners, ALERT_SCANNER_KEYS, benchmarkCloses } = await import("../src/lib/screen/chartinkScans.ts");
const { assessBuyReady } = await import("../src/lib/screen/buyReady.ts");
const { scoreOscillators } = await import("../src/lib/screen/oscillatorScore.ts");
const { ema } = await import("../src/lib/screen/oscillators.ts");
const { computePositionSize } = await import("../src/lib/screen/positionSize.ts");
const { createPaperOrder, advancePaperOrder, cancelPaperOrder, istDayKey } = await import("../src/lib/screen/paperTrading.ts");

const { hist, rs, breadth } = loadBacktestData({ turnoverCr: 5 });
const c = hist.get(symbol);
if (!c) throw new Error(`${symbol} not in cache`);
const benchmark = benchmarkCloses(await loadBenchmark());
const settled = { dateKey: "2099-01-01", progress: 1 };
const entryIdx = c.findIndex((k) => istDayKey(k.t) === entryDay);
if (entryIdx < 0) throw new Error(`${entryDay} not a session for ${symbol}`);

// Latest Buy ready alert-scanner signal in the 3 sessions before the entry day, as the app would show at that close.
let signal = null;
for (let i = entryIdx - 1; i >= entryIdx - 3 && !signal; i--) {
  const slice = c.slice(Math.max(0, i - 799), i + 1);
  const closes = c.map((k) => k.close);
  const sma = (n) => closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n;
  const e21 = ema(closes, 21)[i];
  const hits = runScanners(symbol, slice, { rs: rs.get(symbol)[i] || null, benchmark }, settled);
  const sc = scoreOscillators(slice, settled);
  for (const k of ALERT_SCANNER_KEYS.filter((key) => hits[key])) {
    const a = assessBuyReady(k, hits[k], {
      breadthPercent: breadth.get(symbol)[i] >= 0 ? breadth.get(symbol)[i] : null, passesFloor: true,
      rs: rs.get(symbol)[i] || null, score: sc?.score, vs50: (c[i].close / sma(50) - 1) * 100,
      vs200: (c[i].close / sma(200) - 1) * 100, aboveEma21: (c[i].close / e21 - 1) * 100, atr: sc?.levels?.atr, candles: slice,
    });
    if (a.buyReady) { signal = { i, scanner: k, plan: a.plan, breadth: breadth.get(symbol)[i], rs: rs.get(symbol)[i] }; break; }
  }
}
if (!signal) throw new Error("No Buy ready alert-scanner signal in the 3 sessions before that day");

const signalDate = istDayKey(c[signal.i].t);
const plan = signal.plan;
const size = computePositionSize({ accountSize: capital, entry: plan.buyZoneHigh, stop: plan.stop });
const quantity = Math.min(size.quantity, Math.floor(capital / plan.buyZoneHigh));
const approvedAt = c[signal.i].t + 10.5 * 3600e3; // evening of the signal day, after the close
let order = createPaperOrder({ symbol, name: symbol, status: "buy-ready", sources: [signal.scanner], plan }, signalDate, quantity, approvedAt);

const inr = (x) => `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ist = (t) => new Date(t + 5.5 * 3600e3).toISOString().replace("T", " ").slice(0, 16);
console.log(`\nSIGNAL  ${symbol} · ${signal.scanner} · close ${signalDate} · RS ${signal.rs} · breadth ${signal.breadth.toFixed(0)}%`);
console.log(`PLAN    trigger ${inr(plan.entry)} · skip above ${inr(plan.buyZoneHigh)} · stop ${inr(plan.stop)} · T1 ${inr(plan.target1)} · T2 ${inr(plan.target2)}`);
console.log(`SIZE    ${quantity} shares (1% of ${inr(capital)} = ${inr(capital / 100)} risk at the zone top)\n`);

// Real 5-minute bars from the session after the signal until the order closes (max ~40 sessions).
const p1 = Math.floor(c[signal.i + 1].t / 1000) - 3600;
const p2 = Math.min(Math.floor(Date.now() / 1000), p1 + 60 * 86400);
const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=5m&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
const r = (await res.json()).chart.result?.[0];
if (!r?.timestamp) throw new Error("Yahoo has no 5-minute data for that window (only ~60 days are kept)");
const q = r.indicators.quote[0];

// Feed each bar to the engine as four quotes in a plausible path: open, nearer extreme, other extreme, close.
let shown = order.events.length;
const print = () => { for (const e of order.events.slice(shown)) console.log(`${ist(e.timestamp)} IST  ${e.message}`); shown = order.events.length; };
print();
let quotesSeen = 0;
for (let b = 0; b < r.timestamp.length && !["closed", "cancelled", "expired"].includes(order.status); b++) {
  const [o, h, l, cl] = [q.open[b], q.high[b], q.low[b], q.close[b]];
  if (![o, h, l, cl].every((x) => x > 0)) continue;
  const t0 = r.timestamp[b] * 1000;
  if (t0 >= until) break;
  const path = cl >= o ? [o, l, h, cl] : [o, h, l, cl];
  for (let k = 0; k < 4; k++) {
    const timestamp = t0 + k * 60e3 + 1000;
    if (timestamp >= until) break;
    const result = advancePaperOrder(order, { price: path[k], timestamp }, { phase: "OPEN", isLive: true, simulated: false, now: timestamp + 1000 });
    if (result.accepted) { order = result.order; quotesSeen++; }
  }
  print();
}
if (process.argv.includes("--cancel") && order.status === "pending") {
  order = cancelPaperOrder(order, Math.min(until, Date.now()));
  print();
}
if (flag("demo")) {
  const file = flag("demo");
  const list = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  list.push({ ...order, id: `demo-${order.id}`, name: `${symbol} (demo replay)` });
  writeFileSync(file, JSON.stringify(list));
}
console.log(`\nRESULT  status ${order.status} · realized P&L ${inr(order.realizedPnl)} (${((order.realizedPnl / capital) * 100).toFixed(2)}% of capital) · ${quotesSeen} live quotes processed`);
if (process.argv.includes("--json")) console.log(`STORED  localStorage "sa.paperTrading.v1" → orders[] entry:\n${JSON.stringify(order, null, 2)}`);
