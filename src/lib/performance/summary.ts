import type { TrackerState } from "../backtest/tracker.ts";
import type { PaperSnapshot } from "../paper/paperServer.ts";
import type { IndexPaperSnapshot } from "../paper/indexPaperServer.ts";
import type { PositionsView } from "../positions/positionsServer.ts";
import type { PaperStraddleReport } from "../scalp/paperStraddleRun.ts";
import { isDemoPaperOrder } from "../screen/paperTrading.ts";
import { autoEvaluationFailed } from "../paper/indexFramework.ts";
import type { Quote } from "../market/types.ts";
import { quoteEntryIssue, quoteSourceLabel } from "../market/quoteQuality.ts";

export interface PerformanceCard {
  id: string;
  title: string;
  href: string;
  evidence: "Daily-price replay" | "Quote simulation" | "Option-candle replay" | "Manually recorded";
  capital: number | null;
  deployed: number | null;
  closedPnl: number | null;
  openPnl: number | null;
  totalPnl: number | null;
  closed: number;
  open: number;
  unit: "trades" | "days";
  winRate: number | null;
  expectancyR: number | null;
  drawdownRs: number | null;
  drawdownPct: number | null;
  returnPct: number | null;
  benchmarkPct: number | null;
  asOf: string | number | null;
  note: string;
}

export function trackerCard(state: TrackerState): PerformanceCard {
  const base: PerformanceCard = {
    id: "strategy", title: "Blue Sky + Multi-year Breakouts", href: "/positions#strategy-check", evidence: "Daily-price replay",
    capital: state.config?.capital ?? null, deployed: null, closedPnl: null, openPnl: null, totalPnl: null,
    closed: 0, open: 0, unit: "trades", winRate: null, expectancyR: null, drawdownRs: null,
    drawdownPct: null, returnPct: null, benchmarkPct: null, asOf: state.history.lastCandleDay,
    note: "Not started. Start the live strategy check to collect forward results.",
  };
  const job = state.job;
  if (job.status !== "done") {
    base.note = job.status === "failed" ? `Computation failed: ${job.error}`
      : job.status === "waiting" || job.status === "running" ? job.message : base.note;
    return base;
  }
  const result = job.result;
  // "end" trades are marks of still-held positions, not completed trades.
  const closed = result.trades.filter((t) => t.exitReason !== "end");
  const completeLedger = result.tradeCount <= result.trades.length;
  const closedPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnl = result.markedValue - result.settings.capital;
  const first = result.equity.benchmark[0];
  const last = result.equity.benchmark.at(-1);
  return {
    ...base, deployed: result.openPositions.reduce((sum, p) => sum + p.quantity * p.last, 0),
    closedPnl: completeLedger ? closedPnl : null,
    openPnl: completeLedger ? totalPnl - closedPnl : null, totalPnl,
    closed: result.tradeCount - result.openPositions.length, open: result.openPositions.length,
    winRate: completeLedger && closed.length ? closed.filter((t) => t.pnl > 0).length / closed.length * 100 : null,
    expectancyR: completeLedger && closed.length ? closed.reduce((sum, t) => sum + t.r, 0) / closed.length : null,
    drawdownPct: result.stats.maxDrawdownPercent, returnPct: totalPnl / result.settings.capital * 100,
    benchmarkPct: first > 0 && last != null ? (last / first - 1) * 100 : null,
    asOf: result.data.lastDay,
    note: "Forward daily-price replay, not broker fills. Open positions use marked account value, before hypothetical closing fees. Judge after 30 closed trades; open marks are excluded from win rate." +
      (completeLedger ? "" : " Returned trade ledger is capped; closed P&L, win rate and expectancy are withheld."),
  };
}

