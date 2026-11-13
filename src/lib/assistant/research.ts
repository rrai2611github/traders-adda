import type { StockMetrics } from "../screen/metrics.ts";
import type { Quote } from "../market/types.ts";
import type { AnalysedPick } from "../screen/topPicksResults.ts";
import { quoteSourceLabel } from "../market/quoteQuality.ts";
import { dataFreshness } from "../market/freshness.ts";
import { setupStatus } from "../screen/setupGate.ts";
import { quickRows } from "../screen/quickRead.ts";

export const QUESTIONS = ["Is this stock bullish or bearish?", "Can I buy this stock?", "What are its risks?", "Show support and resistance", "Which stocks should I keep on my radar?", "How is the market?", "How are the paper results?", "Compare these stocks"] as const;
export const RESEARCH_INTENTS = ["analysis", "sentiment", "decision", "price", "volume", "setup", "risks", "levels", "compare", "education", "radar", "market", "strategy", "performance", "operations", "features"] as const;
export type ResearchIntent = typeof RESEARCH_INTENTS[number];
export const APPLICATION_INTENTS: ResearchIntent[] = ["radar", "market", "strategy", "performance", "operations", "features"];
export interface ResearchAnswer {
  title: string;
  summary: string;
  symbols: string[];
  readAt: number;
  sections: Array<{ title: string; lines: string[] }>;
  stocks: StockResearch[];
  sources: Array<{ label: string; href: string }>;
  focus: ResearchIntent;
}
export interface StockResearch {
  symbol: string;
  name: string;
  session: string | null;
  source: string;
  fetchedAt: number | null;
  quoteAt: number | null;
  status: string;
  outlook: { label: "Bullish" | "Bearish" | "Mixed / neutral" | "Insufficient data"; explanation: string };
  metrics: Array<{ label: string; value: string }>;
  evidence: string[];
  risks: string[];
  levels: string[];
  missing: string[];
}

export function researchIntent(message: string, stockContext = false): ResearchIntent | null {
  const text = message.toLowerCase().trim();
  if (/\b(execute|automate|guarantee|guaranteed|predict|prediction|forecast|holdings|news|fundamentals)\b|place.{0,25}order|send.{0,25}order|my portfolio/.test(text)) return null;
  if (stockContext && /compar\w* (to|with|against) (the )?(market|nifty|benchmark)/.test(text)) return "analysis";
  if (stockContext && /compare|\bvs\b|versus/.test(text)) return "compare";
  if (/bullish|bearish|sentiment|positive or negative|uptrend|downtrend/.test(text)) return "sentiment";
  if (stockContext && /relative strength|\brs\b/.test(text) && /explain|what|meaning/.test(text)) return "education";
  if (/can i buy|should i buy|good (time|stock|buy)|worth buying|buy or sell|should i sell|should i hold/.test(text)) return "decision";
  if (/support|resistance|stop.?loss|target|invalidat/.test(text)) return "levels";
  if (stockContext && /risk|caution|warning/.test(text)) return "risks";
  if (stockContext && /volume|liquidity|turnover/.test(text)) return "volume";
  if (stockContext && /\bprice\b|\bcmp\b|\bltp\b/.test(text)) return "price";
  if (stockContext && /trend|doing|outlook|view|strong|weak|momentum|analy[sz]e|analysis|tell me about|what about/.test(text)) return "analysis";
  if (/why.{0,40}\bin top picks/.test(text)) return "setup";
  if (/radar|shortlist|watchlist|watch list|top picks|which.{0,45}stocks?\b|best.{0,25}stocks?\b|stocks?.{0,30}(watch|track|monitor)/.test(text)) return "radar";
  if (/email|fyers|quota|login|engine|order mode|kill switch|not working|application working|system status|data fresh|application status|app working|paper trading.{0,35}(start|stop|running|work)|why.{0,30}paper/.test(text)) return "operations";
  if (/performance|paper results|profit|backtest|capital|money used|\bpnl\b|p&l|winning|win rate|trading results/.test(text)) return "performance";
  if (/strategy|strategies|trading rules|stop.loss rule/.test(text)) return "strategy";
  if (/market|breadth/.test(text)) return "market";
  if (/application|features|scanners|what can you|help|what can i ask/.test(text)) return "features";
  if (/relative strength|\brs\b/.test(text) && /explain|what|meaning/.test(text)) return "education";
  if (/compare|\bvs\b|versus/.test(text)) return "compare";
  if (/risk|caution|warning/.test(text)) return "risks";
  if (/volume|liquidity|turnover/.test(text)) return "volume";
  if (/\bprice\b|\bcmp\b|\bltp\b/.test(text)) return "price";
  if (/level|stop|target|invalidat|exit/.test(text)) return "levels";
  if (/setup|qualif|top picks|why/.test(text)) return "setup";
  if (/analy[sz]e|analysis|research|trend|tell me about/.test(text)) return "analysis";
  return null;
}

