import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner } from "@/lib/alerts/personal";
import { historyLastDay, refreshState } from "@/lib/backtest/historyRefresh";
import { readTracker } from "@/lib/backtest/tracker";
import { getDataSource, getQuotes } from "@/lib/market/engine";
import { dataFreshness } from "@/lib/market/freshness";
import { getMarketStatus, isTradingDay, istDateKey } from "@/lib/market/marketHours";
import { alertKey, liveAlerts, unsentAlerts, type LiveQuote } from "./liveWatch";
import { hasOpenPositions, positionsView } from "./positionsServer";

/**
 * Two small jobs that run while the app is open, both owner-only (PERSONAL_ALERT_EMAIL, never the group list):
 *  - while the market is open, an email the moment a real position's price reaches its stop (and a late-session heads-up when it trades
 *    under its 50-day average), once a day per position;
 *  - after the close, an email when the saved price data is more than a session old, because every exit signal depends on it.
 */
const DIR = join(process.cwd(), ".cache");
const LIVE_FILE = join(DIR, "positions-live.json");
const FRESH_FILE = join(DIR, "freshness-alarm.json");
const TICK_MS = 120_000;
const FRESHNESS_EVERY_MS = 30 * 60_000;
/** Late-session heads-ups start at 14:45 IST. */
const FIFTY_DAY_FROM_MIN = 14 * 60 + 45;
/** The freshness alarm is not raised before 19:30 IST: the nightly refresh and the catch-up have had their chance by then. */
const FRESHNESS_FROM_MIN = 19 * 60 + 30;

const store = ((globalThis as { __positionsWatchdog?: { timer: ReturnType<typeof setInterval> | null; lastFreshness: number } }).__positionsWatchdog ??= { timer: null, lastFreshness: 0 });

const istMinutes = (now: number) => { const d = new Date(now + 19_800_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

function readJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; }
}
function writeJson(file: string, value: unknown) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/** Checks every open position against the live price. Returns how many alerts were emailed. */
export async function checkLiveStops(now = Date.now()): Promise<number> {
  if (!isTradingDay(now)) return 0;
  const status = getMarketStatus(now);
  if (!status.isLive || status.label.includes("simulated") || !hasOpenPositions()) return 0;
  const items = positionsView(now).open.map(({ holding, assessment }) => ({ holding, sma50: assessment.sma50 }));
  if (!items.length) return 0;
  const raw = await getQuotes([...new Set(items.map((i) => i.holding.symbol))]);
  const quotes = new Map<string, LiveQuote>(raw.map((q) => [q.symbol, { ltp: q.ltp, timestamp: q.timestamp }]));
  const alerts = liveAlerts(items, quotes, now, istMinutes(now) >= FIFTY_DAY_FROM_MIN);

  const today = istDateKey(now);
  const saved = readJson<{ day: string; sent: string[] }>(LIVE_FILE);
  const sent = saved?.day === today ? saved.sent : [];
  const fresh = unsentAlerts(alerts, sent);
  if (!fresh.length) return 0;

  const stops = fresh.filter((a) => a.kind === "stop");
  const source = getDataSource();
  const lines = [
    ...fresh.map((a) => a.text),
    `Price source: ${source.label}${source.isRealtime ? "" : ", which may be delayed by a few minutes"}.`,
    "The app never places orders. Open My positions to mark a sale once you have placed it.",
  ];
  const subject = stops.length
    ? `My positions · stop reached: ${stops.map((a) => a.symbol).join(", ")} · live`
    : `My positions · heads-up: ${fresh.map((a) => a.symbol).join(", ")} under the 50-day average · live`;
  if (!(await notifyOwner(subject, lines))) return 0;
  writeJson(LIVE_FILE, { day: today, sent: [...sent, ...fresh.map(alertKey)] });
  return fresh.length;
}

/** After the close: one email a day if the price files are more than a session behind. Only when something depends on them. */
export async function checkFreshnessAlarm(now = Date.now()): Promise<boolean> {
  if (!isTradingDay(now) || istMinutes(now) < FRESHNESS_FROM_MIN) return false;
  if (!readTracker() && !hasOpenPositions()) return false;
  const today = istDateKey(now);
  if (readJson<{ day: string }>(FRESH_FILE)?.day === today) return false;
  const result = dataFreshness({ lastCandleDay: historyLastDay(), refreshedDay: refreshState().lastDay, now });
  if (result.state !== "stale") return false;
  const sent = await notifyOwner("Price data is old · exit signals may be late", [
    result.message,
    "Nothing has been sold or changed. Until the data catches up, check your positions on your broker app.",
  ]);
  if (sent) writeJson(FRESH_FILE, { day: today });
  return sent;
}

async function tick() {
  try {
    await checkLiveStops();
    const now = Date.now();
    if (now - store.lastFreshness >= FRESHNESS_EVERY_MS) {
      store.lastFreshness = now;
      await checkFreshnessAlarm(now);
    }
  } catch (error) {
    console.error("[positions] watchdog failed:", error instanceof Error ? error.message : error);
  }
}

export function startPositionsWatchdog() {
  if (store.timer) return;
  store.timer = setInterval(() => void tick(), TICK_MS);
  store.timer.unref?.();
  setTimeout(() => void tick(), 45_000).unref?.();
}