export function stockPaperCard(s: PaperSnapshot): PerformanceCard {
  const orders = s.orders.filter((o) => !isDemoPaperOrder(o));
  return {
    id: "stock-paper", title: "Stock paper portfolio", href: "/#journal", evidence: "Quote simulation",
    capital: s.initialCapital, deployed: orders.filter((o) => o.status === "open")
      .reduce((sum, o) => sum + o.remainingQuantity * (o.entryPrice ?? 0), 0),
    closedPnl: s.stats.net, openPnl: s.totals.net - s.stats.net, totalPnl: s.totals.net,
    closed: s.stats.closed, open: orders.filter((o) => o.status === "open").length, unit: "trades",
    winRate: s.stats.winRate, expectancyR: s.stats.expectancyR, drawdownRs: s.stats.maxDrawdown,
    drawdownPct: null, returnPct: s.initialCapital > 0 ? s.totals.net / s.initialCapital * 100 : null,
    benchmarkPct: null, asOf: s.engine.lastTickAt,
    note: "Sampled quotes, estimated charges and slippage; demo orders excluded. Open P&L includes partial exits on still-open orders. Drawdown uses completed orders only.",
  };
}

export function indexPaperCard(s: IndexPaperSnapshot): PerformanceCard {
  const open = s.orders.filter((o) => o.status === "open");
  const openPnl = open.reduce((sum, o) => sum + o.netPnl, 0);
  return {
    id: "index-paper", title: "Index futures paper portfolio", href: "/scalp/index-paper", evidence: "Quote simulation",
    capital: s.capital, deployed: s.risk.marginUsed, closedPnl: s.stats.net, openPnl, totalPnl: s.stats.net + openPnl,
    closed: s.stats.closed, open: open.length, unit: "trades", winRate: s.stats.winRate,
    expectancyR: s.stats.expectancyR, drawdownRs: s.stats.maxDrawdown, drawdownPct: null,
    returnPct: s.capital > 0 ? (s.stats.net + openPnl) / s.capital * 100 : null, benchmarkPct: null,
    asOf: s.engine.lastTickAt,
    note: "Futures quotes with estimated costs, not executed fills. Deployed is estimated margin. Drawdown uses completed trades only; the index framework is unproven.",
  };
}

export function straddleCards(s: PaperStraddleReport, today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)): PerformanceCard[] {
  return (["NIFTY", "BANKNIFTY"] as const).map((index) => {
    const summary = s.summary[index];
    const days = s.days.filter((d) => d.index === index);
    const open = days.filter((d) => d.status === "open");
    const unresolved = open.some((d) => d.day < today);
    const openPnl = open.reduce((sum, d) => sum + d.netRs, 0);
    return {
      id: `straddle-${index}`, title: `${index === "NIFTY" ? "Nifty" : "Bank Nifty"} short straddle`,
      href: "/scalp/paper", evidence: "Option-candle replay",
      capital: null, deployed: null, closedPnl: summary.netRs, openPnl: unresolved ? null : openPnl,
      totalPnl: unresolved ? null : summary.netRs + openPnl,
      closed: summary.closedDays, open: open.length, unit: "days",
      winRate: summary.closedDays ? summary.winDays / summary.closedDays * 100 : null,
      expectancyR: null, drawdownRs: summary.maxDrawdown, drawdownPct: null,
      returnPct: null, benchmarkPct: null, asOf: days.map((d) => d.day).sort().at(-1) ?? null,
      note: `One-minute option candles, estimated fills/costs, not bid/ask execution. ${summary.closedDays}/${summary.needed} closed days. Real/model premium: ${summary.realToModel == null ? "unavailable" : summary.realToModel.toFixed(2) + "x"}. No funded capital recorded, so no return percentage is invented.` +
        (unresolved ? " Older days remain open: current total/open P&L withheld. Check the recorder; expired contracts may no longer be recoverable." : ""),
    };
  });
}

export function positionsCard(s: PositionsView): PerformanceCard {
  return {
    id: "positions", title: "Recorded real positions", href: "/positions", evidence: "Manually recorded",
    capital: null, deployed: s.exposure.invested, closedPnl: s.journal.totalPnl,
    openPnl: s.exposure.openPnl, totalPnl: s.journal.totalPnl + s.exposure.openPnl,
    closed: s.journal.count, open: s.open.length, unit: "trades", winRate: s.journal.winRate,
    expectancyR: s.journal.avgR, drawdownRs: null, drawdownPct: null,
    returnPct: null, benchmarkPct: null, asOf: s.lastDay,
    note: "Owner-entered buys/sales, not broker-reconciled. Gross P&L before fees; open positions use daily prices. Deployed is current position value. No account return or drawdown is inferred.",
  };
}

