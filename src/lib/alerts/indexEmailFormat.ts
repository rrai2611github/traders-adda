import type { IndexContext } from "../market/indexContext";
import type { IndexAnalysis } from "../market/indexAnalysis";
import type { IndexOutlookRecord } from "../market/indexOutlookJournal";
import { getMarketStatus, istDateKey } from "../market/marketHours.ts";
import { AMBER, GREEN, RED, dataTable, esc, stockCell, tag } from "./compactEmail.ts";
import { BRAND } from "./brand.ts";
import type { HourlyIndexRead } from "../market/indexHourly.ts";
import { FONT } from "./watchEmail.ts";

const INDEX_NAMES: Record<string, string> = {
  NIFTY50: "Nifty", BANKNIFTY: "Bank Nifty", NIFTYIT: "Nifty IT", NIFTYMIDCAP: "Midcap 100",
};
const price = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
const clock = (value: number) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export interface IndexEmailSnapshot {
  source: string;
  day: string;
  sentAt: number;
  membershipAsOf: string;
  indices: Record<string, {
    price: number | null; quoteAt: number | null;
    breadth50: number | null; coverage50: number; total: number; breadthSession: string | null;
  }>;
}

export interface IndexEmailInput {
  context: IndexContext | null;
  completed?: IndexContext | null;
  previous?: IndexEmailSnapshot | null;
  savedPlans?: IndexOutlookRecord[];
  /** Hourly-candle read per index symbol; null when its candles were unavailable. */
  hourly?: Record<string, HourlyIndexRead | null>;
  error?: string | null;
}

function usableQuote(context: IndexContext, symbol: string, now: number) {
  const quote = context.quotes?.[symbol];
  const live = getMarketStatus(now).isLive;
  return quote && Number.isFinite(quote.ltp) && quote.ltp > 0 &&
    Number.isFinite(quote.timestamp) && quote.timestamp <= now &&
    (!live || (istDateKey(quote.timestamp) === istDateKey(now) && now - quote.timestamp <= 300_000))
    ? quote : null;
}

function usableBreadth(context: IndexContext, symbol: string, now: number) {
  const p = context.breadthByIndex?.[symbol];
  return p && p.asOf === istDateKey(now) && !context.historyCoverage?.[symbol]?.stale &&
    context.breadthAsOf != null && context.breadthAsOf <= now && now - context.breadthAsOf <= 90_000;
}

export function buildIndexEmailSnapshot(context: IndexContext | null, now: number): IndexEmailSnapshot | null {
  if (!context || context.mode !== "live" || /mock|demo|simulat|synthetic/i.test(context.source)) return null;
  return {
    source: context.source, day: istDateKey(now), sentAt: now, membershipAsOf: context.membershipAsOf,
    indices: Object.fromEntries(Object.keys(INDEX_NAMES).map((symbol) => {
      const q = usableQuote(context, symbol, now);
      const p = context.breadthByIndex?.[symbol];
      const aligned = usableBreadth(context, symbol, now);
      return [symbol, {
        price: q?.ltp ?? null, quoteAt: q?.timestamp ?? null,
        breadth50: aligned ? p.current.above50 : null,
        coverage50: aligned ? p.current.coverage50 : 0, total: p?.current.total ?? 0,
        breadthSession: aligned ? p.asOf : null,
      }];
    })),
  };
}

/** "22961.95" in a sentence reads as noise next to "22,962" elsewhere: whole rupees, grouped, like every other level in the email. */
const tidy = (sentence: string) => sentence.replace(/\b\d{3,6}\.\d{2}\b/g, (n) => whole(Number(n)));

/** Index names for the codes the data layer reports as unavailable. */
const UNAVAILABLE_NAMES: Array<[RegExp, string]> = [[/NIFTY50/g, "Nifty 50"], [/BANKNIFTY/g, "Bank Nifty"], [/NIFTYIT/g, "Nifty IT"], [/NIFTYMIDCAP/g, "Midcap 100"], [/INDIAVIX/g, "India VIX"]];

/**
 * What could not be loaded, in words. Per-index "current-session history" and "analysis" gaps are already said on that index's own
 * lines, so they are not repeated as a list of codes.
 */
