import { getProvider } from "./providers";
import { getUniverseSnapshot } from "./universeSnapshot";
import { buildIndexAnalysis, completedIndexCandles, type IndexAnalysis, type IndexBreadth } from "./indexAnalysis";
import membership from "./data/index-analysis-membership.json";
import { buildIndexParticipation, type IndexParticipation } from "./indexParticipation";
import { istDateKey } from "./marketHours";
import { expectedIndexSession, indexHistoryIssue, isIndexContextCacheFresh } from "./indexDataQuality";
import { shouldUpdateIndexOutlookJournal, updateIndexOutlookJournal, type IndexOutlookRecord, type IndexOutlookJournalSummary } from "./indexOutlookJournal";
import type { Candle, Quote } from "./types";
import { mergeQuoteIntoCandles } from "./candleMerge";

export interface IndexContext {
  generatedAt: number;
  mode: "completed" | "live";
  source: string;
  analysis: Record<string, IndexAnalysis>;
  niftyBreadth: IndexBreadth | null;
  breadthByIndex: Record<string, IndexParticipation>;
  historyCoverage: Record<string, { bars: number; session: string | null; expectedSession: string; stale: boolean; reason: string | null }>;
  breadthAsOf: number | null;
  membershipAsOf: string;
  membershipSources: Record<string, string>;
  leadership: string;
  volatility: string;
  unavailable: string[];
  journal?: { status: "available"; records: IndexOutlookRecord[]; summary: IndexOutlookJournalSummary }
    | { status: "unavailable" | "error"; reason: string };
  quotes?: Record<string, Quote>;
}

const symbols = ["NIFTY50", "BANKNIFTY", "NIFTYMIDCAP", "NIFTYIT", "INDIAVIX"];
const cache = new Map<string, { at: number; value: IndexContext }>();
const pending = new Map<string, Promise<IndexContext>>();