export type CheckState = "ok" | "watch" | "error" | "idle";
export interface ReliabilityCheck {
  id: string;
  title: string;
  state: CheckState;
  detail: string;
  lastAt: number | null;
}

export interface AutomationStatus {
  id: string;
  title: string;
  href: string;
  mode: string;
  state: CheckState;
  status: string;
  cadence: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | string | null;
  detail: string;
}

export function trackerAutomation(s: TrackerState): AutomationStatus {
  const done = s.job.status === "done";
  return {
    id: "strategy", title: "Blue Sky + Multi-year Breakouts", href: "/positions#strategy-check",
    mode: "Daily paper replay", state: s.job.status === "failed" ? "error" : done ? "ok" : "watch",
    status: !s.config ? "Not started" : done ? "Waiting for completed daily prices" : s.job.status === "failed" ? "Replay failed" : "Preparing replay",
    cadence: "After completed daily history refresh; not intraday",
    lastAttemptAt: null, lastSuccessAt: s.job.status === "done" ? s.job.result.data.lastDay : null,
    detail: s.job.status === "failed" ? s.job.error : "Daily entries and exits use the original tested rules. Live quotes do not change these results.",
  };
}

export function stockAutomation(s: PaperSnapshot, live: boolean, now: number): AutomationStatus {
  const active = s.orders.filter((o) => !isDemoPaperOrder(o) && ["open", "pending"].includes(o.status));
  const health = engineCheck("stock", "Stock", s.engine, live, now);
  return {
    id: "stock-paper", title: "Stock paper portfolio", href: "/#journal", mode: "User-approved paper orders",
    state: health.state, status: health.state === "error" ? "Engine error" : !live ? "Market closed"
      : health.state === "watch" ? "Monitoring blocked" : !active.length ? "No active paper orders" : "Monitoring paper orders",
    cadence: "Sampled quotes; orders require approval", lastAttemptAt: s.engine.lastTickAt,
    lastSuccessAt: null,
    detail: active.length || health.state === "error" || health.state === "watch" ? health.detail
      : "The engine is available, but has no non-demo pending or open orders. A heartbeat is not a trade evaluation.",
  };
}

export function indexAutomation(s: IndexPaperSnapshot, live: boolean, now: number, connected: boolean): AutomationStatus[] {
  return (["NIFTY", "BANKNIFTY"] as const).map((index) => {
    const enabled = s.auto.enabled && s.auto.indexes.includes(index);
    const last = s.auto.log.find((e) => e.index === index);
    const success = s.auto.log.find((e) => e.index === index && !autoEvaluationFailed(e));
    const failed = last && autoEvaluationFailed(last);
    const blocked = last?.result === "blocked" || (last?.result === "skipped" && /new paper entries blocked|Entries blocked/.test(last.message));
    const health = engineCheck("index", "Index", s.engine, live, now);
    return {
      id: `index-${index}`, title: `${index === "NIFTY" ? "Nifty" : "Bank Nifty"} futures`,
      href: "/scalp/index-paper", mode: enabled ? "Automatic paper entries enabled" : "Automatic paper entries off",
      state: !enabled ? "idle" : failed || health.state === "error" ? "error" : !live ? "idle" : blocked || !connected || health.state === "watch" ? "watch" : "ok",
      status: !enabled ? "Automation off" : failed ? "Evaluation failed - retry pending" : !live ? "Market closed"
        : !connected ? "Fyers login required" : blocked ? "Paper entries blocked" : health.state === "error" ? "Engine error" : health.state === "watch" ? "Monitoring blocked"
          : last?.result === "placed" ? "Paper order created" : last ? "Waiting for next setup" : "Waiting for first evaluation",
      cadence: "Completed hourly bars, 10:16-14:30 IST; failed evaluations retry after at least 60 seconds",
      lastAttemptAt: last?.at ?? null, lastSuccessAt: success?.at ?? null,
      detail: last?.message ?? (!connected ? "Connect Fyers for futures data." : "No recorded evaluation. An engine heartbeat alone does not mean this strategy has run."),
    };
  });
}

