import { ensureDerived } from "./derive.ts";
import { dayToIso, isoToDay, loadHistory, type History } from "./history.ts";
import { confirmCandidates, leaderCandidates, screenCandidates } from "./signals.ts";
import { niftyFilter, simulate } from "./simulate.ts";
import { atrAt } from "./signals.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BacktestResult, BacktestSettings, BacktestStats, PendingSignal, Trade, TradeStats } from "./types.ts";

const MAX_TRADES_RETURNED = 2000;

export function tradeStats(trades: ReadonlyArray<Trade>): TradeStats {
  const n = trades.length;
  if (!n) return { trades: 0, winRate: null, avgR: null, payoff: null, profitFactor: null, avgHoldDays: null, worstLosingStreak: 0 };
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  let streak = 0;
  let worst = 0;
  for (const t of [...trades].sort((a, b) => a.exitDay.localeCompare(b.exitDay))) {
    streak = t.pnl > 0 ? 0 : streak + 1;
    worst = Math.max(worst, streak);
  }
  return {
    trades: n,
    winRate: (wins.length / n) * 100,
    avgR: trades.reduce((a, t) => a + t.r, 0) / n,
    payoff: wins.length && losses.length ? grossWin / wins.length / (grossLoss / losses.length) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgHoldDays: trades.reduce((a, t) => a + t.holdDays, 0) / n,
    worstLosingStreak: worst,
  };
}

function benchmark(history: History, fromPos: number, toPos: number, capital: number): number[] {
  const nifty = history.series.get("NIFTY50");
  const out: number[] = [];
  if (!nifty) return out;
  let j = 0;
  let base = 0;
  let last = 0;
  for (let pos = fromPos; pos <= toPos; pos += 1) {
    const day = history.calendar[pos];
    while (j < nifty.n - 1 && nifty.day[j + 1] <= day) j += 1;
    if (nifty.day[j] <= day) last = nifty.close[j];
    if (!base && last) base = last;
    out.push(base && last ? (capital * last) / base : capital);
  }
  return out;
}

function positionOf(history: History, iso: string, side: "from" | "to"): number {
  const day = isoToDay(iso);
  const cal = history.calendar;
  if (side === "from") {
    for (let i = 0; i < cal.length; i += 1) if (cal[i] >= day) return i;
    return cal.length - 1;
  }
  for (let i = cal.length - 1; i >= 0; i -= 1) if (cal[i] <= day) return i;
  return 0;
}

/**
 * One backtest over the whole market: candidates each day (strong stocks, or screen breakouts), then a single account trades
 * them under the position cap, risk size and exit rules chosen.
 */
/** The saved sector of each stock (`src/lib/market/data/sectors.json`), for the per-sector limit. */
function sectorLookup(): (symbol: string) => string | null {
  let sectors: Record<string, string> = {};
  try {
    sectors = (JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "market", "data", "sectors.json"), "utf8")) as { sectors: Record<string, string> }).sectors;
  } catch { /* no labels: nothing is limited */ }
  return (symbol) => sectors[symbol] ?? null;
}

