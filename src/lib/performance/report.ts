import { existsSync } from "node:fs";
import { join } from "node:path";
import { hourlyEmailStatus } from "../alerts/hourlyEmail";
import { preOpenEmailStatus } from "../alerts/preOpenEmail";
import { historyLastDay, refreshState } from "../backtest/historyRefresh";
import { trackerState } from "../backtest/tracker";
import { fyersConnected, fyersDataUsage } from "../fyers/fyersClient";
import { FYERS_LOCAL_DAILY_BUDGET } from "../fyers/dataPolicy";
import { getDataSource, getStatus } from "../market/engine";
import { dataFreshness } from "../market/freshness";
import { fyersFeedStats } from "../market/providers/fyers";
import { getUniverseSnapshot } from "../market/universeSnapshot";
import { ordersMode } from "../orders/orderServer";
import { indexSnapshot } from "../paper/indexPaperServer";
import { paperSnapshot } from "../paper/paperServer";
import { positionsView } from "../positions/positionsServer";
import { paperStraddleReport } from "../scalp/paperStraddleRun";
import {
  emailCheck, engineCheck, indexPaperCard, positionsCard, stockPaperCard, straddleCards, trackerCard,
  indexAutomation, stockAutomation, straddleAutomation, trackerAutomation,
  type AutomationStatus, type PerformanceCard, type ReliabilityCheck,
} from "./summary";

export interface PerformanceReport {
  generatedAt: number;
  market: string;
  cards: PerformanceCard[];
  checks: ReliabilityCheck[];
  automation: AutomationStatus[];
  errors: Array<{ source: string; message: string }>;
}

