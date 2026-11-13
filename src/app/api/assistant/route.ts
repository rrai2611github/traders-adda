import { EQUITIES } from "@/lib/market/universe";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { universeWarmingResponse } from "@/lib/market/apiErrors";
import { scanUniverse } from "@/lib/screen/scan";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { buildTopPicks } from "@/lib/screen/topPicks";
import { analysePick } from "@/lib/screen/pickAnalysis";
import { getWeeklyTop5 } from "@/lib/screen/weeklyTop5Results";
import { APPLICATION_INTENTS, RESEARCH_INTENTS, mentionedStocks, researchAnswer, resolveResearchIntent, stockResearch, type ResearchIntent } from "@/lib/assistant/research";
import { applicationAnswer, radarAnswer, radarCandidates } from "@/lib/assistant/application";
import { performanceReport } from "@/lib/performance/report";
import { istDateKey } from "@/lib/market/marketHours";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Send valid JSON with a message and optional NSE symbols." }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || !("message" in body) || typeof body.message !== "string" ||
    !body.message.trim() || body.message.length > 500 ||
    ("symbols" in body && (!Array.isArray(body.symbols) || body.symbols.length > 2 || !body.symbols.every((s: unknown) => typeof s === "string" && s.length <= 30))) ||
    ("context" in body && (typeof body.context !== "string" || !RESEARCH_INTENTS.includes(body.context as ResearchIntent)))) {
    return Response.json({ error: "Use a question of 1–500 characters and up to two NSE symbols." }, { status: 400, headers });
  }
  const context = "context" in body ? body.context as ResearchIntent : undefined;
  const explicit = mentionedStocks(body.message, EQUITIES);
  const selected = "symbols" in body && Array.isArray(body.symbols) ? body.symbols : [];
  const intent = resolveResearchIntent(body.message, explicit.length ? undefined : context, explicit.length > 0 || selected.length > 0) ??
    (explicit.length && body.message.trim().toUpperCase() === explicit.join(" ") ? "analysis" : null);
  if (!intent) return Response.json({ error: "I can explain radar stocks, market breadth, strategies, app features, paper results, Fyers/email/engine status and individual stocks. Try 'Which stocks should I keep on my radar?' No unrestricted AI, predictions, news, fundamentals, private holdings or trade actions." }, { status: 422, headers });
  const applicationScope = APPLICATION_INTENTS.includes(intent);
  if (!applicationScope && /\bintraday\b|\bscalp\b|\b\d+\s*(min|minute|hour|hr)\b/i.test(body.message)) {
    return Response.json({ error: "This stock answer uses daily-price trend data, not intraday candles. I cannot verify an intraday bullish/bearish call here. Use the stock chart or Scalp Desk for that timeframe, or ask for the daily trend." }, { status: 422, headers });
  }
  const named = body.message.trim().match(/^analy[sz]e\s+(.+)$/i)?.[1] ??
    body.message.trim().match(/^is\s+(.+?)\s+(?:bullish|bearish|in an? (?:uptrend|downtrend))/i)?.[1] ??
    body.message.trim().match(/^(?:can|should)\s+i\s+(?:buy|sell|hold)\s+(.+?)[?!.]*$/i)?.[1];
  if (!applicationScope && named && !explicit.length && !/^(this|the|selected|these|it|that)\b/i.test(named)) {
    return Response.json({ error: "That stock name or symbol is not recognised. Use the optional stock search to choose the exact NSE equity." }, { status: 400, headers });
  }
  const symbols: string[] = applicationScope ? [] : explicit.length ? explicit :
    [...new Set(selected.map((s: string) => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 2) return Response.json({ error: "Analyse or compare at most two explicitly named stocks at a time." }, { status: 400, headers });
  if ((intent === "compare" && symbols.length !== 2) || (!applicationScope && intent !== "education" && !symbols.length)) {
    return Response.json({ error: intent === "compare" ? "Name or select exactly two stocks to compare." : "Which stock? Type its name/symbol, for example 'Is SBIN bullish or bearish?', or use the optional stock search." }, { status: 400, headers });
  }
  const instruments = symbols.map((s) => EQUITIES.find((i) => i.symbol === s));
  if (instruments.some((i) => !i)) return Response.json({ error: "Unknown NSE equity symbol. Use its exact symbol, for example SBIN or ICICIBANK." }, { status: 400, headers });
  if (intent === "education" && !symbols.length) return Response.json(researchAnswer(intent, [], null, Date.now()), { headers });
  try {
    if (intent === "strategy" || intent === "features") return Response.json(applicationAnswer(intent, Date.now()), { headers });
    if (intent === "performance" || intent === "operations") {
      const now = Date.now();
      return Response.json(applicationAnswer(intent, now, performanceReport(now, false)), { headers });
    }
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") throw state.error;
    const now = Date.now();
    const scan = scanUniverse(state.snapshot);
    const eligible = scan.metrics.filter((m) => m.passesFloor);
    const breadth = movingAverageBreadth(eligible, "vs50").percent;
    const top5 = getWeeklyTop5("completed");
    const picks = top5.status === "ready" ? buildTopPicks(eligible, top5.payload.picks) : [];
    const radar = intent === "radar" ? radarCandidates(picks.filter((p) => eligible.some((m) => m.symbol === p.symbol))) : [];
    const globalWarnings: string[] = [];
    if (state.refreshFailure) globalWarnings.push(`Snapshot refresh failed: ${state.refreshFailure.message}`);
    if (now - state.snapshot.completedAt > 20 * 60_000) globalWarnings.push("Snapshot read is older than 20 minutes; current eligibility is not verified.");
    if (state.snapshot.providerId === "mock") globalWarnings.push("Universe data is simulated.");
    if (top5.status !== "ready") globalWarnings.push("Top Picks source is not ready; the shortlist cannot be verified.");
    if (intent === "market") {
      const answer = researchAnswer(intent, [], breadth, now);
      return Response.json({ ...answer, title: "Market conditions from the application", summary: "Measured market participation, not a market-direction forecast.",
        sections: [{ title: "Scan evidence", lines: [`${eligible.length} stocks pass the trading floor out of ${scan.metrics.length} measured; ${state.snapshot.histories.size}/${state.snapshot.total} histories available.`,
          `${state.snapshot.dataQuality.excluded.length} histories excluded; ${state.snapshot.dataQuality.truncated.length} shortened; ${state.snapshot.dataQuality.historyFallback.length} cached after refresh failure.`,
          `Snapshot completed: ${new Date(state.snapshot.completedAt).toISOString()}.`, ...globalWarnings] }, ...answer.sections] }, { headers });
    }
    const answerSymbols = intent === "radar" ? radar.map((p) => p.symbol) : symbols;
    const stocks = answerSymbols.map((symbol) => {
      const m = scan.metrics.find((row) => row.symbol === symbol) ?? null;
      const pick = picks.find((p) => p.symbol === symbol);
      const last = scan.candlesBySymbol.get(symbol)?.at(-1);
      const warnings = [...globalWarnings];
      const excluded = state.snapshot.dataQuality.excluded.find((d) => d.symbol === symbol);
      if (excluded) warnings.push(`History excluded: ${excluded.reason}`);
      const truncated = state.snapshot.dataQuality.truncated.find((d) => d.symbol === symbol);
      if (truncated) warnings.push(`History shortened after invalid bars; ${truncated.keptSessions} clean sessions retained.`);
      if (state.snapshot.dataQuality.historyFallback.includes(symbol)) warnings.push("Cached history reused after a provider refresh failure.");
      return stockResearch({
        symbol, name: EQUITIES.find((i) => i.symbol === symbol)?.name ?? symbol, metrics: m, quote: state.snapshot.quotes.get(symbol) ?? null,
        lastDay: last ? istDateKey(last.t) : null,
        pick: pick ? { ...pick, resultsInDays: null, analysis: analysePick(pick, { breadth50: breadth }) } : null,
        picksAvailable: top5.status === "ready", warnings, breadth, now,
      });
    });
    return Response.json(intent === "radar" ? radarAnswer(stocks, breadth, now, state.snapshot.completedAt, globalWarnings) :
      researchAnswer(intent, stocks, breadth, now), { headers });
  } catch (error) {
    console.error("[assistant] research failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Research snapshot unavailable." }, { status: 502, headers });
  }
}