/** Only inherit an app topic for explicit follow-ups, not unrelated unsupported questions. */
export function resolveResearchIntent(message: string, context?: ResearchIntent, stockContext = false): ResearchIntent | null {
  const direct = researchIntent(message, stockContext);
  if (context && !APPLICATION_INTENTS.includes(context) && /^(why|explain|tell me more|more details|what about (it|this|that))[\s?!.]*$/i.test(message.trim())) return context;
  if (context && APPLICATION_INTENTS.includes(context) && /^(why (these|those|them|this shortlist)|explain (these|those|that|the shortlist)|tell me more|more details|what about (these|those|them)|show risks|which ones|what should i do next)\b/i.test(message.trim()) &&
    (direct === null || direct === "setup" || direct === "risks") &&
    !/\b(news|fundamentals|predict|guarantee|order|holdings)\b/i.test(message)) return context;
  return direct;
}

export function mentionedStocks(message: string, instruments: ReadonlyArray<{ symbol: string; name: string }>): string[] {
  const text = message.toUpperCase();
  const tokens = [...text.matchAll(/[A-Z0-9&]+(?:[.-][A-Z0-9&]+)*/g)];
  const common = new Set(["RS", "IT", "A", "I", "THE", "THIS", "ALL", "AND", "YES", "MORE"]);
  const matches: Array<{ symbol: string; start: number; end: number }> = [];
  for (const instrument of instruments) {
    if (!common.has(instrument.symbol)) {
      for (const token of tokens.filter((t) => t[0] === instrument.symbol)) {
        matches.push({ symbol: instrument.symbol, start: token.index, end: token.index + token[0].length });
      }
    }
    if (instrument.name.length < 4 || common.has(instrument.name.toUpperCase())) continue;
    const company = instrument.name.replace(/\s+(limited|ltd\.?)$/i, "").trim();
    const name = company.toUpperCase().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    for (const match of text.matchAll(new RegExp(`(?:^|[^A-Z0-9&])(${name})(?=$|[^A-Z0-9&])`, "g"))) {
      const end = match.index + match[0].length;
      matches.push({ symbol: instrument.symbol, start: end - match[1].length, end });
    }
  }
  // "Bank of India" inside "State Bank of India" is not a second selected stock.
  return [...new Set(matches.filter((match) => !matches.some((other) =>
    other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start
  )).sort((a, b) => a.start - b.start).map((match) => match.symbol))];
}

