import type { BacktestResult } from "./types.ts";
import type { Quote } from "../market/types.ts";
import { quoteEntryIssue, quoteSourceLabel } from "../market/quoteQuality.ts";

export interface TrackerAlert {
  key: string;
  subject: string;
  lines: string[];
  stopDay?: string;
}

export interface TrackerAlertState {
  version: 1;
  generation: string;
  observedDay: string;
  sent: string[];
  pending: TrackerAlert[];
}

const money = (n: number) => `INR ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const disclaimer = "Practice account only. No broker order was placed. This is not an instruction to place a real-money trade.";

export function dailyTrackerAlerts(result: BacktestResult): TrackerAlert[] {
  const day = result.data.lastDay;
  const alerts: TrackerAlert[] = [];
  const buys = new Map<string, { symbol: string; entryDay: string; entryPrice: number; quantity: number }>();
  for (const trade of [...result.trades, ...result.openPositions]) {
    if (trade.entryDay === day) buys.set(`${trade.symbol}:${trade.entryDay}`, trade);
  }
  for (const trade of buys.values()) alerts.push({
    key: `buy:${day}:${trade.symbol}`,
    subject: `Practice buy recorded: ${trade.symbol} | ${day}`,
    lines: [`Daily replay recorded ${trade.quantity} ${trade.symbol} shares at ${money(trade.entryPrice)} on ${day}.`,
      "Detected after completed daily candles were processed, not at the moment of execution.", disclaimer],
  });
  for (const trade of result.trades.filter(t => t.exitDay === day && t.exitReason !== "end")) alerts.push({
    key: `exit:${day}:${trade.symbol}:${trade.entryDay}`,
    subject: `Practice exit recorded: ${trade.symbol} | ${day}`,
    lines: [`Daily replay recorded an exit of ${trade.quantity} ${trade.symbol} shares at ${money(trade.exitPrice)} on ${day}.`,
      `Replay exit rule: ${trade.exitReason}. Recorded profit/loss after replay costs: ${money(trade.pnl)}.`,
      "This is an after-processing record, not an instant execution confirmation.", disclaimer],
  });
  if (result.pending.breadthOk && result.pending.niftyOk !== false) {
    for (const signal of result.pending.signals) alerts.push({
      key: `candidate:${day}:${signal.symbol}`,
      subject: `Next-open practice candidate: ${signal.symbol} | ${day}`,
      lines: [`Confirmed from completed ${day} daily data: ${signal.symbol}.`,
        `Indicative quantity ${signal.quantity}; signal close ${money(signal.close)}; indicative stop ${money(signal.stop)}.`,
        "Not bought yet. The strategy considers entry at the next trading open; price, quantity and availability can change.",
        "No fixed profit target: follow the existing stop and daily 50-day-average exit rules.", disclaimer],
    });
  }
  return alerts;
}

export function observeTrackerDay(
  previous: TrackerAlertState | null, generation: string, result: BacktestResult,
): TrackerAlertState {
  const day = result.data.lastDay;
  if (!previous || previous.generation !== generation) {
    return { version: 1, generation, observedDay: day, sent: [], pending: [] };
  }
  if (day <= previous.observedDay) return previous;
  const keys = new Set([...previous.sent, ...previous.pending.map(a => a.key)]);
  return { ...previous, observedDay: day,
    pending: [...previous.pending, ...dailyTrackerAlerts(result).filter(a => !keys.has(a.key))] };
}

export function trackerStopAlerts(
  result: BacktestResult, quotes: Quote[], now: number, today: string,
): { alerts: TrackerAlert[]; blocked: string[] } {
  const bySymbol = new Map(quotes.map(q => [q.symbol, q]));
  const alerts: TrackerAlert[] = [];
  const blocked: string[] = [];
  for (const position of result.openPositions) {
    const q = bySymbol.get(position.symbol);
    const issue = !q ? "quote unavailable" : !Number.isFinite(q.ltp) || q.ltp <= 0
      ? "invalid price" : quoteEntryIssue(q, now, 120_000);
    if (issue) { blocked.push(`${position.symbol}: ${issue}`); continue; }
    if (!q || q.ltp > position.stop) continue;
    alerts.push({
      key: `stop:${today}:${position.symbol}:${position.entryDay}`,
      stopDay: today,
      subject: `Practice stop reached - review only: ${position.symbol}`,
      lines: [`${position.symbol}: observed ${money(q.ltp)}, at or below practice stop ${money(position.stop)}.`,
        `${quoteSourceLabel(q)}. Provider trade time: ${new Date(q.tradeTimestamp ?? q.timestamp).toISOString()}.`,
        "Sampled price warning only, NOT an executed exit. Quotes can be delayed; polling can miss brief crossings.",
        "Daily replay remains authoritative. No intraday trading rule or holding has been changed.", disclaimer],
    });
  }
  return { alerts, blocked };
}

export async function deliverTrackerAlerts(
  state: TrackerAlertState,
  send: (subject: string, lines: string[]) => Promise<boolean>,
  save: (state: TrackerAlertState) => void,
): Promise<boolean> {
  while (state.pending.length) {
    const alert = state.pending[0];
    if (!(await send(alert.subject, alert.lines))) return false;
    state.sent.push(alert.key);
    state.pending.shift();
    save(state);
  }
  return true;
}