export function straddleAutomation(s: PaperStraddleReport, live: boolean, now: number, connected: boolean): AutomationStatus {
  const today = new Date(now + 19_800_000).toISOString().slice(0, 10);
  const unresolved = s.days.filter((d) => d.status === "open" && d.day < today).length;
  const current = ["NIFTY", "BANKNIFTY"].every((index) => s.days.some((d) => d.index === index && d.day === today));
  const stale = !s.lastRunAt || now - s.lastRunAt > 15 * 60_000;
  return {
    id: "straddle", title: "Nifty / Bank Nifty short straddles", href: "/scalp/paper", mode: "Option-candle paper recorder",
    state: s.lastError ? "error" : unresolved || (live && (!connected || stale || !current)) ? "watch" : live ? "ok" : "idle",
    status: s.lastError ? "Recording failed" : !connected && live ? "Fyers login required" : unresolved ? "Incomplete older records"
      : !live ? "Market closed" : stale || !current ? "Waiting for current recording" : "Recording paper sessions",
    cadence: "Every 5 minutes during trading; 10-minute recovery after close until 23:00 IST",
    lastAttemptAt: s.lastRunAt, lastSuccessAt: !s.lastError && current ? s.lastRunAt : null,
    detail: [s.lastError, unresolved ? `${unresolved} older days remain incomplete. Expired contracts cannot be recreated with new contracts.` : null,
      "Estimated candle fills, not live option execution."].filter(Boolean).join(" "),
  };
}

export function monitoredQuote(quote: Quote | undefined, live: boolean, now: number): { label: string; detail: string } {
  if (!quote) return { label: "Unavailable", detail: "No quote received." };
  if (quote.source === "mock") return { label: "Simulated", detail: quoteSourceLabel(quote) };
  if (!live) return { label: "Last available price", detail: quoteSourceLabel(quote) };
  const issue = quoteEntryIssue(quote, now, 120_000);
  return { label: issue ? /Stale/.test(issue) ? "Stale price" : "Freshness unverified" : quote.source === "yahoo" ? "Delayed / fallback" : "Recent provider quote",
    detail: quoteSourceLabel(quote) };
}

export function engineCheck(id: string, title: string, engine: {
  running: boolean; lastTickAt: number | null; lastError: string | null; pausedReason: string | null;
}, live: boolean, now: number): ReliabilityCheck {
  const base = { id, title, lastAt: engine.lastTickAt };
  if (engine.lastError) return { ...base, state: "error", detail: engine.lastError };
  if (!live) return { ...base, state: "idle", detail: "Market closed. No live fills expected; last tick shown below." };
  if (!engine.running || !engine.lastTickAt || now - engine.lastTickAt > 120_000) {
    return { ...base, state: "watch", detail: "No recent engine heartbeat. Check the app and source desk before trusting updates." };
  }
  return { ...base, state: engine.pausedReason ? "watch" : "ok", detail: engine.pausedReason ?? "Engine heartbeat is recent. This does not verify quote latency." };
}

export function emailCheck(id: string, title: string, s: {
  configured: boolean; autoSend: boolean; lastSentAt: number | null; lastError: string | null;
  lastSentSlotKey: string | null;
}, slot: string | null): ReliabilityCheck {
  return {
    id, title, lastAt: s.lastSentAt,
    state: s.lastError ? "error" : !s.configured || !s.autoSend ? "watch"
      : slot && slot !== s.lastSentSlotKey ? "watch" : "ok",
    detail: s.lastError ?? (!s.configured ? "SMTP/recipients are not configured."
      : !s.autoSend ? "Automatic sending is disabled."
      : slot && slot !== s.lastSentSlotKey ? "Current eligible slot has not been recorded as sent yet."
      : "Automatic sending enabled. Last SMTP-accepted send shown below; inbox delivery is not verified."),
  };
}