const pct = (n: number | null | undefined) => n == null ? "Not available" : `${n.toFixed(1)}%`;
const price = (n: number | null | undefined) => n == null ? "Not available" : `INR ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function stockResearch(input: {
  symbol: string; name: string; metrics: StockMetrics | null; quote: Quote | null;
  lastDay: string | null; pick: AnalysedPick | null; picksAvailable: boolean;
  warnings: string[]; breadth: number | null; now: number;
}): StockResearch {
  const { metrics: m, quote: q, pick, now } = input;
  const fresh = dataFreshness({ lastCandleDay: input.lastDay, refreshedDay: null, now });
  const gate = setupStatus(input.breadth);
  const missing = [];
  if (!m) missing.push("Validated scan metrics unavailable or history too short.");
  if (!q) missing.push("No quote available in this snapshot.");
  if (!input.picksAvailable) missing.push("Top Picks source is not ready; membership and setup levels cannot be verified.");
  missing.push("This local version does not retrieve news, announcements, earnings calendars or fundamentals.");
  const limited = fresh.state === "stale" || input.warnings.length > 0 || !m || q?.source === "mock";
  const validTrends = m?.vs50 != null && Number.isFinite(m.vs50) && m.vs200 != null && Number.isFinite(m.vs200);
  const trend = validTrends ? quickRows({ vs50: m.vs50, vs200: m.vs200, rs: m.rs, paScore: null, rvol: m.volumeRatio, fromHigh: m.fromHigh, riskFlags: null })[0] : null;
  const outlook: StockResearch["outlook"] = limited || !trend ? {
    label: "Insufficient data", explanation: "A current bullish/bearish view is withheld because validated, fresh 50/200-day trend data is unavailable or limited.",
  } : {
    label: trend.rating === "Up" ? "Bullish" : trend.rating === "Down" ? "Bearish" : "Mixed / neutral",
    explanation: `${trend.note} This describes the daily-price trend, not an intraday forecast, guaranteed return or trade signal.`,
  };
  const evidence = [
    m?.vs50 == null ? "50-day trend unavailable." : `Price is ${Math.abs(m.vs50).toFixed(1)}% ${m.vs50 >= 0 ? "above" : "below"} its 50-day average.`,
    m?.vs200 == null ? "200-day trend unavailable." : `Price is ${Math.abs(m.vs200).toFixed(1)}% ${m.vs200 >= 0 ? "above" : "below"} its 200-day average.`,
    m ? `Trading liquidity floor: ${m.passesFloor ? "passes" : "does not pass"}.` : "Liquidity cannot be verified.",
    pick ? `Current Top Picks tag: ${pick.tag}. Screens: ${pick.screens.join(", ") || "not recorded"}.` :
      input.picksAvailable ? "Not in the current Top Picks list. Absence alone is not a sell signal." : "Top Picks membership unavailable.",
    gate.reason,
  ];
  const risks = [...input.warnings];
  if (fresh.state === "stale") risks.push(fresh.message);
  if (!gate.allowed) risks.push("Breadth gate does not permit new tested-strategy entries.");
  if (m && !m.passesFloor) risks.push("Fails trading liquidity/series checks.");
  if (m?.vs50 != null && m.vs50 < 0) risks.push("Below the 50-day average; this is the tested strategy's exit condition for an existing holding, not an instruction to sell.");
  if (m?.vs50 != null && m.vs50 > 25) risks.push("More than 25% above the 50-day average: extended price context.");
  if (q?.tradeTimestamp === null) risks.push("Quote trade-time freshness unverified; fetch time is not an exchange tick.");
  if (q?.source === "mock") risks.push("Simulated prices are not market evidence.");
  const plan = !limited ? pick?.analysis.plan : null;
  const levels = plan ? [
    `App setup reference buy: ${price(plan.buy)}; stop: ${price(plan.stop)} (${pct(plan.stopPercent)}). Not an executable quote.`,
    `Existing strategy exit rule: ${plan.exit}`,
    ...(plan.targets ? [`Partial-profit references: ${price(plan.targets.t1)} / ${price(plan.targets.t2)}. Reference levels, not price forecasts or fixed strategy exits.`] : []),
  ] : ["No verified setup-specific plan available. No entry, stop or target is invented."];
  return {
    symbol: input.symbol, name: input.name, session: input.lastDay,
    source: q ? quoteSourceLabel(q) : "Quote source unavailable", fetchedAt: q?.fetchedAt ?? null, quoteAt: q?.timestamp ?? null,
    outlook, status: limited ? "Data limited — research only" : !gate.allowed ? "Market gate blocked — watch only" :
      pick ? `Top Picks: ${pick.tag} — technical context, not an execution approval` : "No current Top Picks setup",
    metrics: [
      { label: "Snapshot price", value: price(q?.ltp ?? m?.price) },
      { label: "RS rating (not win probability)", value: m?.rs == null ? "Not available" : m.rs.toFixed(0) },
      { label: "Price vs SMA50", value: pct(m?.vs50) },
      { label: "Price vs SMA200", value: pct(m?.vs200) },
      { label: "Median turnover", value: m?.turnoverCr == null ? "Not available" : `INR ${m.turnoverCr.toFixed(1)} Cr/day` },
      { label: "Pivot reference", value: price(m?.pivotPrice) },
      { label: "SMA50 reference", value: price(m?.ma50) },
      { label: "SMA200 reference", value: price(m?.ma200) },
      { label: "Volume vs 50-day average", value: m?.volumeRatio == null ? "Not available" : `${m.volumeRatio.toFixed(2)}x (partial session if market open)` },
    ], evidence, risks: risks.length ? risks : ["No warning from these limited technical checks; this is not proof of low risk."], levels, missing,
  };
}

export function researchAnswer(intent: ResearchIntent, stocks: StockResearch[], breadth: number | null, now: number): ResearchAnswer {
  const educational = intent === "education";
  const metric = (s: StockResearch, label: string) => s.metrics.find((m) => m.label === label)?.value ?? "Not available";
  const direct = stocks.map((s) => {
    if (intent === "risks") return `${s.symbol}: ${s.risks.join(" ")}`;
    if (intent === "levels") return `${s.symbol}: SMA50 ${metric(s, "SMA50 reference")}; SMA200 ${metric(s, "SMA200 reference")}; breakout pivot ${metric(s, "Pivot reference")}. These are trend/pivot references, not confirmed support/resistance. ${s.levels.join(" ")}`;
    if (intent === "price") return `${s.symbol}: snapshot price ${metric(s, "Snapshot price")} (session ${s.session ?? "unknown"}). This is not a guaranteed live executable price.`;
    if (intent === "volume") return `${s.symbol}: volume ${metric(s, "Volume vs 50-day average")}; median turnover ${metric(s, "Median turnover")}. An unfinished session is not comparable to a full day's volume.`;
    if (intent === "decision" || intent === "setup") return `${s.symbol}: ${s.outlook.label} daily trend, but ${s.status}. ${s.outlook.label === "Bullish" ? "Bullish does not by itself mean buy." : "No buy approval is inferred from this view."} Review the complete checklist, earnings calendar and fresh execution data.`;
    return `${s.symbol}: ${s.outlook.label}. ${s.outlook.explanation} RS rating: ${metric(s, "RS rating (not win probability)")} (historical relative strength, not a win probability).`;
  }).join("\n");
  return {
    focus: intent,
    title: educational ? "Understanding relative strength" : intent === "compare" ? "Stock comparison" :
      intent === "sentiment" ? "Bullish or bearish?" : intent === "decision" ? "Can I buy this stock?" :
      intent === "price" ? "Stock price" : intent === "volume" ? "Volume and liquidity" :
      intent === "risks" ? "Risk review" : intent === "levels" ? "Reference levels" : intent === "setup" ? "Setup explanation" : "Stock research",
    summary: educational ? "RS ranks historical relative performance among the scanned stocks. It is not a probability of profit or a forecast." :
      direct || "Read-only, rule-based explanation of the application's snapshot. No external AI, predictions or trade execution.",
    symbols: stocks.map((s) => s.symbol), readAt: now,
    sections: [
      { title: "Market context", lines: [setupStatus(breadth).reason, "Nifty against its 200-day average is context, not the tested entry gate."] },
      ...(intent === "compare" ? [{ title: "Comparison limits", lines: [
        "Both stocks use the same universe snapshot, but their underlying sessions/fetch times may differ. No winner or investment ranking is inferred.",
        ...(new Set(stocks.map((s) => s.session)).size > 1 ? ["Underlying stock sessions differ: this is not an aligned-session comparison."] : []),
      ] }] : []),
      ...(educational ? [{ title: "How to use RS", lines: ["Higher RS means stronger historical relative performance in the scan. Compare aligned sessions and the same universe.", "A high RS score does not override breadth, liquidity, setup or data-quality checks."] }] : []),
      { title: "Scope and limitations", lines: ["Separate facts from setup eligibility. Historical backtests use today's listed stocks and may be optimistic.", "No personal holdings, broker tokens or chat history are sent to a model. Conversation stays in page memory and clears on reload.", "For unsupported questions, use the linked research tools. This assistant cannot place orders or change settings."] },
    ],
    stocks,
    sources: [
      { label: "Top Picks / market context", href: "/" },
      { label: "Core Setups snapshot", href: "/#setups" },
      { label: "Performance / data reliability", href: "/performance" },
    ],
  };
}
