import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMarketCues } from "@/lib/market/globalCues";
import { getGiftNifty } from "@/lib/market/giftNifty";
import { buildMarketOutlook, type MarketOutlook } from "@/lib/screen/marketOutlook";
import { getFreshUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getScannerResults } from "@/lib/screen/scannerResults";
import { buildMorningBrief, openingBiasWithGift, type MorningBrief } from "@/lib/screen/morningBrief";
import { getIndexContext } from "@/lib/market/indexContext";
import { buildAlertTable, type AlertTable } from "./scannerAlert";
import { overlayLiveQuotes } from "./liveOverlay";
import { backtestLine } from "./dailyAlert";
import { emailConfig, sendEmail } from "./smtp";
import { buildPreOpenEmail, preOpenSlotKey } from "./preOpenEmailFormat";
import { logoAttachment } from "./brandAssets";
import { getWeeklyTop5, type WeeklyTop5Payload } from "@/lib/screen/weeklyTop5Results";
import { getTopPicks, type TopPicksPayload } from "@/lib/screen/topPicksResults";
import { withNews } from "@/lib/ai/withNews";
import { istDateKey } from "@/lib/market/marketHours";
import { briefingFor } from "@/lib/ai/briefingServer";
import { buildBriefingFacts } from "@/lib/ai/briefingFacts";
import type { BriefingResult } from "@/lib/ai/briefing";
import { isFirstTradingDayOfWeek } from "./weeklyTop5Email";
import { recordEmailedStocks } from "@/lib/radar/radarServer";
import type { TopPickEmailItem } from "./topPicksEmail";
import { fetchIndiaHeadlines } from "@/lib/market/indiaNews";
import type { Top5Pick } from "@/lib/screen/weeklyTop5";

export { preOpenSlotKey };

const STATE_FILE = join(process.cwd(), ".cache", "preopen-email.json");
const CHECK_EVERY_MS = 60_000;
const RETRY_AFTER_MS = 5 * 60_000;

interface PreOpenState {
  lastSentSlotKey: string | null;
  lastSentAt: number | null;
  lastMessageId: string | null;
  lastAttemptAt: number | null;
  lastError: string | null;
}

const initialState = (): PreOpenState => ({
  lastSentSlotKey: null,
  lastSentAt: null,
  lastMessageId: null,
  lastAttemptAt: null,
  lastError: null,
});