function unavailableNote(items: ReadonlyArray<string>): string[] {
  const rest = items.filter((item) => !/current-session history|analysis$/i.test(item));
  return rest.length ? [`Not available: ${UNAVAILABLE_NAMES.reduce((text, [pattern, name]) => text.replace(pattern, name), rest.join(", "))}.`] : [];
}

function planLines(analysis: IndexAnalysis | undefined) {
  if (!analysis) return ["Trend history unavailable today (too little price data from the source), so no plan is shown."];
  const major = analysis.rankedLevels?.filter((level) => level.strength === "Major").slice(0, 2);
  return [
    tidy(analysis.summary),
    `Bullish: ${tidy(analysis.scenarios.bullish)}`,
    `Bearish: ${tidy(analysis.scenarios.bearish)}`,
    `Range: ${tidy(analysis.scenarios.range)}`,
    `Major references (importance, not probability): ${major?.map((level) => `${whole(level.price)} (${level.side.toLowerCase()})`).join(" · ") || "none identified"}.`,
  ];
}

export function buildIndexEmailSection(input: IndexEmailInput, now: number): { html: string; text: string[] } {
  const context = input.context;
  if (!context) {
    const reason = input.error ?? "Index feeds unavailable; no analysis substituted.";
    return { html: `<p style="font:400 12px ${FONT};color:${BRAND.muted}">${esc(reason)}</p>`, text: [reason] };
  }
  if (/mock|demo|simulat|synthetic/i.test(context.source)) {
    const reason = "Simulated index data is not included in customer market analysis. Select a real market provider.";
    return { html: `<p style="font:400 12px ${FONT};color:${BRAND.muted}">${reason}</p>`, text: [reason] };
  }
  if (context.mode === "live") return liveIndexSection(input, context, now);
  const rows: string[][] = [];
  const text: string[] = [];
  for (const [symbol, name] of Object.entries(INDEX_NAMES)) {
    const analysis = context.analysis[symbol];
    const coverage = context.historyCoverage?.[symbol];
    const p = context.breadthByIndex?.[symbol];
    const lines: string[] = [...planLines(analysis)];
    if (analysis && !coverage?.stale) lines.push(`Completed candle session ${istDateKey(analysis.asOf)}.`);
    if (analysis && coverage?.stale) lines.push(`⚠ Verify before use. ${coverage.reason ?? "The latest candle is old."}`);
    else if (analysis && coverage?.reason) lines.push(coverage.reason);
    if (p) {
      lines.push(`${name} above 50 DMA: ${p.current.above50 == null ? "unavailable" : `${p.current.above50.toFixed(0)}%`} (${p.current.coverage50}/${p.current.total}, session ${p.asOf}). Breadth ${p.direction.toLowerCase()}${p.change50pp != null ? `, ${signed(p.change50pp)}pp over 5 sessions (same ${p.comparisonCoverage} members)` : ""}.`);
    } else lines.push(`${name} constituent breadth unavailable.`);
    rows.push([stockCell(name, ""), `<div style="font:400 11px/1.5 ${FONT};color:${BRAND.ink}">${lines.map(esc).join("<br>")}</div>`]);
    text.push(name, ...lines, "");
  }
  const notes = [
    context.leadership, context.volatility,
    `Generated ${clock(context.generatedAt)} IST; constituent snapshot ${context.breadthAsOf ? `${clock(context.breadthAsOf)} IST` : "unavailable"}; source ${context.source}.`,
    "Completed daily/weekly context; conditional references, not forecasts.",
    "Historical breadth uses current membership, not point-in-time constituents. Levels are price structure, not option OI.",
    ...(input.error ? [input.error] : []),
    ...unavailableNote(context.unavailable),
  ];
  return {
    html: `${dataTable([{ label: "Index" }, { label: "Completed-session plan" }], rows)}
      <div style="padding-top:6px;font:400 10px/1.5 ${FONT};color:${BRAND.muted}">${notes.map(esc).join("<br>")}</div>`,
    text: [...text, ...notes],
  };
}

type Verdict = "above" | "below" | "inside" | "na";