export function runBacktest(settings: BacktestSettings, dir: string, log: (message: string) => void = () => {}): BacktestResult {
  const started = Date.now();
  log("loading ten years of prices");
  const history = loadHistory(dir);
  const derived = ensureDerived(dir, history, log);
  const fromPos = positionOf(history, settings.from, "from");
  const toPos = positionOf(history, settings.to, "to");
  if (toPos < fromPos) throw new Error("The period is empty: pick a start date before the end date, inside the downloaded history.");

  log("finding candidates");
  const all = settings.strategy.kind === "leaders"
    ? leaderCandidates(history, derived, settings, fromPos, toPos)
    : screenCandidates(history, derived, settings, fromPos, toPos);
  if (settings.strategy.kind === "screen" && settings.alsoScreens?.length) {
    const seen = new Set(all.map((c) => `${c.symbol}:${c.i}`));
    for (const name of settings.alsoScreens) {
      for (const c of screenCandidates(history, derived, { ...settings, strategy: { kind: "screen", screen: name } }, fromPos, toPos)) {
        const key = `${c.symbol}:${c.i}`;
        if (!seen.has(key)) { seen.add(key); all.push(c); }
      }
    }
  }
  if (settings.symbol && !history.series.has(settings.symbol)) throw new Error(`No downloaded history for ${settings.symbol}.`);
  const picked = settings.symbol ? all.filter((c) => c.symbol === settings.symbol) : all;
  const candidates = settings.confirm ? confirmCandidates(history, picked) : picked;
  log(`${candidates.length} candidates; running the account`);
  const sim = simulate(history, derived, settings, candidates, fromPos, toPos, settings.maxPerSector ? sectorLookup() : undefined);

  const sessions = toPos - fromPos + 1;
  const days: string[] = [];
  for (let pos = fromPos; pos <= toPos; pos += 1) days.push(dayToIso(history.calendar[pos]));
  const account = Array.from(sim.account, (v) => Math.round(v * 100) / 100);
  let peak = 0;
  let maxDrawdown = 0;
  const drawdown = account.map((v) => {
    peak = Math.max(peak, v);
    const dd = peak > 0 ? (v / peak - 1) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, dd);
    return Math.round(dd * 100) / 100;
  });
  const years = (history.calendar[toPos] - history.calendar[fromPos]) / 365.25;
  const finalValue = account[account.length - 1];
  const base = tradeStats(sim.trades);
  const stats: BacktestStats = {
    ...base,
    totalReturnPercent: (finalValue / settings.capital - 1) * 100,
    cagrPercent: years >= 1 && finalValue > 0 ? (Math.pow(finalValue / settings.capital, 1 / years) - 1) * 100 : null,
    maxDrawdownPercent: maxDrawdown,
    exposurePercent: (sim.investedSessions / sessions) * 100,
    tradesPerYear: years > 0 ? sim.trades.length / years : null,
    totalProfit: Math.round(finalValue - settings.capital),
    avgDeployed: Math.round(sim.deployed.reduce((a, v) => a + v, 0) / Math.max(1, sim.deployed.length)),
    peakDeployed: Math.round(sim.deployed.reduce((a, v) => Math.max(a, v), 0)),
    totalBought: Math.round(sim.trades.reduce((a, t) => a + t.quantity * t.entryPrice, 0)),
  };

  const byEntry = [...sim.trades].sort((a, b) => a.entryDay.localeCompare(b.entryDay));
  const half = byEntry.length >= 20 ? byEntry.length >> 1 : 0;
  const halves = half ? { split: byEntry[half].entryDay, first: tradeStats(byEntry.slice(0, half)), second: tradeStats(byEntry.slice(half)) } : null;

  const yearRows = new Map<number, { trades: Trade[]; first: number; last: number; deployedSum: number; sessions: number; peak: number }>();
  days.forEach((iso, k) => {
    const y = Number(iso.slice(0, 4));
    const row = yearRows.get(y) ?? { trades: [], first: account[k], last: account[k], deployedSum: 0, sessions: 0, peak: 0 };
    row.last = account[k];
    row.deployedSum += sim.deployed[k];
    row.sessions += 1;
    row.peak = Math.max(row.peak, sim.deployed[k]);
    yearRows.set(y, row);
  });
  for (const t of byEntry) yearRows.get(Number(t.entryDay.slice(0, 4)))?.trades.push(t);
  let carry = settings.capital;
  const yearsTable = [...yearRows.entries()].sort((a, b) => a[0] - b[0]).map(([year, row]) => {
    const s = tradeStats(row.trades);
    const out = {
      year, trades: s.trades, winRate: s.winRate, avgR: s.avgR,
      startValue: Math.round(carry), endValue: Math.round(row.last), pnl: Math.round(row.last - carry), returnPercent: (row.last / carry - 1) * 100,
      avgDeployed: Math.round(row.deployedSum / Math.max(1, row.sessions)), peakDeployed: Math.round(row.peak),
      bought: Math.round(row.trades.reduce((a, t) => a + t.quantity * t.entryPrice, 0)),
    };
    carry = row.last;
    return out;
  });

  // What the rules would buy at the next open, from the last day's signals and the market gates.
  const nifty = niftyFilter(history, settings.niftyAbove ?? 0);
  const breadth50 = derived.breadth50[toPos];
  const breadthOk = settings.breadthMin <= 0 || breadth50 >= settings.breadthMin;
  const niftyOk = nifty ? nifty[toPos] === 1 : null;
  const slotsFree = Math.max(0, settings.maxPositions - sim.openAtEnd.length);
  const held = new Set(sim.openAtEnd.map((p) => p.symbol));
  const signals: PendingSignal[] = [];
  if (breadthOk && niftyOk !== false && slotsFree > 0) {
    const rankedToday = candidates.filter((c) => c.pos === toPos && !held.has(c.symbol)).sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol));
    for (const c of rankedToday) {
      if (signals.length >= Math.min(settings.maxNewPerDay, slotsFree)) break;
      const s = history.series.get(c.symbol)!;
      const fill = s.close[c.i];
      const stop = settings.stop.kind === "atr" ? fill - settings.stop.multiple * atrAt(s, c.i) : fill * (1 - settings.stop.percent / 100);
      const risk = fill - stop;
      if (!(risk > 0) || risk / fill > 0.25) continue;
      let qty = settings.sizing.kind === "risk" ? Math.floor((sim.markedValue * settings.sizing.riskPercent) / 100 / risk) : Math.floor(sim.markedValue / settings.maxPositions / fill);
      qty = Math.min(qty, Math.floor((sim.markedValue * settings.positionCapPercent) / 100 / fill));
      if (qty < 1) continue;
      signals.push({ symbol: c.symbol, rs: c.rs, close: Math.round(fill * 100) / 100, stop: Math.round(stop * 100) / 100, quantity: qty, amount: Math.round(qty * fill) });
    }
  }

  // The same signals without the paper account's limits (free slots, what it holds), so a real account can apply its own.
  const candidatesToday: PendingSignal[] = [];
  if (breadthOk && niftyOk !== false) {
    const everyone = candidates.filter((c) => c.pos === toPos).sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol));
    for (const c of everyone) {
      if (candidatesToday.length >= 20) break;
      const s = history.series.get(c.symbol)!;
      const fill = s.close[c.i];
      const stop = settings.stop.kind === "atr" ? fill - settings.stop.multiple * atrAt(s, c.i) : fill * (1 - settings.stop.percent / 100);
      const risk = fill - stop;
      if (!(risk > 0) || risk / fill > 0.25) continue;
      candidatesToday.push({ symbol: c.symbol, rs: c.rs, close: Math.round(fill * 100) / 100, stop: Math.round(stop * 100) / 100, quantity: 0, amount: 0 });
    }
  }

  const warnings = [...sim.warnings];
  if (settings.symbol) warnings.push(`Only ${settings.symbol} was traded, so the trade count is small and the result says little about the rule by itself.`);
  if (settings.strategy.kind === "screen" && settings.entry === "at-pivot") warnings.push("Entering at the pivot assumes a stop-buy order fills the moment price crosses the lid; the day's close is only known afterwards, so this is slightly generous.");
  warnings.push("Market cap is not available historically, so the market-cap floor is not applied; the daily-turnover floor is.", "The stock list is today's, so stocks that were delisted since are missing (survivorship bias).");

  return {
    settings,
    data: { symbols: history.series.size - (history.series.has("NIFTY50") ? 1 : 0), firstDay: dayToIso(history.calendar[0]), lastDay: dayToIso(history.calendar[history.calendar.length - 1]), sessions },
    stats,
    halves,
    years: yearsTable,
    equity: { days, account, benchmark: benchmark(history, fromPos, toPos, settings.capital).map((v) => Math.round(v * 100) / 100), drawdown },
    trades: byEntry.slice(-MAX_TRADES_RETURNED),
    openPositions: sim.openAtEnd,
    markedValue: Math.round(sim.markedValue),
    pending: { signals, breadth50: Number.isFinite(breadth50) ? Math.round(breadth50 * 10) / 10 : null, breadthOk, niftyOk, slotsFree, candidates: candidatesToday },
    tradeCount: byEntry.length,
    warnings,
    elapsedMs: Date.now() - started,
  };
}
