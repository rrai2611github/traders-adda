import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getScannerResults } from "@/lib/screen/scannerResults";
import { getFreshUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { buildAlertTable, type AlertTable } from "./scannerAlert";
import { backtestLine } from "./dailyAlert";
import { emailConfig, sendEmail, verifyEmailConnection } from "./smtp";
import { buildHourlyEmail, emailSlotKey, type HourlyBaseline } from "./hourlyEmailFormat";
import { listedStocks, type ListedStock } from "./watchEmail";
import { logoAttachment } from "./brandAssets";
import { getIndexContext } from "@/lib/market/indexContext";
import { listIndexOutlookJournal } from "@/lib/market/indexOutlookJournal";
import { buildIndexEmailSnapshot, type IndexEmailInput, type IndexEmailSnapshot } from "./indexEmailFormat";
import { withConfluence } from "./hourlyConfluence";
import { HOURLY_SECTOR_LIMIT } from "./hourlyEmailFormat";
import { buildConfluence, CONFLUENCE_FAMILIES } from "@/lib/screen/confluence";
import { yahooProvider } from "@/lib/market/providers/yahoo";
import { getMarketStatus } from "@/lib/market/marketHours";
import { hourlyIndexRead, type HourlyIndexRead } from "@/lib/market/indexHourly";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { scanUniverse } from "@/lib/screen/scan";
import { wilderAtr } from "@/lib/screen/oscillators";
import { tradeLevels } from "@/lib/screen/tradeLevels";
import { overlayLiveQuotes } from "./liveOverlay";
import { sectorHeatLines } from "@/lib/screen/sectorHeatmap";
import { getBottomedOutResults } from "@/lib/screen/bottomedOutResults";
import { getRsiEdgeSourceResults } from "@/lib/screen/rsiEdgeChartink";
import type { ScannerPayload } from "@/lib/screen/chartinkScans";
import type { ScreenScan } from "@/hooks/useScreenScan";
import { GET as screenGET } from "@/app/api/market/screen/route";
import { getTopPicks } from "@/lib/screen/topPicksResults";
import { withNews } from "@/lib/ai/withNews";
import type { TopPicksEmailInput } from "./topPicksEmail";

export { buildHourlyEmail, emailSlotKey };

const STATE_FILE = join(process.cwd(), ".cache", "email-alert.json");
const CHECK_EVERY_MS = 60_000;
const RETRY_AFTER_MS = 10 * 60_000;

export interface EmailAlertState {
  lastSentSlotKey: string | null;
  lastSentAt: number | null;
  lastMessageId: string | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  /** Watch list in the last sent email, for Added / Removed tags. */
  lastWatch: ListedStock[] | null;
  /** Buy-ready list in the last sent email, so only new breakouts are reported. */
  lastBuy: ListedStock[] | null;
  /** Bullish-confluence symbols in the last sent email, for New / Dropped tags. */
  lastConfluence: string[] | null;
  /** Deep-base bottomed-out symbols in the last sent email, for New / Dropped tags. */
  lastBottomed?: string[] | null;
  /** Symbols in the tested-setup section of the last sent email, for the "since the last update" line. */
  lastSetup?: string[] | null;
  /** IST date (YYYY-MM-DD) of the last sent list; a new day starts from the pre-open list. */
  lastDay: string | null;
  /** Slot skipped because nothing changed. */
  lastSkippedSlotKey: string | null;
  lastIndexes: IndexEmailSnapshot | null;
}

const initialState = (): EmailAlertState => ({
  lastSentSlotKey: null,
  lastSentAt: null,
  lastMessageId: null,
  lastAttemptAt: null,
  lastError: null,
  lastWatch: null,
  lastBuy: null,
  lastConfluence: null,
  lastDay: null,
  lastSkippedSlotKey: null,
  lastIndexes: null,
});

function readState(): EmailAlertState {
  try {
    return { ...initialState(), ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return initialState();
    throw new Error("Hourly email state could not be read; refusing to discard sent-email baselines.", { cause: error });
  }
}

function writeState(state: EmailAlertState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const istDay = (now: number) => new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * What the customer already has: the last hourly email of the day, or, for the
 * day's first hourly, the pre-open brief's list (completed-session results).
 */
function baseline(now: number): HourlyBaseline | null {
  const saved = readState();
  if (saved.lastDay === istDay(now) && saved.lastBuy && saved.lastWatch) {
    return { buy: saved.lastBuy, watch: saved.lastWatch, confluence: saved.lastConfluence ?? undefined, bottomed: saved.lastBottomed ?? undefined, setup: saved.lastSetup ?? undefined };
  }
  const completed = getScannerResults("completed");
  if (completed.status !== "ready") return null;
  const morning = buildAlertTable(completed.payload, backtestLine(), { recommendationsOnly: true });
  return { buy: listedStocks(morning.rows.slice(0, 10)), watch: listedStocks((morning.watch ?? []).slice(0, 5)) };
}

/**
 * "n/5 scanners" tags for the hourly stocks, from the same sources as the app's
 * confluence panel. Display only; on any failure the email goes out without tags.
 */
async function addConfluence(table: AlertTable, scanners: ScannerPayload, scan: HourlyScan | null): Promise<AlertTable> {
  try {
    if (!scan) return table;
    const rsi = await Promise.allSettled([getRsiEdgeSourceResults()]).then(([result]) => result);
    const rsiEdge = rsi.status === "fulfilled" && Object.keys(rsi.value.scanners).length ? rsi.value : null;
    return withConfluence(table, buildConfluence(scan, scanners, rsiEdge), rsiEdge ? CONFLUENCE_FAMILIES.length : CONFLUENCE_FAMILIES.length - 1, scan.rows);
  } catch (error) {
    console.error("[email] confluence tags unavailable:", error);
    return table;
  }
}

/** Buy-above / SL / T1 / T2 for each listed confluence stock, from completed daily candles (same rules as Buy ready). */
function addConfluencePlans(table: AlertTable): AlertTable {
  try {
    if (!table.bullConfluence?.length) return table;
    const state = getUniverseSnapshot();
    if (state.status !== "ready") return table;
    const { candlesBySymbol } = scanUniverse(state.snapshot);
    const session = getActiveSession();
    return {
      ...table,
      bullConfluence: table.bullConfluence.map((idea) => {
        const done = (candlesBySymbol.get(idea.symbol) ?? []).filter((c) => {
          const day = istDateKey(c.t);
          return day < session.dateKey || (day === session.dateKey && session.progress === 1);
        });
        const atr = wilderAtr(done).at(-1);
        const levels = atr ? tradeLevels(done, atr) : null;
        return levels
          ? { ...idea, plan: { entry: levels.entry, stop: levels.stop, riskPercent: levels.riskPercent, target1: levels.target1, target2: levels.target2, buyZoneHigh: levels.buyZoneHigh } }
          : idea;
      }),
    };
  } catch (error) {
    console.error("[email] confluence plans unavailable:", error);
    return table;
  }
}

/**
 * Deep-base bottomed-out stocks for the email; when there are none, the early-base stocks instead (the format
 * labels them watch-only). Display only; on any failure the section is left out.
 */
function addBottomedOut(table: AlertTable): AlertTable {
  try {
    const state = getBottomedOutResults("live");
    if (state.status !== "ready") return table;
    const deep = state.payload.rows.filter((row) => row.tier === "deep");
    return { ...table, bottomedOut: deep.length ? deep : state.payload.rows.filter((row) => row.tier === "early") };
  } catch (error) {
    console.error("[email] bottomed-out section unavailable:", error);
    return table;
  }
}

type HourlyScan = Pick<ScreenScan, "rows" | "extraRows">;

/** The app's screen scan, fetched once per email. Null when it fails; dependent sections are then left out. */
async function loadScreenScan(): Promise<HourlyScan | null> {
  try {
    const screen = await screenGET();
    return screen.ok ? ((await screen.json()) as HourlyScan) : null;
  } catch (error) {
    console.error("[email] screen scan unavailable:", error);
    return null;
  }
}

/** Sector heat from the same rows as the app's heatmap. Display only. */
function addSectorHeat(table: AlertTable, scan: HourlyScan | null): AlertTable {
  if (!scan) return table;
  const sectorHeat = sectorHeatLines(scan.rows).slice(0, HOURLY_SECTOR_LIMIT);
  return sectorHeat.length ? { ...table, sectorHeat } : table;
}

/** Hourly-candle reads for the four indices. One failed index is null; the email still goes out. */
async function loadHourlyIndexReads(now: number): Promise<Record<string, HourlyIndexRead | null>> {
  const live = getMarketStatus(now).isLive;
  const symbols = ["NIFTY50", "BANKNIFTY", "NIFTYIT", "NIFTYMIDCAP"];
  const settled = await Promise.allSettled(symbols.map((symbol) => yahooProvider.getHourlyCandles(symbol)));
  return Object.fromEntries(settled.map((result, i) => {
    if (result.status === "rejected") {
      console.error(`[email] ${symbols[i]} hourly candles unavailable:`, result.reason);
      return [symbols[i], null];
    }
    return [symbols[i], hourlyIndexRead(result.value, now, live)];
  }));
}

export async function hourlyEmailPreview(now: number = Date.now()): Promise<
  | { ok: true; table: AlertTable; subject: string; html: string; text: string; hasChanges: boolean; indexSnapshot: IndexEmailSnapshot | null; setupSymbols: string[] | null }
  | { ok: false; reason: string }> {
  const state = getScannerResults("live");
  if (state.status === "warming") return { ok: false, reason: "The NSE universe is still loading." };
  if (state.status === "failed") return { ok: false, reason: "Market data is unavailable." };
  const scan = await loadScreenScan();
  // Last step before formatting: the latest price on every stock listed, so CMP is current when the email is sent.
  const table = await overlayLiveQuotes(addSectorHeat(addBottomedOut(addConfluencePlans(await addConfluence(buildAlertTable(state.payload, backtestLine(), { recommendationsOnly: true }), state.payload, scan))), scan), now);
  const results = await Promise.allSettled([
    getIndexContext("live", now), getIndexContext("completed", now), listIndexOutlookJournal({ tradingDate: istDay(now) }),
  ]);
  const [live, completed, journal] = results;
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[email] ${["live index analysis", "completed index references", "saved index outlooks"][i]} unavailable:`, result.reason);
      errors.push(`${["Live index analysis", "Completed index references", "Saved index outlooks"][i]} unavailable.`);
    }
  });
  const indexes: IndexEmailInput = {
    context: live.status === "fulfilled" ? live.value : null,
    completed: completed.status === "fulfilled" ? completed.value : null,
    previous: readState().lastIndexes,
    hourly: await loadHourlyIndexReads(now),
    savedPlans: journal.status === "fulfilled" && journal.value.status === "available" ? journal.value.value : [],
    error: errors.length ? errors.join(" ") : null,
  };
  // The tested setup, the same list as the dashboard's Top picks. A failure leaves the section out; the email still goes.
  let setup: TopPicksEmailInput | null = null;
  try {
    // Hourly emails reuse the notes written for the pre-open email; they never trigger a paid call.
    const picks = await withNews(await getTopPicks("live"), { cacheOnly: true });
    if (picks) setup = picks;
  } catch (error) {
    console.error("[email] tested-setup section unavailable:", error instanceof Error ? error.message : error);
  }
  // Formatting uses the actual time after fetches, never the request-start time as a quote timestamp.
  const generatedAt = Date.now();
  return { ok: true, table, ...buildHourlyEmail(table, generatedAt, baseline(now), indexes, setup),
    indexSnapshot: buildIndexEmailSnapshot(indexes.context, generatedAt),
    setupSymbols: setup ? setup.picks.filter((p) => p.tag === "ready" || p.tag === "broke").map((p) => p.symbol) : null };
}
export function hourlyEmailStatus() {
  return {
    configured: emailConfig() != null,
    autoSend: process.env.EMAIL_AUTO_SEND === "1",
    recipient: process.env.EMAIL_TO?.trim() || null,
    nextEligibleSlot: emailSlotKey(),
    ...readState(),
  };
}

/** Every eligible hourly slot carries index context, even with unchanged stock lists. */
export async function sendHourlyEmailNow(): Promise<{ messageId: string; picks: number; slotKey: string | null; skipped: false }> {
  const fresh = await getFreshUniverseSnapshot();
  if (fresh.status === "warming") throw new Error("The NSE universe is still loading.");
  if (fresh.status === "failed") throw new Error("Could not refresh market data for the hourly email.");
  const now = Date.now();
  const preview = await hourlyEmailPreview(now);
  if (!preview.ok) throw new Error(preview.reason);
  const prior = readState();
  const slotKey = emailSlotKey(now);
  const sentLists = {
    lastWatch: listedStocks((preview.table.watch ?? []).slice(0, 5)),
    lastBuy: listedStocks(preview.table.rows.slice(0, 10)),
    // Keep the previous list when this email had no confluence data, so tags stay honest next hour.
    lastConfluence: preview.table.bullConfluence ? preview.table.bullConfluence.map((idea) => idea.symbol) : prior.lastConfluence,
    lastBottomed: preview.table.bottomedOut ? preview.table.bottomedOut.map((pick) => pick.symbol) : prior.lastBottomed ?? null,
    lastDay: istDay(now),
    lastIndexes: preview.indexSnapshot,
    lastSetup: preview.setupSymbols ?? prior.lastSetup ?? null,
  };
  try {
    const messageId = await sendEmail(preview.subject, preview.html, preview.text, [logoAttachment()]);
    writeState({
      ...prior,
      ...sentLists,
      lastSentSlotKey: slotKey,
      lastSentAt: now,
      lastMessageId: messageId,
      lastAttemptAt: now,
      lastError: null,
      lastSkippedSlotKey: null,
    });
    return { messageId, picks: preview.table.rows.slice(0, 10).length, slotKey, skipped: false };  } catch (error) {
    writeState({
      ...prior,
      lastAttemptAt: now,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

let autoSendRunning = false;

async function autoEmailTick() {
  if (autoSendRunning || process.env.EMAIL_AUTO_SEND !== "1" || !emailConfig()) return;
  const slotKey = emailSlotKey();
  if (!slotKey) return;
  const state = readState();
  if (state.lastSentSlotKey === slotKey) return;
  if (state.lastAttemptAt && state.lastError && Date.now() - state.lastAttemptAt < RETRY_AFTER_MS) return;
  autoSendRunning = true;
  try {
    await sendHourlyEmailNow();
  } catch (error) {
    console.error("[email] hourly alert failed:", error instanceof Error ? error.message : error);
  } finally {
    autoSendRunning = false;
  }
}

/**
 * Sends the current hourly email to one address only, marked [TEST]. The address must already be in
 * EMAIL_TO, and no sent-email baseline or slot state is written, so the real hourly sends are unaffected.
 */
export async function sendHourlyTestEmail(to: string): Promise<{ messageId: string; to: string }> {
  const config = emailConfig();
  if (!config) throw new Error("Email is not configured: set the SMTP and EMAIL values in .env.local.");
  const target = to.trim().toLowerCase();
  if (!config.to.toLowerCase().split(",").map((a) => a.trim()).includes(target)) throw new Error("Test address must already be in EMAIL_TO.");
  const preview = await hourlyEmailPreview(Date.now());
  if (!preview.ok) throw new Error(preview.reason);
  const messageId = await sendEmail(`[TEST] ${preview.subject}`, preview.html, preview.text, [logoAttachment()], target);
  return { messageId, to: target };
}

export async function testEmailConnection() {
  await verifyEmailConnection();
  return { ok: true };
}

export function startHourlyEmailScheduler() {
  const g = globalThis as typeof globalThis & { __hourlyEmailTimer?: ReturnType<typeof setInterval> };
  if (g.__hourlyEmailTimer) return;
  void autoEmailTick();
  g.__hourlyEmailTimer = setInterval(() => void autoEmailTick(), CHECK_EVERY_MS);
  g.__hourlyEmailTimer.unref?.();
}