interface LiveIndexRead {
  name: string;
  price: number | null;
  dayPct: number | null;
  low: number | null;
  high: number | null;
  sinceLastPct: number | null;
  support: number | null;
  resistance: number | null;
  verdict: Verdict;
  conflict: boolean;
  trend: string | null;
  breadth: number | null;
  breadth5d: number | null;
  breadthSinceLast: number | null;
  flags: string[];
  hourly: HourlyIndexRead | null;
  sma20: number | null;
  sma50: number | null;
  dailyTrend: string | null;
  weeklyTrend: string | null;
  bias: Bias;
  plan: string;
}

const whole = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const pct = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
const pp = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(0)}pp`;
const hm = (value: number) =>
  new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const toneColor = (value: number | null) => (value == null ? BRAND.muted : value > 0 ? GREEN : value < 0 ? RED : BRAND.muted);

const VERDICT: Record<Verdict, [string, string, string]> = {
  above: ["Above resistance", "#dcfce7", "#15803d"],
  below: ["Below support", "#fee2e2", "#b91c1c"],
  inside: ["Inside range", "#f1f5f9", "#475569"],
  na: ["Levels n/a", "#f1f5f9", "#94a3b8"],
};

/** Shortens "BANKNIFTY: +1.1 percentage points vs Nifty over 20 sessions; …" for the email. */
export function shortLeadership(value: string): string {
  const parts = value.split(";").map((part) => part.trim().match(/^(\w+): ([+-]?[\d.]+) percentage points vs Nifty over (\d+) sessions$/));
  if (!parts.length || parts.some((m) => !m)) return value;
  return `Leadership: ${parts.map((m) => `${INDEX_NAMES[m![1]] ?? m![1]} ${pct(Number(m![2]))}`).join(", ")} vs Nifty (${parts[0]![3]} sessions)`;
}

export function shortVix(value: string): string {
  const m = value.match(/^India VIX ([\d.]+)( \(stale\))?; five-session move ([+-]?[\d.]+)%/);
  return m ? `India VIX ${m[1]}${m[2] ?? ""}, ${pct(Number(m[3]))} in 5 sessions (higher expected swings, not a forecast of a fall)` : value;
}

function readIndex(input: IndexEmailInput, context: IndexContext, symbol: string, name: string, now: number): LiveIndexRead {
  const analysis = context.analysis[symbol];
  const coverage = context.historyCoverage?.[symbol];
  const p = context.breadthByIndex?.[symbol];
  const rawQuote = context.quotes?.[symbol];
  const quote = usableQuote(context, symbol, now);
  const flags: string[] = [];
  if (!rawQuote) flags.push("quote unavailable");
  else if (!quote) flags.push(`quote delayed (${hm(rawQuote.timestamp)}), not compared`);

  const dayPct = quote && quote.previousClose > 0 && Number.isFinite(quote.previousClose) ? (quote.ltp / quote.previousClose - 1) * 100 : null;
  const hasRange = quote && [quote.high, quote.low].every((v) => Number.isFinite(v) && v > 0) && quote.high >= quote.low;

  const previous = input.previous;
  const prior = previous?.indices?.[symbol];
  const sinceLastPct = quote && previous?.source === context.source && previous.day === istDateKey(now) &&
    previous.sentAt < now && prior?.price != null && prior.price > 0 &&
    prior.quoteAt != null && prior.quoteAt <= previous.sentAt && previous.sentAt - prior.quoteAt <= 300_000 &&
    quote.timestamp > prior.quoteAt && istDateKey(prior.quoteAt) === istDateKey(now)
    ? (quote.ltp / prior.price - 1) * 100 : null;

  const saved = input.savedPlans?.find((record) => record.symbol === symbol && record.tradingDate === istDateKey(now) && record.source === context.source);
  const plan = saved?.analysis ?? (input.completed?.source === context.source ? input.completed.analysis[symbol] : undefined);
  const planStale = !saved && input.completed?.historyCoverage?.[symbol]?.stale;
  const support = plan && !planStale ? plan.nearbySupport?.price ?? null : null;
  const resistance = plan && !planStale ? plan.nearbyResistance?.price ?? null : null;
  if (!saved && plan && !planStale) flags.push("no saved pre-open plan; levels from previous close");

  let verdict: Verdict = "na";
  if (quote && (support != null || resistance != null)) {
    verdict = resistance != null && quote.ltp > resistance ? "above" : support != null && quote.ltp < support ? "below" : "inside";
  }
  const breadthNow = Boolean(p && usableBreadth(context, symbol, now));
  const breadth = p?.current.above50 ?? null;
  const conflict = verdict === "above" && breadthNow && breadth != null && breadth < 50;

  const breadthSinceLast = p && previous?.source === context.source && previous.day === istDateKey(now) &&
    previous.sentAt < now && previous.membershipAsOf === context.membershipAsOf && breadthNow &&
    prior?.breadthSession === p.asOf && breadth != null && prior.breadth50 != null &&
    prior.coverage50 === p.current.coverage50 && prior.total === p.current.total && p.current.coverage50 === p.current.total
    ? breadth - prior.breadth50 : null;
  if (p && !breadthNow) flags.push("breadth from prior session/delayed");
  if (coverage?.stale) flags.push("stale history, verify");
  else if (!analysis) flags.push("trend history unavailable");

  const hourly = input.hourly?.[symbol] ?? null;
  const partial = {
    name, dayPct, support, resistance, verdict, conflict, breadth,
    hourly, sma20: analysis?.sma20 ?? null, sma50: analysis?.sma50 ?? null,
    dailyTrend: analysis?.dailyTrend ?? null, weeklyTrend: analysis?.weeklyTrend ?? null,
    price: rawQuote?.ltp ?? null,
  };
  const bias = indexBias(partial);
  return {
    name,
    price: rawQuote?.ltp ?? null,
    dayPct,
    low: hasRange ? quote.low : null,
    high: hasRange ? quote.high : null,
    sinceLastPct,
    support,
    resistance,
    verdict,
    conflict,
    trend: analysis ? `Daily ${analysis.dailyTrend} · Week ${analysis.weeklyTrend}` : null,
    breadth,
    breadth5d: p?.change50pp ?? null,
    breadthSinceLast,
    flags,
    hourly,
    sma20: partial.sma20, sma50: partial.sma50, dailyTrend: partial.dailyTrend, weeklyTrend: partial.weeklyTrend,
    bias,
    plan: planFor({ ...partial, bias }),
  };
}

const arrows = (h: HourlyIndexRead) => h.lastThree.map((d) => (d === "up" ? "↑" : "↓")).join("");

/** "Hourly Weak · RSI 44 · below 20 EMA · 1h range 22,180–22,651 (inside)". */
function hourlyLine(h: HourlyIndexRead): string {
  return `Hourly ${h.trend} · RSI ${h.rsi14 ?? "—"} · ${h.aboveEma20 == null ? "20 EMA n/a" : h.aboveEma20 ? "above" : "below"} 20 EMA · ${arrows(h)} · 1h range ${whole(h.support)}–${whole(h.resistance)} (${h.position})`;
}

type Bias = "Bullish" | "Bearish" | "Neutral";
type BiasInput = Pick<LiveIndexRead, "verdict" | "conflict" | "hourly" | "dailyTrend" | "weeklyTrend">;

const trendScore = (trend: string | null | undefined) => (trend === "Constructive" ? 1 : trend === "Weak" ? -1 : 0);

/** One badge per index: daily, weekly and hourly trend plus the position against the morning levels. */
function indexBias(r: BiasInput): Bias {
  const score = trendScore(r.dailyTrend) + trendScore(r.weeklyTrend) + trendScore(r.hourly?.trend)
    + (r.verdict === "above" ? 1 : r.verdict === "below" ? -1 : 0);
  if (score >= 2) return r.conflict ? "Neutral" : "Bullish";
  return score <= -2 ? "Bearish" : "Neutral";
}

const BIAS_BADGE: Record<Bias, [string, string]> = {
  Bullish: ["#dcfce7", "#15803d"],
  Bearish: ["#fee2e2", "#b91c1c"],
  Neutral: ["#f1f5f9", "#475569"],
};

/** The "plan for today" sentence: what keeps the bias and what would change it. Rule-based, conditional, not a forecast. */
function planFor(r: Pick<LiveIndexRead, "name" | "price" | "support" | "resistance" | "sma20" | "bias" | "hourly" | "breadth" | "verdict">): string {
  const S = r.support, R = r.resistance;
  if (S == null && R == null) return "Reference levels are unavailable, so no plan levels are substituted.";
  const parts: string[] = [];
  const n = r.name;
  if (r.bias === "Bearish") {
    const ref = r.sma20 != null && r.price != null && r.sma20 > r.price ? `its 20-day average (${whole(r.sma20)})` : R != null ? whole(R) : null;
    parts.push(ref ? `Bias stays bearish while ${n} trades below ${ref}.` : "Bias is bearish.");
    if (R != null) parts.push(`A close above ${whole(R)} on improving breadth would shift it to neutral; until then rallies are likely to meet supply.`);
    if (S != null) parts.push(`A break below ${whole(S)} opens the way to a lower range.`);
  } else if (r.bias === "Bullish") {
    parts.push(S != null ? `Bias is bullish while ${n} holds above ${whole(S)}.` : "Bias is bullish.");
    if (R != null) parts.push(`A move through ${whole(R)} with volume would extend it.`);
    if (S != null) parts.push(`A break below ${whole(S)} turns the bias neutral.`);
  } else if (r.verdict === "below" && S != null) {
    parts.push(`${n} has slipped below its support at ${whole(S)}. Reclaiming it would steady the index; staying below keeps it weak.`);
  } else if (r.verdict === "above" && R != null) {
    parts.push(`${n} is above its resistance at ${whole(R)}. Holding above it would turn the bias constructive; falling back inside the range would not.`);
  } else if (S != null && R != null) {
    parts.push(`${n} is between ${whole(S)} and ${whole(R)}. Above ${whole(R)} turns the bias constructive; below ${whole(S)} turns it weak.`);
  } else {
    parts.push(R != null ? `A close above ${whole(R)} would turn the bias constructive.` : `A break below ${whole(S as number)} would turn the bias weak.`);
  }
  return parts.join(" ");
}

function takeaway(reads: LiveIndexRead[]): string {
  const nifty = reads[0];
  const lead = nifty.dayPct != null
    ? `Nifty ${pct(nifty.dayPct)} today${nifty.verdict === "inside" ? ", inside its morning range" : nifty.verdict === "above" ? ", above morning resistance" : nifty.verdict === "below" ? ", below morning support" : ""}.`
    : "Nifty move unavailable.";
  const others = reads.slice(1).filter((r) => r.verdict === "above" || r.verdict === "below")
    .map((r) => `${r.name} ${r.verdict === "above" ? "is above morning resistance" : "has slipped below morning support"}`);
  // "No index has broken its morning levels" is only true when there are morning levels to break.
  const quiet = reads.every((r) => r.verdict === "inside" || r.verdict === "na") && reads.some((r) => r.verdict === "inside");
  const moves = others.length ? ` ${others.join("; ")}.` : quiet ? " No index has broken its morning levels." : "";
  const conflict = reads.filter((r) => r.conflict).map((r) => r.name);
  const b = nifty.breadth;
  const breadth = b != null
    ? ` Breadth ${b < 40 ? "weak" : b < 60 ? "mixed" : "strong"}: ${b.toFixed(0)}% of Nifty stocks above their 50 DMA.`
    : "";
  const h = nifty.hourly;
  const hourly = h
    ? ` On the hourly chart Nifty is ${h.trend.toLowerCase()} (${h.aboveEma20 ? "above" : "below"} its 20-hour EMA, RSI ${h.rsi14 ?? "—"}) and ${h.position === "inside" ? "inside" : h.position === "above" ? "above" : "below"} its two-session hourly range.`
    : "";
  return `${lead}${moves}${hourly}${breadth}${conflict.length ? ` Caution: ${conflict.join(", ")} above resistance on weak breadth.` : ""}`;
}

/** Hourly (live) index section: one takeaway line, one compact table, one footnote. */
function liveIndexSection(input: IndexEmailInput, context: IndexContext, now: number): { html: string; text: string[] } {
  const reads = Object.entries(INDEX_NAMES).map(([symbol, name]) => readIndex(input, context, symbol, name, now));
  const summary = takeaway(reads);
  /** Warnings that apply to every index are said once, not on each card. */
  const commonFlags = reads.length > 1 ? reads[0].flags.filter((f) => reads.every((r) => r.flags.includes(f))) : [];
  const hasLevels = (r: LiveIndexRead) => r.support != null || r.resistance != null;
  const noLevels = reads.filter((r) => !hasLevels(r)).map((r) => r.name);
  const anySaved = input.savedPlans?.some((r) => r.tradingDate === istDateKey(now) && r.source === context.source);
  const savedAt = input.savedPlans?.find((r) => r.tradingDate === istDateKey(now) && r.source === context.source)?.createdAt;

  const card = (r: LiveIndexRead) => {
    const [bg, fg] = BIAS_BADGE[r.bias];
    const box = (label: string, value: number | null, color: string) =>
      `<td width="50%" style="padding:3px"><div style="background:#f1f5f9;border-radius:8px;padding:8px 6px"><div style="font:700 9px ${FONT};letter-spacing:0.8px;text-transform:uppercase;color:${BRAND.muted}">${label}</div><div style="font:800 14px ${FONT};color:${color};padding-top:3px;white-space:nowrap">${value != null ? price(value) : "—"}</div></div></td>`;
    const [vLabel, vBg, vFg] = r.conflict ? ["Above R · weak breadth", "#fef3c7", "#92400e"] as const : VERDICT[r.verdict];
    const breadthLine = r.breadth != null
      ? `${r.breadth.toFixed(0)}% above 50 DMA${r.breadth5d != null ? ` (${pp(r.breadth5d)} 5d)` : ""}${r.breadthSinceLast != null ? ` · ${pp(r.breadthSinceLast)} since last` : ""}`
      : "Breadth n/a";
    const meta = [[r.trend, r.hourly ? `Hourly ${r.hourly.trend} · RSI ${r.hourly.rsi14 ?? "—"}` : null].filter(Boolean).join(" · ")].filter(Boolean);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:12px;margin-bottom:12px"><tr><td style="padding:14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle"><span style="font:800 17px ${FONT};color:${BRAND.ink}">${esc(r.name)}</span> <span style="display:inline-block;margin-left:6px;border-radius:999px;padding:3px 10px;font:800 10px ${FONT};letter-spacing:0.8px;text-transform:uppercase;background:${bg};color:${fg}">${r.bias}</span></td>
        <td style="vertical-align:middle;text-align:right;white-space:nowrap"><span style="font:800 18px ${FONT};color:${BRAND.ink}">${r.price != null ? price(r.price) : "n/a"}</span> <span style="font:800 13px ${FONT};color:${toneColor(r.dayPct)}">${r.dayPct != null ? pct(r.dayPct, 2) : ""}</span></td>
      </tr></table>
      <div style="font:500 11px/1.5 ${FONT};color:${BRAND.muted};padding-top:3px">${[
        r.low != null && r.high != null ? `Day ${whole(r.low)}–${whole(r.high)}` : null,
        r.sinceLastPct != null ? `${pct(r.sinceLastPct)} since last` : null,
      ].filter(Boolean).join(" · ")}</div>
      ${(() => {
        const levelRow = hasLevels(r) ? `<tr>${box("Support", r.support, GREEN)}${box("Resistance", r.resistance, RED)}</tr>` : "";
        const averageRow = r.sma20 != null || r.sma50 != null ? `<tr>${box("20 DMA", r.sma20, BRAND.ink)}${box("50 DMA", r.sma50, BRAND.ink)}</tr>` : "";
        return levelRow || averageRow ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${levelRow}${averageRow}</table>` : "";
      })()}
      ${hasLevels(r) ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background:#f6f8f8;border-left:3px solid #0f766e;border-radius:6px"><tr><td style="padding:10px 12px">
        <div style="font:800 10px ${FONT};letter-spacing:1px;text-transform:uppercase;color:#0f766e">Plan for today</div>
        <div style="font:400 13px/1.6 ${FONT};color:#1f2937;padding-top:4px">${esc(r.plan)}</div>
      </td></tr></table>` : ""}
      <div style="padding-top:8px">${r.verdict === "na" && !r.conflict ? "" : tag(vLabel, vBg, vFg).replace("margin-left:4px;", "")}<span style="font:500 11px ${FONT};color:${BRAND.muted}"> ${esc(breadthLine)}</span></div>
      ${meta.map((m) => `<div style="font:500 10px/1.5 ${FONT};color:${BRAND.muted};padding-top:2px">${esc(m)}</div>`).join("")}
      ${r.flags.filter((f) => !commonFlags.includes(f)).length ? `<div style="font:500 10px/1.5 ${FONT};color:${AMBER};padding-top:2px">⚠ ${esc(r.flags.filter((f) => !commonFlags.includes(f)).join(" · "))}</div>` : ""}
    </td></tr></table>`;
  };

  const context2 = [shortLeadership(context.leadership), shortVix(context.volatility)];
  const footnote = [
    `Quotes ${hm(context.generatedAt)} IST via ${context.source}, not exchange-verified real time.`,
    noLevels.length === reads.length ? "" : `Support/Resistance = ${anySaved && savedAt ? `frozen pre-open plan (${hm(savedAt)})` : "morning reference levels"}.`,
    reads.some((r) => r.hourly) ? "" : "Forming daily candle, not hourly candles (hourly candles unavailable).",
    noLevels.length === reads.length
      ? "No morning support/resistance levels are available today, so no plan levels are shown."
      : noLevels.length ? `No morning support/resistance for ${noLevels.join(", ")}, so no plan levels are shown for ${noLevels.length === 1 ? "it" : "them"}.` : "",
    ...(input.error ? [input.error] : []),
    ...unavailableNote(context.unavailable),
  ].filter(Boolean).join(" ");

  const html = `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:10px 12px;font:600 12px/1.5 ${FONT};color:#0c4a6e">${esc(summary)}</div>
    ${commonFlags.length ? `<div style="font:500 10px/1.5 ${FONT};color:${AMBER};padding-top:6px">⚠ ${esc(commonFlags.join(" · "))} (applies to the indexes below)</div>` : ""}
    <div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>
    ${reads.map(card).join("")}
    <div style="padding-top:2px;font:500 11px/1.5 ${FONT};color:#334155">${esc(context2.join(" · "))}</div>
    <div style="padding-top:4px;font:400 10px/1.5 ${FONT};color:${BRAND.muted}">${esc(footnote)}</div>`;

  const text = [
    summary,
    ...(commonFlags.length ? [`⚠ ${commonFlags.join(" · ")} (applies to all indexes below)`] : []),
    "",
    ...reads.map((r) => [
      `${r.name} ${r.price != null ? price(r.price) : "price n/a"}`,
      r.dayPct != null ? `${pct(r.dayPct)} today` : null,
      r.sinceLastPct != null ? `${pct(r.sinceLastPct)} since last` : null,
      r.conflict ? "Above R · weak breadth" : VERDICT[r.verdict][0],
      r.support != null || r.resistance != null ? `S ${r.support != null ? whole(r.support) : "—"} / R ${r.resistance != null ? whole(r.resistance) : "—"}` : null,
      r.breadth != null ? `${r.breadth.toFixed(0)}% above 50 DMA${r.breadth5d != null ? ` (${pp(r.breadth5d)} 5d)` : ""}${r.breadthSinceLast != null ? `, ${pp(r.breadthSinceLast)} since last` : ""}` : "breadth n/a",
      `Bias ${r.bias}`,
      r.trend,
      r.hourly ? hourlyLine(r.hourly) : null,
      ...r.flags.filter((f) => !commonFlags.includes(f)).map((f) => `⚠ ${f}`),
    ].filter(Boolean).join(" · ") + (hasLevels(r) ? `\n   Plan for today: ${r.plan}` : "")),
    "",
    context2.join(" · "),
    footnote,
  ];
  return { html, text };
}
