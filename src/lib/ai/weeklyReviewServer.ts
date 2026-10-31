import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { readTracker, trackerState } from "../backtest/tracker.ts";
import { fetchAnnouncements, type Announcement } from "../market/announcements.ts";
import { isTradingDay } from "../market/marketHours.ts";
import { askModel } from "./claude.ts";
import { recordAiUsage } from "./briefingServer.ts";
import { buildReviewFacts, getAnalystRead, isLastSessionOfWeek, reviewLines, reviewSubject } from "./weeklyReview.ts";

const FILE = join(process.cwd(), ".cache", "weekly-review.json");

function lastWeek(): string | null {
  try { return JSON.parse(readFileSync(FILE, "utf8")).lastWeek ?? null; } catch { return null; }
}

/**
 * On the last session of each week, once the live strategy check has recomputed, emails the owner (PERSONAL_ALERT_EMAIL only) a review of the
 * week: the facts and rule checks always, plus Claude's "analyst read" when ANTHROPIC_API_KEY is set. Sent once per week.
 */
export async function sendWeeklyReviewIfDue(): Promise<void> {
  const config = readTracker();
  if (!config || !ownerAlertAddress()) return;
  const state = trackerState();
  if (state.job.status !== "done") return;
  const result = state.job.result;
  const lastDay = result.data.lastDay;
  if (!isLastSessionOfWeek(lastDay, (day) => isTradingDay(Date.parse(`${day}T12:00:00+05:30`)))) return;
  const facts0 = buildReviewFacts(result, { capital: config.capital, stopPercent: config.stopPercent });
  if (lastWeek() === facts0.weekStart) return;
  const symbols = [...new Set(facts0.closed.map((t) => t.symbol))].slice(0, 6);
  const found: Record<string, Announcement[]> = {};
  for (const symbol of symbols) found[symbol] = await fetchAnnouncements(symbol, 14);
  const facts = buildReviewFacts(result, { capital: config.capital, stopPercent: config.stopPercent }, found);
  const read = await getAnalystRead(facts, {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    ask: (system, user, key) => askModel({ model: "sonnet", system, user, maxTokens: 900 }, key),
    recordUsage: (usage) => recordAiUsage("review", "sonnet", usage),
  });
  const lines = [...reviewLines(facts), ...(read ? ["", "Analyst read (written by AI from the facts above; it can be wrong, so check the filings before you act):", ...read] : []), "", "Paper money only. This review never changes the rules."];
  await notifyOwner(reviewSubject(facts), lines);
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ lastWeek: facts.weekStart }));
}