export async function getIndexContext(mode: "completed" | "live", now = Date.now()): Promise<IndexContext> {
  const provider = getProvider();
  const key = `${provider.id}:${mode}:${istDateKey(now)}`;
  const saved = cache.get(key);
  const availableBreadth = getUniverseSnapshot();
  const breadthRevision = availableBreadth.status === "ready" ? availableBreadth.snapshot.completedAt : null;
  if (saved && isIndexContextCacheFresh(saved.at, saved.value.breadthAsOf, breadthRevision, now)) return saved.value;
  const running = pending.get(key);
  if (running) return running;
  const load = async (): Promise<IndexContext> => {
    const [results, quoteResult] = await Promise.all([
      Promise.allSettled(symbols.map((s) => provider.getDailyCandles(s, 750))),
      Promise.allSettled(mode === "live" ? [provider.getQuotes(symbols)] : []),
    ]);
    const analysis: Record<string, IndexAnalysis> = {};
    const unavailable: string[] = [];
    const indexHistories = new Map<string, Candle[]>();
    const historyCoverage: IndexContext["historyCoverage"] = {};
    const quotes: Record<string, Quote> = {};
    const quoteResponse = quoteResult[0];
    if (quoteResponse?.status === "fulfilled") {
      for (const quote of quoteResponse.value) {
        if (Number.isFinite(quote.timestamp) && quote.timestamp <= Date.now() && Number.isFinite(quote.ltp) && quote.ltp > 0) quotes[quote.symbol] = quote;
        else unavailable.push(`${quote.symbol} invalid quote`);
      }
    } else if (quoteResponse?.status === "rejected") {
      console.error("[index] quotes unavailable:", quoteResponse.reason);
      unavailable.push("Index quotes unavailable");
    }
    const expectedSession = expectedIndexSession(mode, now);
    results.forEach((result, i) => {
      const symbol = symbols[i];
      if (result.status === "rejected") {
        console.error(`[index] ${symbol} history unavailable:`, result.reason);
        unavailable.push(`${symbol} history`);
        historyCoverage[symbol] = { bars: 0, session: null, expectedSession, stale: true, reason: "Provider history request failed." };
        return;
      }
      const issue = indexHistoryIssue(result.value, now);
      if (issue) {
        console.error(`[index] ${symbol}: ${issue}`);
        unavailable.push(`${symbol} history: ${issue}`);
        historyCoverage[symbol] = { bars: 0, session: null, expectedSession, stale: true, reason: issue };
        return;
      }
      const quote = quotes[symbol];
      const bars = mode === "completed" ? completedIndexCandles(result.value, now)
        : quote && quote.timestamp <= now && now - quote.timestamp <= 300_000
          ? mergeQuoteIntoCandles(result.value, quote) : result.value;
      if (mode === "live" && !quote) unavailable.push(`${symbol} quote unavailable`);
      indexHistories.set(symbol, bars);
      const reading = buildIndexAnalysis(bars, symbol, now);
      const session = bars.at(-1) ? istDateKey(bars.at(-1)!.t) : null;
      historyCoverage[symbol] = {
        bars: bars.length, session, expectedSession, stale: session !== expectedSession,
        reason: bars.length < 5 ? `${provider.id} returned only ${bars.length} daily bar(s); at least 5 required. No ETF or another index substituted.`
          : session !== expectedSession ? `Latest candle is ${session}; expected ${expectedSession}.`
          : bars.length < 200 ? "Partial indicator coverage: fewer than 200 daily sessions." : null,
      };
      if (reading) analysis[symbol] = reading;
      else unavailable.push(`${symbol} analysis`);
      if (reading && session !== expectedSession) unavailable.push(`${symbol} current-session history`);
    });
    const snapshot = getUniverseSnapshot();
    let niftyBreadth: IndexBreadth | null = null;
    let breadthAsOf: number | null = null;
    const breadthByIndex: Record<string, IndexParticipation> = {};
    if (snapshot.status === "ready") {
      const histories = new Map<string, Candle[]>();
      for (const [symbol, history] of snapshot.snapshot.histories) {
        const bars = mode === "completed" ? completedIndexCandles(history, now) : history;
        histories.set(symbol, bars);
      }
      for (const [symbol, definition] of Object.entries(membership.indices)) {
        const indexBars = indexHistories.get(symbol) ?? [];
        // Quote-only index history can still anchor current breadth, but not its 5-session direction.
        const participation = buildIndexParticipation(histories, definition.members, indexBars);
        if (participation) {
          breadthByIndex[symbol] = participation;
          if (participation.current.covered < definition.members.length) unavailable.push(`${symbol} breadth: ${participation.current.covered}/${definition.members.length} session-aligned members`);
        } else unavailable.push(`${symbol} constituent breadth`);
      }
      niftyBreadth = breadthByIndex.NIFTY50?.current ?? null;
      breadthAsOf = snapshot.snapshot.completedAt;
    } else unavailable.push("Index constituent breadth: universe still loading or unavailable");
    const nifty = analysis.NIFTY50?.return20d;
    const relative = ["BANKNIFTY", "NIFTYIT", "NIFTYMIDCAP"].flatMap((s) => {
      const ret = analysis[s]?.return20d;
      if (ret == null || nifty == null || historyCoverage[s]?.stale || historyCoverage.NIFTY50?.stale ||
        istDateKey(analysis[s].asOf) !== istDateKey(analysis.NIFTY50.asOf)) return [];
      const delta = ret - nifty;
      return [`${s}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} percentage points vs Nifty over 20 sessions`];
    });
    const vix = analysis.INDIAVIX;
    const value: IndexContext = {
      generatedAt: now, mode, source: provider.id, analysis, niftyBreadth, breadthByIndex, historyCoverage, breadthAsOf, quotes,
      membershipAsOf: membership.generatedAt,
      membershipSources: Object.fromEntries(Object.entries(membership.indices).map(([symbol, definition]) => [symbol, definition.source])),
      leadership: relative.length ? relative.join("; ") : "Leadership comparison unavailable.",
      volatility: vix
        ? `India VIX ${vix.close.toFixed(2)}${historyCoverage.INDIAVIX.stale ? " (stale)" : ""}; five-session move ${vix.return5d?.toFixed(1) ?? "unavailable"}%. Rising VIX signals greater implied volatility, not a guaranteed market fall.`
        : "India VIX unavailable.",
      unavailable,
    };
    if (mode === "completed" && shouldUpdateIndexOutlookJournal(Date.now())) {
      try {
        await updateIndexOutlookJournal(value, { histories: indexHistories });
      } catch (error) {
        console.error("[index] outlook journal update failed:", error);
        unavailable.push("Outlook journal persistence failed");
        value.journal = { status: "error", reason: "Outlook journal could not be saved. Check server logs and disk permissions." };
      }
    }
    cache.set(key, { at: now, value });
    return value;
  };
  const promise = load();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