/** Uses existing snapshot readers: no email sending, order actions or option-history backfill. */
export function performanceReport(now = Date.now(), includeRecordedPositions = true): PerformanceReport {
  const cards: PerformanceCard[] = [];
  const checks: ReliabilityCheck[] = [];
  const automation: AutomationStatus[] = [];
  const errors: PerformanceReport["errors"] = [];
  const market = getStatus();
  const fyers = fyersConnected();
  function read<T>(source: string, fn: () => T): T | null {
    try { return fn(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[performance] ${source}:`, message);
      errors.push({ source, message });
      return null;
    }
  }

  const tracker = read("Live strategy check", trackerState);
  if (tracker) {
    cards.push(trackerCard(tracker));
    automation.push(trackerAutomation(tracker));
    if (tracker.job.status === "failed") errors.push({ source: "Live strategy check", message: tracker.job.error });
  }
  const paper = read("Stock paper portfolio", () => paperSnapshot(now));
  if (paper) {
    cards.push(stockPaperCard(paper));
    automation.push(stockAutomation(paper, market.isLive, now));
    checks.push(engineCheck("stock-engine", "Stock paper engine", paper.engine, market.isLive, now));
  }
  const index = read("Index futures paper", () => indexSnapshot(now));
  if (index) {
    cards.push(indexPaperCard(index));
    automation.push(...indexAutomation(index, market.isLive, now, fyers.connected));
    checks.push(engineCheck("index-engine", "Index paper engine", index.engine, market.isLive, now));
  }
  const straddle = read("Paper straddle", paperStraddleReport);
  if (straddle) {
    const today = new Date(now + 19_800_000).toISOString().slice(0, 10);
    cards.push(...straddleCards(straddle, today));
    automation.push(straddleAutomation(straddle, market.isLive, now, fyers.connected));
    const unresolved = straddle.days.some((d) => d.status === "open" && d.day < today);
    const openMissing = market.isLive && new Date(now + 19_800_000).getUTCHours() >= 10 &&
      (!straddle.lastRunAt || now - straddle.lastRunAt > 15 * 60_000 ||
        !["NIFTY", "BANKNIFTY"].every((index) => straddle.days.some((d) => d.day === today && d.index === index)));
    checks.push({
      id: "straddle", title: "Straddle recorder", lastAt: straddle.lastRunAt,
      state: straddle.lastError ? "error" : openMissing || unresolved ? "watch" : market.isLive ? "ok" : "idle",
      detail: straddle.lastError ?? (unresolved ? "Older days remain open; recorded results are incomplete. Inspect the paper desk."
        : openMissing ? "No recent recording run. Connect Fyers and check the paper desk."
        : "Five-minute market-hours recorder. Expiry-day history must be captured before contracts disappear."),
    });
  }
  const positions = includeRecordedPositions ? read("Recorded positions", () => positionsView(now)) : null;
  if (positions) cards.push(positionsCard(positions));

  const history = read("Daily history", () => ({ ...refreshState(), lastCandleDay: historyLastDay() }));
  if (history) {
    const fresh = dataFreshness({ lastCandleDay: history.lastCandleDay, refreshedDay: history.lastDay, now });
    checks.push({
      id: "history", title: "Saved daily history", lastAt: history.lastRunAt,
      state: history.status === "failed" ? "error" : history.status === "running" || fresh.state === "stale" ? "watch" : "ok",
      detail: history.message || `${fresh.message} Latest candle: ${history.lastCandleDay ?? "missing"}.`,
    });
  }
  const scan = read("Universe scan", getUniverseSnapshot);
  if (scan) {
    if (scan.status === "ready") {
      const snapshot = scan.snapshot;
      const maxAge = market.isLive ? 5 * 60_000 : 30 * 60_000;
      checks.push({
        id: "scan", title: "Universe scan", lastAt: snapshot.completedAt,
        state: scan.refreshFailure ? "error" : now - snapshot.completedAt > maxAge ? "watch" : "ok",
        detail: scan.refreshFailure?.message ??
          `${snapshot.histories.size}/${snapshot.total} histories available; ${snapshot.dataQuality.excluded.length} excluded, ${snapshot.dataQuality.truncated.length} shortened. ${scan.refreshing ? "Refresh in progress." : ""}`,
      });
    } else {
      checks.push({
        id: "scan", title: "Universe scan", lastAt: null, state: scan.status === "failed" ? "error" : "watch",
        detail: scan.status === "failed" ? String(scan.error) : `Loading ${scan.progress.done}/${scan.progress.total} (${scan.progress.phase}).`,
      });
    }
  }
  const feed = fyersFeedStats();
  const usage = read("Fyers data usage", () => fyersDataUsage(now));
  const quota = usage && (usage.blockedUntil > now || usage.requests >= FYERS_LOCAL_DAILY_BUDGET);
  const usageDetail = usage ? ` Local data requests today: ${usage.requests}/${FYERS_LOCAL_DAILY_BUDGET} (${Object.entries(usage.endpoints).map(([key, value]) => `${key}: ${value}`).join(", ") || "none"}). Counts exclude other applications and earlier untracked requests.` : "";
  checks.push({
    id: "feed", title: "Market data / Fyers", lastAt: feed.lastFyersAt,
    state: quota || feed.lastError ? "error" : !fyers.connected ? market.isLive ? "watch" : "idle" : "ok",
    detail: (quota ? `${usage.reason ?? "Local data budget reached."} Data requests paused.` : feed.lastError ??
      `${getDataSource().label}. ${fyers.connected ? "Daily Fyers token present" : "No daily Fyers login"}; ${feed.fyersQuotes} Fyers / ${feed.yahooFallbackQuotes} fallback quotes since startup. Fetch time is not proof of a fresh exchange tick.`) + usageDetail +
      " Broad universe Fyers quotes reuse up to 15 minutes; watched quotes poll/reuse 15 seconds. Date-only quotes cannot trigger new paper entries.",
  });
  const hourly = read("Hourly email", hourlyEmailStatus);
  if (hourly) checks.push(emailCheck("hourly", "Hourly email", hourly, hourly.nextEligibleSlot));
  const preopen = read("Pre-open email", preOpenEmailStatus);
  if (preopen) checks.push(emailCheck("preopen", "Pre-open email", preopen, preopen.currentSlot));
  const killed = existsSync(join(process.cwd(), ".cache", "orders-off"));
  const mode = ordersMode();
  checks.push({
    id: "orders", title: "Broker order mode", lastAt: null, state: mode === "live" && !killed ? "watch" : "ok",
    detail: killed ? "Kill switch present: broker sends blocked." : mode === "dry-run"
      ? "Dry-run: manual approvals do not send real orders."
      : "LIVE sending enabled: manually approved orders may reach Fyers. No automatic sending.",
  });
  return { generatedAt: now, market: market.label, cards, checks, automation, errors };
}
