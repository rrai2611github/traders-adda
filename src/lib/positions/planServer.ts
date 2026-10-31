import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner } from "@/lib/alerts/personal";
import { getBacktest, startBacktest } from "../backtest/jobs.ts";
import { historyLastDay, refreshState } from "../backtest/historyRefresh.ts";
import { trackerSettings } from "../backtest/tracker.ts";
import { daysUntil, getResultsDates } from "../market/boardMeetings.ts";
import { dataFreshness } from "../market/freshness.ts";
import { istDateKey } from "../market/marketHours.ts";
import { SETUP_BREADTH_MIN } from "../screen/setupGate.ts";
import { readAccount } from "./account.ts";
import { positionsView, sectorOf } from "./positionsServer.ts";
import { buildTomorrowPlan, planEmail } from "./tomorrowPlan.ts";

const FILE = join(process.cwd(), ".cache", "tomorrow-plan.json");

function lastKey(): string | null {
  try { return JSON.parse(readFileSync(FILE, "utf8")).key ?? null; } catch { return null; }
}

/**
 * After the evening price refresh: if the user has saved an account size (the opt-in), the market check passed and some breakout fits the
 * real account, emails the owner only (PERSONAL_ALERT_EMAIL, never the group list) a short list of exact orders for the next open.
 * Silent on every other day. Once per set of orders.
 */
export async function sendTomorrowPlanIfDue(now = Date.now()): Promise<void> {
  const saved = readAccount();
  if (saved == null) return;

  // The same rules as the live strategy check, run for the last day only (the window just has to be long enough to warm up).
  const last = historyLastDay();
  if (!last) return;
  const startDate = new Date(Date.parse(`${last}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  let job = startBacktest(trackerSettings({ startDate, startedAt: 0, capital: 1_000_000, niftyGate: false, stopPercent: 12 }));
  for (let i = 0; i < 90 && job.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    job = getBacktest(job.id) ?? job;
  }
  if (job.status !== "done") return;
  const { result } = job;
  if (dataFreshness({ lastCandleDay: result.data.lastDay, refreshedDay: refreshState().lastDay, now }).state !== "ok") return;
  const pending = result.pending;
  if (!pending.breadthOk || !pending.candidates?.length) return;

  const today = istDateKey(now);
  const results = await getResultsDates(today).catch(() => null);
  const view = positionsView(now);
  const plan = buildTomorrowPlan({
    candidates: pending.candidates,
    held: view.open.map((o) => ({ symbol: o.holding.symbol, qty: o.holding.qty, last: o.assessment.last ?? o.holding.buyPrice, stop: o.holding.stop, sector: o.sector })),
    accountSize: saved,
    sectorOf,
    resultsInDays: (symbol) => (results ? (results.dates[symbol] ? daysUntil(results.dates[symbol], today) : null) : undefined),
    marketOk: true,
  });
  const mail = planEmail({
    plan, accountSize: saved, accountSaved: true, breadth50: pending.breadth50, breadthMin: SETUP_BREADTH_MIN,
    lastDay: result.data.lastDay, heldCount: view.open.length, candidateCount: pending.candidates.length, resultsKnown: results != null,
  });
  if (!mail) return;

  const key = `${result.data.lastDay}|${plan.orders.map((o) => `${o.symbol}:${o.shares}`).join(",")}`;
  if (lastKey() === key) return;
  if (!(await notifyOwner(mail.subject, mail.lines))) return;
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ key }));
}