function readState(): PreOpenState {
  try {
    return { ...initialState(), ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return initialState();
  }
}

function writeState(state: PreOpenState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const sessionLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(Date.UTC(year, month - 1, day));
};

/** One-line market posture from the same breadth that gates Buy ready. */
export function regimeLine(table: AlertTable): string {
  const breadth = table.breadth;
  if (breadth == null) return "Market breadth unavailable — treat every level as reference only.";
  const stance = breadth >= 60 ? "Risk-on" : breadth >= 50 ? "Selective" : breadth >= 40 ? "Cautious" : "Risk-off";
  return `${stance} · ${breadth}% of liquid NSE stocks are above their 50-day average.`;
}

export interface PreOpenPreview {
  brief: MorningBrief;
  outlook: MarketOutlook;
  table: AlertTable;
  /** The stocks the email lists beyond the table, for the email track record. */
  emailed: { topPicks: ReadonlyArray<TopPickEmailItem> | null; top5: ReadonlyArray<Top5Pick> | null };
  subject: string;
  html: string;
  text: string;
}

/**
 * Builds the pre-open message from completed-session scanner results and the
 * overnight cue feed. Uses "completed" mode, never "live", so nothing in the
 * email can be revised by an in-progress candle.
 */
export async function buildPreOpenPreview(now: number = Date.now(), options: { forceTop5?: boolean } = {}): Promise<PreOpenPreview> {
  const state = getScannerResults("completed");
  if (state.status === "warming") throw new Error("The NSE universe is still loading.");
  if (state.status === "failed") throw new Error("Market data is unavailable.");

  const table = await overlayLiveQuotes(buildAlertTable(state.payload, backtestLine(), { recommendationsOnly: true }), now);

  // A cue-feed outage must not cancel the email; the levels and ideas still ship.
  let cues;
  try {
    cues = await getMarketCues(now);
  } catch {
    cues = { cues: [], sessions: [], unavailable: ["Overnight global cues"], generatedAt: now };
  }

  const brief = buildMorningBrief({
    generatedAt: now,
    sessionLabel: sessionLabel(state.payload.sessionDateKey),
    cues: cues.cues,
    sessions: cues.sessions,
    ideas: [],
    unavailable: cues.unavailable,
  });
  const [indexContext, gift] = await Promise.all([getIndexContext("completed", now), getGiftNifty(now)]);
  brief.indexContext = indexContext;

  // Trend, breadth and cue inputs for the pre-open outlook, from the same completed-session index context.
  const indexInputs = Object.fromEntries(["NIFTY50", "BANKNIFTY", "NIFTYIT", "NIFTYMIDCAP"].map((key) => [key, {
    dailyTrend: indexContext.analysis[key]?.dailyTrend ?? null,
    weeklyTrend: indexContext.analysis[key]?.weeklyTrend ?? null,
    breadth50: indexContext.breadthByIndex?.[key]?.current.above50 ?? null,
  }]));
  const outlook = buildMarketOutlook({ gift, bias: brief.bias, cues: cues.cues, levels: brief.levels, indexes: indexInputs });
  // The outlook keeps the overnight tape as its "Global tone"; the opening call shown in the email follows GIFT Nifty when it is quoted.
  brief.bias = openingBiasWithGift(brief.bias, outlook.gift?.gapPercent);

  // The Weekly Top 5 rides along on the first trading day of the week (and always in a test email); a failure never cancels the email.
  let top5: WeeklyTop5Payload | null = null;
  if (options.forceTop5 || isFirstTradingDayOfWeek(now)) {
    try {
      const picked = getWeeklyTop5("completed");
      if (picked.status === "ready") top5 = picked.payload;
    } catch (error) {
      console.error("[email] weekly top 5 skipped:", error instanceof Error ? error.message : error);
    }
  }

  // The merged Top picks list, with its written analysis, goes in every pre-open email; the Weekly Top 5 block is its fallback.
  let topPicks: TopPicksPayload | null = null;
  try {
    // One Claude call a day writes the news-check notes (cached for the hourly emails); with no API key the section is simply left out.
    topPicks = await withNews(await getTopPicks("completed"));
  } catch (error) {
    console.error("[email] top picks skipped:", error instanceof Error ? error.message : error);
  }

  // "Today at a glance": written by Claude from a small block of facts when a key is set, by plain code otherwise. Never blocks the email.
  let briefing: BriefingResult | null = null;
  try {
    briefing = await briefingFor(buildBriefingFacts({ date: istDateKey(now), outlook, topPicks }));
  } catch (error) {
    console.error("[email] briefing skipped:", error instanceof Error ? error.message : error);
  }

  // Major India market headlines (public feeds, last 24 hours). Never blocks the email: a feed that fails just adds nothing.
  const headlines = await fetchIndiaHeadlines(now);

  // What the email lists, kept for the email track record (never part of the message itself).
  const emailed = { topPicks: topPicks?.picks ?? null, top5: top5?.picks ?? null };
  return { brief, outlook, table, emailed, ...buildPreOpenEmail(brief, table, regimeLine(table), now, state.payload.highBreakouts ?? null, outlook, top5, topPicks, briefing, headlines) };
}

export function preOpenEmailStatus() {
  return {
    configured: emailConfig() != null,
    autoSend: process.env.PREOPEN_EMAIL_AUTO_SEND === "1",
    recipient: process.env.EMAIL_TO?.trim() || null,
    currentSlot: preOpenSlotKey(),
    ...readState(),
  };
}

export async function sendPreOpenEmailNow(): Promise<{ messageId: string; picks: number; slotKey: string | null }> {
  // Captured before the warm-up, which can run past 09:15 and would otherwise
  // leave the day's slot unrecorded.
  const openingSlotKey = preOpenSlotKey();
  const fresh = await getFreshUniverseSnapshot();
  if (fresh.status === "warming") throw new Error("The NSE universe is still loading.");
  if (fresh.status === "failed") throw new Error("Could not refresh market data for the pre-open email.");

  const now = Date.now();
  const preview = await buildPreOpenPreview(now);
  const prior = readState();
  try {
    // No attachment: the morning brief is a read-in-place email. The ideas PNG
    // belongs to the hourly alert, where the table is the whole message.
    const messageId = await sendEmail(preview.subject, preview.html, preview.text, [logoAttachment()]);
    const slotKey = openingSlotKey ?? preOpenSlotKey(now);
    recordEmailedStocks("pre-open", preview.table, preview.emailed.topPicks, preview.emailed.top5, now);
    writeState({
      lastSentSlotKey: slotKey,
      lastSentAt: now,
      lastMessageId: messageId,
      lastAttemptAt: now,
      lastError: null,
    });
    return { messageId, picks: preview.table.rows.slice(0, 10).length, slotKey };
  } catch (error) {
    writeState({ ...prior, lastAttemptAt: now, lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Sends the current pre-open brief to one address only, marked [TEST]. The address must already be in EMAIL_TO,
 * and no slot or sent-email state is written, so the real 09:00 send is unaffected.
 */
export async function sendPreOpenTestEmail(to: string): Promise<{ messageId: string; to: string }> {
  const config = emailConfig();
  if (!config) throw new Error("Email is not configured: set the SMTP and EMAIL values in .env.local.");
  const target = to.trim().toLowerCase();
  if (!config.to.toLowerCase().split(",").map((a) => a.trim()).includes(target)) throw new Error("Test address must already be in EMAIL_TO.");
  const preview = await buildPreOpenPreview(Date.now(), { forceTop5: true });
  const messageId = await sendEmail(`[TEST] ${preview.subject}`, preview.html, preview.text, [logoAttachment()], target);
  return { messageId, to: target };
}

let running = false;

async function preOpenTick() {
  if (running || process.env.PREOPEN_EMAIL_AUTO_SEND !== "1" || !emailConfig()) return;
  const slotKey = preOpenSlotKey();
  if (!slotKey) return;
  const state = readState();
  if (state.lastSentSlotKey === slotKey) return;
  if (state.lastAttemptAt && state.lastError && Date.now() - state.lastAttemptAt < RETRY_AFTER_MS) return;
  running = true;
  try {
    await sendPreOpenEmailNow();
  } catch (error) {
    console.error("[email] pre-open brief failed:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function startPreOpenEmailScheduler() {
  const g = globalThis as typeof globalThis & { __preOpenEmailTimer?: ReturnType<typeof setInterval> };
  if (g.__preOpenEmailTimer) return;
  void preOpenTick();
  g.__preOpenEmailTimer = setInterval(() => void preOpenTick(), CHECK_EVERY_MS);
  g.__preOpenEmailTimer.unref?.();
}
