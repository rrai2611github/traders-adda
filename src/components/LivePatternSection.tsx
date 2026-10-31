"use client";

import { useEffect, useMemo, useState } from "react";
import { toneClass } from "@/lib/format";
import { useDailyCandles } from "@/hooks/useDailyCandles";
import type { FeedEvent, ScreenScan, ScanRow, ScanStage } from "@/hooks/useScreenScan";
import type { ScreenName } from "@/lib/screen/criteria";
import { useBreakoutFeed, latestSession } from "@/hooks/useBreakoutFeed";
import { buildGroupMap, IndustryFilterPopovers } from "./IndustryFilterPopovers";
import { classifyTicker } from "@/lib/industry";
import type { Candle, Quote } from "@/lib/market/types";
import { classifyBuyingStatus, withRiskFlags, type BuyingStatus } from "@/lib/screen/buyingStatus";
import type { RelativeVolume, RiskFlag } from "@/lib/screen/riskFlags";
import { HEALTHY_BREADTH_PERCENT, movingAverageBreadth } from "@/lib/screen/breadth";
import { BUY_READY_RULES } from "@/lib/screen/buyReady";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { MarketGateBanner } from "./MarketGateBanner";
import { RiskFlagChips, RvolPill } from "./RiskSignals";
import { StockSymbolButton } from "./StockDetailContext";
import { EmptyState } from "./WorkspaceShell";
import { StyleTag } from "./ScannerDirectory";
import { SCANNER_DIRECTORY } from "@/lib/screen/scannerDirectory";
import type { BuyHorizon } from "@/lib/screen/horizonSignal";
import {
  BREAKOUT_STATES,
  BUY_ZONE_PERCENT,
  STATES_BY_STAGE,
  breakoutState,
  type BreakoutState,
  type BreakoutStateTone,
} from "@/lib/screen/breakoutState";

const compactInr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
type SetupFilter = ScreenName;
type ViewMode = "cards" | "list";
const SETUP_FILTERS: { label: SetupFilter; value: string; icon: string; description: string; category: string }[] = [
  { label: "VCP", value: "vcp", icon: "〽", description: "Tightening price and volume", category: "Primary" },
  { label: "Blue sky", value: "blue-sky", icon: "↗", description: "Near an all-time high", category: "Confirmation" },
  { label: "Multi-year breakouts", value: "multi-year", icon: "↑", description: "Long-term base breakout", category: "Position" },
  { label: "IPO base", value: "ipo", icon: "◈", description: "Recent listing consolidation", category: "Special" },
];
/** From the 10-year backtest, each screen alone (Dec 2016 to Oct 2026, scripts/backtest-trail.mjs, after the sliver-trade fix); update when the history is refreshed. */
const SETUP_EVIDENCE: Record<SetupFilter, string> = {
  "Multi-year breakouts": "+0.8R a trade, 18% a year, worst drop 24%",
  "Blue sky": "+0.5R a trade, 19% a year, worst drop 30%",
  VCP: "+0.6R a trade, 18% a year, worst drop 27%",
  "IPO base": "+0.9R a trade, 18% a year, worst drop 22%",
};
const SETUP_HORIZON = Object.fromEntries(SCANNER_DIRECTORY.flatMap((entry) => entry.source.kind === "screen" ? [[entry.source.screen, entry.horizon]] : [])) as Record<SetupFilter, BuyHorizon>;
const DEFAULT_SORT_BY: Record<PatternKey, string> = {
  forming: "RS rating", breakouts: "RS rating", climbing: "RS rating", "played-out": "RS rating",
};

interface LivePatternSectionProps {
  scan: ScreenScan | null;
  scanError: boolean;
  scanLoadingMessage?: string | null;
  quotes: Record<string, Quote>;
  lastUpdate: number | null;
  requestedStage?: { key: PatternKey; token: number } | null;
  watchlistSymbols?: string[];
  onAddToWatchlist?: (symbol: string) => void;
  /** Opens the "All breakouts today" record, where the banner leads. */
  onOpenBreakouts?: () => void;
}

const PATTERN_ITEMS = [
  {
    key: "forming",
    value: "25",
    label: "Forming",
    detail: "resting before a breakout",
    title: "Forming — on watch",
    description:
      "Stocks that match the selected screen and have not yet closed above their base's pivot (the high that has capped them).",
    badge: "RS rating 82",
  },
  {
    key: "breakouts",
    value: "9",
    label: "Fresh breakouts",
    detail: "cleared it in the last 5 sessions",
    title: "Fresh breakouts",
    description:
      "First daily close above the base's highest close within the last 5 sessions, and not yet stopped out. The screen is judged on the facts of the breakout day, not today's. Breakout volume and close-in-range are shown, not required.",
    badge: "RS rating 94",
  },
  {
    key: "climbing",
    value: "40",
    label: "Climbing",
    detail: "broke out earlier, still rising",
    title: "Climbing — the move underway",
    description:
      "Broke out 5 or more sessions ago and has not closed below its 50-day average or 8% under the breakout close. Screened on its breakout-day facts.",
    badge: "RS rating 90",
  },
  {
    key: "played-out",
    value: "95",
    label: "Played out",
    detail: "the last 12 months' breakouts, stopped or trailed out",
    title: "Played out — the record",
    description:
      "Every breakout this calendar year that has since ended: a close 8% under the breakout close (the stop) or a close below the 50-day average (the trail). Dated exits and results, screened on breakout-day facts. A stock can appear more than once.",
    badge: "RS rating 52",
  },
] as const;

type PatternKey = (typeof PATTERN_ITEMS)[number]["key"];

type StockRow = {
  name: string;
  symbol: string;
  /** NSE-published sector, when the equity master has one. */
  sector?: string;
  rs: number;
  price?: number;
  changePercent?: number;
  pivot: number;
  tightening: number;
  volumeDryUp: number;
  /** Up/down volume, net, across the base (−1..1). */
  obv?: number;
  /** Squats (pokes above the pivot that closed back under) in the base. */
  squats?: number;
  /** Closes above the pivot that fell back inside within 10 sessions. */
  failedPokes?: number;
  from52wHigh: number;
  tags?: string[];
  breakoutDate?: string;
  /** Epoch ms of the breakout session, for sorting. */
  breakoutTimestamp?: number;
  breakoutVolume?: number;
  closeInRange?: number;
  priceVs50Ma?: number;
  resultPercent?: number;
  exitReason?: string;
  exitDate?: string;
  exitTimestamp?: number;
  history?: ScanRow["history"];
  status?: string;
  baseAgeWeeks?: number;
  baseDepth?: number;
  priceVs200Ma?: number;
  setupLevel?: number;
  above52wLow?: number;
  listedWeeks?: number;
  locked?: boolean;
  syntheticId?: string;
  /** Screens this row matched in the live scan, when it came from one. */
  screens?: SetupFilter[];
  rvol?: RelativeVolume | null;
  riskFlags?: RiskFlag[];
  /** Median daily traded value in rupees crore, from the live scan. */
  turnoverCr?: number;
  marketCapCr?: number;
  oscillatorScore?: number;
  planRiskPercent?: number;
  buyZoneHigh?: number;
};

type ChartCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

const MAX_VISIBLE_CARD_CANDLES = 80;
// Enough history for a 200-day average across the widest visible chart.
const HISTORY_CANDLES = 300;

// The rules classifyStage actually applies, in addition to the selected screen.
const STAGE_RULES: Record<PatternKey, string[]> = {
  forming: ["base at least 2 weeks old", "pivot = base's highest close", "no close above it yet"],
  breakouts: ["first close above the pivot within 5 sessions", "no close below the 50D MA or 8% under entry since"],
  climbing: ["breakout 5+ sessions ago", "no close below the 50D MA or 8% under entry since"],
  "played-out": ["broke out in the last 12 months", "then closed 8% under entry or below the 50D MA"],
};

const SORT_OPTIONS: Record<PatternKey, string[]> = {
  forming: [
    "RS rating",
    "Now vs pivot (%)",
    "Tightening (ATR ratio)",
    "Volume dry-up",
    "Up/down volume, net",
    "Base age",
    "From 52-week high",
    "Relative volume (RVOL)",
  ],
  breakouts: [
    "RS rating",
    "Breakout date",
    "Now vs pivot (%)",
    "Relative volume (RVOL)",
    "Breakout volume (vs normal day)",
    "Breakout close-in-range (0–1)",
    "1-day gain (%)",
    "Median turnover",
  ],
  climbing: [
    "RS rating",
    "Now vs pivot (%)",
    "Breakout date",
    "Relative volume (RVOL)",
    "Price vs 50-MA",
    "1-day gain (%)",
    "Median turnover",
  ],
  "played-out": [
    "RS rating",
    "Result of the breakout (%)",
    "How it ended",
    "Exit date",
    "Breakout date",
    "Now vs pivot (%)",
    "1-day gain (%)",
    "Median turnover",
  ],
};

const SOURCE_SCREEN_CRITERIA: Record<SetupFilter, string[]> = {
  VCP: [
    "coil 0.30-0.90",
    "dry-up 0.05-0.90",
    "base 3-300 weeks",
    "base depth 2-35%",
    "above 50D/200D",
    "RS 70-99",
  ],
  "Blue sky": ["level 1/highest-high base", "RS 70-99", "now vs pivot -20% to 0%"],
  "Multi-year breakouts": ["base 52-300 weeks", "now vs pivot -20% to 0%", "above 200D", "RS 60-99"],
  "IPO base": ["listed 2-50 weeks", "base 3-300 weeks", "base depth 2-35%", "above 50D", "now vs pivot -20% to 0%"],
};

const SORT_VALUE_BY_LABEL: Record<string, string> = {
  "RS rating": "rs",
  "Breakout date": "bc.boDate",
  "Now vs pivot (%)": "ext",
  "Tightening (ATR ratio)": "coil",
  "Volume dry-up": "dry",
  "Up/down volume, net": "obv",
  "Base age": "baseWk",
  "From 52-week high": "nearHigh",
  "Breakout volume (vs normal day)": "boVolX",
  "Breakout close-in-range (0–1)": "boRange",
  "Price vs 50-MA": "vs50",
  "Result of the breakout (%)": "bc.result",
  "Exit date": "bc.exitDate",
  "1-day gain (%)": "gain",
  "Median turnover": "turn",
  "Market cap": "mcap",
  "Relative volume (RVOL)": "rvol",
};

const SORT_LABEL_BY_VALUE = Object.fromEntries(
  Object.entries(SORT_VALUE_BY_LABEL).map(([label, value]) => [value, label]),
) as Record<string, string>;

const DEFAULT_SELECTED_MEASURES: Record<PatternKey, string[]> = {
  forming: [
    "RS rating",
    "Now vs pivot (%)",
    "Tightening (ATR ratio)",
    "Volume dry-up",
    "Up/down volume, net",
    "From 52-week high",
  ],
  breakouts: [
    "Breakout date",
    "Now vs pivot (%)",
    "Relative volume (RVOL)",
    "Breakout volume (vs normal day)",
    "Breakout close-in-range (0–1)",
    "RS rating",
  ],
  climbing: ["Breakout date", "Now vs pivot (%)", "Relative volume (RVOL)", "Price vs 50-MA", "RS rating"],
  "played-out": ["Breakout date", "Exit date", "Result of the breakout (%)", "How it ended"],
};

const DEFAULT_CHART_SETTINGS = {
  showPivot: true,
  showMovingAverage: true,
  showVolume: true,
  candleCount: 56,
  trailingLine: "Trail 50D MA",
};

const TRAILING_LINE_OPTIONS = [
  "No trailing line",
  "Trail 10D MA",
  "Trail 20D MA",
  "Trail 50D MA",
  "Trail 100D MA",
  "Trail 150D MA",
  "Trail 200D MA",
  "Trail 10D EMA",
  "Trail 20D EMA",
  "Trail 50D EMA",
  "Trail 100D EMA",
  "Trail 150D EMA",
  "Trail 200D EMA",
] as const;


function tickerFromSymbol(symbol: string): string {
  const parts = symbol.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : symbol;
}

function getQuoteForStock(quotes: Record<string, Quote>, symbol: string): Quote | undefined {
  const ticker = tickerFromSymbol(symbol);
  return quotes[symbol] ?? quotes[ticker] ?? quotes[`${ticker}.NS`];
}

function formatPatternPercent(value: number): string {
  const abs = Math.abs(value);
  const decimals = Number.isInteger(abs) ? 0 : 1;
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${abs.toFixed(decimals)}%`;
}

function formatCompactPercent(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${compactInr.format(Math.abs(value))}%`;
}

function formatPatternPrice(value: number): string {
  return compactInr.format(value);
}

function formatUpdateDate(epochMs: number | null): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(epochMs ?? Date.now());
}

function formatChartDate(epochMs: number | null): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
  }).format(epochMs ?? Date.now());
}

function getSearchText(stock: StockRow): string {
  return [
    stock.name,
    stock.symbol,
    tickerFromSymbol(stock.symbol),
    stock.breakoutDate,
    stock.exitReason,
    ...(stock.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getIndustry(stock: StockRow): string {
  return classifyTicker(stock.symbol, stock.sector).industry;
}

function getSubgroup(stock: StockRow): string {
  return classifyTicker(stock.symbol, stock.sector).subgroup;
}

function passesSetupFilter(stock: StockRow, setup: SetupFilter): boolean {
  return stock.screens?.includes(setup) ?? false;
}

function getSortValue(stock: StockRow, sortBy: string): number | string | null {
  switch (sortBy) {
    case "RS rating":
      return stock.rs || null;
    case "Now vs pivot (%)":
      return stock.pivot;
    case "Tightening (ATR ratio)":
      return stock.tightening;
    case "Volume dry-up":
      return stock.volumeDryUp;
    case "Up/down volume, net":
      return stock.obv ?? null;
    case "From 52-week high":
      return stock.from52wHigh;
    case "Base age":
      return stock.baseAgeWeeks ?? null;
    case "Breakout date":
      return stock.breakoutTimestamp ?? null;
    case "Breakout volume (vs normal day)":
      return stock.breakoutVolume ?? null;
    case "Breakout close-in-range (0–1)":
      return stock.closeInRange ?? null;
    case "Price vs 50-MA":
      return stock.priceVs50Ma ?? null;
    case "Result of the breakout (%)":
      return stock.resultPercent ?? null;
    case "How it ended":
      return stock.exitReason ?? null;
    case "Exit date":
      return stock.exitTimestamp ?? null;
    case "1-day gain (%)":
      return stock.changePercent ?? null;
    case "Median turnover":
      return stock.turnoverCr ?? null;
    case "Market cap":
      return stock.marketCapCr ?? null;
    case "Relative volume (RVOL)":
      return stock.rvol?.ratio ?? null;
    default:
      return stock.name;
  }
}

function sortRows(rows: StockRow[], sortBy: string, descending: boolean): StockRow[] {
  return [...rows].sort((a, b) => {
    const left = getSortValue(a, sortBy);
    const right = getSortValue(b, sortBy);
    // Missing values sort last in either direction.
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return (descending ? -result : result) || a.name.localeCompare(b.name);
  });
}

const round2 = (value: number | undefined) => (value == null ? undefined : Math.round(value * 100) / 100);

function toCsv(rows: StockRow[]): string {
  const headers = [
    "Symbol",
    "Name",
    "Price",
    "Change %",
    "RS rating",
    "Now vs pivot %",
    "Breakout date",
    "Exit date",
    "Result %",
    "Exit reason",
  ];
  const escape = (value: string | number | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = rows.map((row) =>
    [
      row.symbol,
      row.name,
      round2(row.price),
      round2(row.changePercent),
      row.rs || undefined,
      round2(row.pivot),
      row.breakoutDate,
      row.exitDate,
      round2(row.resultPercent),
      row.exitReason,
    ]
      .map(escape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function getVolumeLabel(volume: number | undefined): string {
  if (volume == null) return "Vol —";
  if (volume >= 1_000_000) return `Vol ${(volume / 1_000_000).toFixed(volume >= 10_000_000 ? 0 : 2)}M`;
  if (volume >= 1_000) return `Vol ${(volume / 1_000).toFixed(volume >= 100_000 ? 0 : 1)}K`;
  return `Vol ${volume}`;
}

function getCardMeasures(stock: StockRow, key: PatternKey): { label: string; value: string }[] {
  if (key === "played-out") {
    return [
      { label: "Breakout date", value: stock.breakoutDate ?? "—" },
      { label: "Exit date", value: stock.exitDate ?? "—" },
      { label: "Result of the breakout (%)", value: stock.resultPercent == null ? "—" : formatPatternPercent(stock.resultPercent) },
      { label: "How it ended", value: stock.exitReason ?? "—" },
    ];
  }

  if (key === "climbing") {
    return [
      { label: "Breakout date", value: stock.breakoutDate ?? "—" },
      { label: "Now vs pivot (%)", value: formatPatternPercent(stock.pivot) },
      { label: "Price vs 50-MA", value: stock.priceVs50Ma == null ? "—" : formatPatternPercent(stock.priceVs50Ma) },
      { label: "RS rating", value: String(stock.rs) },
    ];
  }

  if (key === "breakouts") {
    return [
      { label: "Breakout date", value: stock.breakoutDate ?? "—" },
      { label: "Now vs pivot (%)", value: formatPatternPercent(stock.pivot) },
      { label: "Breakout volume (vs normal day)", value: stock.breakoutVolume?.toFixed(2) ?? "—" },
      { label: "Breakout close-in-range (0–1)", value: stock.closeInRange?.toFixed(stock.closeInRange === 0.9 ? 1 : 2) ?? "—" },
      { label: "RS rating", value: String(stock.rs) },
    ];
  }

  return [
    { label: "RS rating", value: String(stock.rs) },
    { label: "Now vs pivot (%)", value: formatPatternPercent(stock.pivot) },
    { label: "Tightening (ATR ratio)", value: formatRatio(stock.tightening) },
    { label: "Volume dry-up", value: formatRatio(stock.volumeDryUp) },
    { label: "Up/down volume, net", value: formatNet(stock.obv) },
    { label: "From 52-week high", value: `${Math.round(stock.from52wHigh)}%` },
  ];
}

function getMeasureValue(stock: StockRow, measure: string): string {
  switch (measure) {
    case "RS rating":
      return stock.rs ? String(stock.rs) : "—";
    case "Now vs pivot (%)":
      return formatPatternPercent(stock.pivot);
    case "Tightening (ATR ratio)":
      return formatRatio(stock.tightening);
    case "Volume dry-up":
      return formatRatio(stock.volumeDryUp);
    case "Up/down volume, net":
      return formatNet(stock.obv);
    case "From 52-week high":
      return `${Math.round(stock.from52wHigh)}%`;
    case "Base age":
      return stock.baseAgeWeeks == null ? "—" : `${Math.max(1, Math.round(stock.baseAgeWeeks))} wk`;
    case "Breakout date":
      return stock.breakoutDate ?? "—";
    case "Breakout volume (vs normal day)":
      return stock.breakoutVolume?.toFixed(2) ?? "—";
    case "Breakout close-in-range (0–1)":
      return stock.closeInRange?.toFixed(stock.closeInRange === 0.9 ? 1 : 2) ?? "—";
    case "Price vs 50-MA":
      return stock.priceVs50Ma == null ? "—" : formatPatternPercent(stock.priceVs50Ma);
    case "Result of the breakout (%)":
      return stock.resultPercent == null ? "—" : formatPatternPercent(stock.resultPercent);
    case "How it ended":
      return stock.exitReason ?? "—";
    case "Exit date":
      return stock.exitDate ?? "—";
    case "1-day gain (%)":
      return stock.changePercent == null ? "—" : formatPatternPercent(stock.changePercent);
    case "Median turnover":
      return stock.turnoverCr == null ? "—" : `₹${compactInr.format(stock.turnoverCr)} cr`;
    case "Market cap":
      return stock.marketCapCr == null ? "—" : `₹${compactInr.format(stock.marketCapCr)} cr`;
    case "Relative volume (RVOL)":
      return stock.rvol ? `${stock.rvol.projected ? "~" : ""}${stock.rvol.ratio.toFixed(1)}×` : "—";
    default:
      return "—";
  }
}

function getBreakoutState(stock: StockRow, key: PatternKey): BreakoutState {
  return breakoutState(key, {
    pivot: stock.pivot,
    coil: stock.tightening,
    resultPercent: stock.resultPercent,
    exitReason: stock.exitReason,
  });
}

const STATE_TONE_CLASS: Record<BreakoutStateTone, string> = {
  good: "bg-emerald-50 text-emerald-700",
  watch: "bg-sky-50 text-sky-700",
  caution: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-600",
  neutral: "bg-slate-100 text-slate-600",
};

const STATE_DOT_CLASS: Record<BreakoutStateTone, string> = {
  good: "bg-emerald-500",
  watch: "bg-sky-500",
  caution: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-slate-400",
};

/** Chart-stage tag. Deliberately neutral: the coloured Status column is the only verdict. */
function BreakoutStateBadge({ state }: { state: BreakoutState }) {
  const info = BREAKOUT_STATES[state];
  return (
    <span title={`Chart stage: ${info.rule}`} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-slate-500">
      {info.label}
    </span>
  );
}

const SQUAT_TIP = "A day whose high poked above the pivot but closed back under it — an intraday test that couldn't hold. Usually harmless.";
const FAILED_POKE_TIP = "Closed above the base's highest close but never above its highest high, then closed back inside within 10 sessions.";

function getCardFlags(stock: StockRow, key: PatternKey): { icon: string; label: string; tip: string }[] {
  if (key !== "forming") return [];
  const flags: { icon: string; label: string; tip: string }[] = [];
  const squats = stock.squats ?? 0;
  const pokes = stock.failedPokes ?? 0;
  if (squats) flags.push({ icon: "⚑", label: squats === 1 ? "squat" : `${squats} squats`, tip: SQUAT_TIP });
  if (pokes) flags.push({ icon: "✕", label: pokes === 1 ? "failed poke" : `${pokes} failed pokes`, tip: FAILED_POKE_TIP });
  return flags;
}

function formatNet(value: number | undefined): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonth(timestamp: number | null | undefined): string {
  if (timestamp == null) return "";
  // IST calendar month; spelled out here because some locales print "Sept".
  return MONTHS[new Date(timestamp + 19_800_000).getUTCMonth()];
}

/** The card's one-line history for the active screen: where the run stands, or what the last breakout did. */
function getHistoryLine(stock: StockRow, key: PatternKey, screen: SetupFilter): string | null {
  const history = stock.history?.[screen] ?? stock.history?.all;
  if (!history) return null;
  if (history.run) {
    const { bases, firstTimestamp, gainPct } = history.run;
    const nth = `its ${ordinal(bases)} base`;
    if (key === "played-out") return `Played out from ${nth}`;
    const verb = key === "forming" ? "Building" : key === "breakouts" ? "Broke out of" : "Climbing from";
    const gain = Math.round(gainPct * 10) / 10;
    const move = `${gain >= 0 ? "up" : "down"} ${Math.abs(gain).toFixed(1)}%`;
    return `${verb} ${nth} — ${move} since the 1st breakout (${formatScanDate(firstTimestamp)})`;
  }
  if (history.previous) {
    const ret = formatPatternPercent(Math.round(history.previous.retPct * 10) / 10);
    return `Previous breakout played out ${ret} in ${formatMonth(history.previous.exitTimestamp)}`;
  }
  return null;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th"}`;
}

/** One plain sentence per feed event, in the reference's voice. */
function describeFeedEvent(event: FeedEvent): string {
  const pivot = `₹${formatPatternPrice(event.pivot)}`;
  switch (event.type) {
    case "breakout":
    case "inner_breakout": {
      const volume = event.volumeRatio == null ? "" : `, on ${event.volumeRatio.toFixed(1)}× its usual trading`;
      const what = event.type === "inner_breakout" ? `broke out of an inner (L${event.level ?? 2}) base` : "broke out";
      return `${what}. Closed ₹${formatPatternPrice(event.price)} — ${(event.ext ?? 0).toFixed(1)}% above the ${pivot} pivot${volume}.`;
    }
    case "milestone_10":
    case "milestone_20":
      return `closed ${event.type === "milestone_20" ? 20 : 10}% above its pivot — first time since its ${formatScanDate(event.breakoutTimestamp ?? null)} breakout.`;
    case "now_climbing":
      return `held its breakout for 5 sessions — now climbing.`;
    case "played_out":
      return `played out: ${event.why ?? "exited"} — ${formatPatternPercent(Math.round((event.retPct ?? 0) * 10) / 10)} from its ${formatScanDate(event.breakoutTimestamp ?? null)} breakout.`;
    case "failed_poke":
      return `closed back inside its base — the ${formatScanDate(event.breakoutTimestamp ?? null)} poke above ${pivot} failed.`;
    case "squat":
      return `poked above ${pivot} and closed back under — its ${ordinal(event.nth ?? 1)} test of the lid since ${formatScanDate(event.sinceTimestamp ?? null)}.`;
    case "base_born":
      return `started a new base: ${(event.baseWk ?? 0).toFixed(0)} weeks old, ${(event.baseDepth ?? 0).toFixed(1)}% deep, lid at ${pivot}.`;
  }
}

// Most actionable first, like the reference feed.
const FEED_ORDER: FeedEvent["type"][] = [
  "breakout",
  "inner_breakout",
  "milestone_20",
  "milestone_10",
  "played_out",
  "failed_poke",
  "now_climbing",
  "squat",
  "base_born",
];

/** Draws a polyline, lifting the pen over sessions without a value. */
function getLinePath(values: (number | null)[], getX: (index: number) => number, getY: (value: number) => number): string {
  let penDown = false;
  const parts: string[] = [];
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      penDown = false;
      return;
    }
    parts.push(`${penDown ? "L" : "M"} ${getX(index).toFixed(1)} ${getY(value).toFixed(1)}`);
    penDown = true;
  });
  return parts.join(" ");
}

/**
 * Real simple or exponential moving average of daily closes, aligned with the
 * candles. Sessions without enough history are null rather than estimated.
 */
function trailingLineValues(candles: Candle[], option: string): (number | null)[] {
  const match = /^Trail (\d+)D (MA|EMA)$/.exec(option);
  if (!match) return [];
  const period = Number(match[1]);
  const closes = candles.map((candle) => candle.close);
  const values: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return values;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += closes[i];
  values[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    if (match[2] === "MA") {
      sum += closes[i] - closes[i - period];
      values[i] = sum / period;
    } else {
      values[i] = closes[i] * k + (values[i - 1] as number) * (1 - k);
    }
  }
  return values;
}
function getChartCandles(dailyCandles: Candle[]): ChartCandle[] {
  return dailyCandles.slice(-MAX_VISIBLE_CARD_CANDLES).map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.t,
    }));
}

function formatRatio(value: number): string {
  return `${value.toFixed(2)}x`;
}

function getStageHeadline(key: PatternKey, count: number): string {
  switch (key) {
    case "forming":
      return `${count} ${count === 1 ? "stock is" : "stocks are"} forming a base.`;
    case "breakouts":
      return `${count} fresh ${count === 1 ? "breakout" : "breakouts"} in the last 5 sessions.`;
    case "climbing":
      return `${count} ${count === 1 ? "stock is" : "stocks are"} climbing right now.`;
    case "played-out":
      return `${count} ${count === 1 ? "breakout has" : "breakouts have"} played out.`;
  }
}

function getPivotPrice(stock: StockRow): number | null {
  if (stock.price == null) return null;
  return stock.price / (1 + stock.pivot / 100);
}

/** Renders a YYYY-MM-DD session key the way the rest of the page shows dates. */
function formatSessionLabel(day: string): string {
  const parsed = new Date(`${day}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

const SCAN_STAGE_TO_PATTERN: Record<ScanStage, PatternKey> = {  forming: "forming",
  breakout: "breakouts",
  climbing: "climbing",
  "played-out": "played-out",
};

function formatScanDate(timestamp: number | null): string | undefined {
  if (timestamp == null) return undefined;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function scanRowToStockRow(row: ScanRow): StockRow {
  const isClimbing = row.stage === "climbing";
  return {
    name: row.name,
    symbol: `NSE:${row.symbol}`,
    sector: row.sector,
    rs: row.rs ?? 0,
    price: row.price,
    changePercent: row.changePercent,
    // `pivot` on a StockRow is the extension from the pivot in percent, not the
    // pivot price itself.
    pivot: row.ext ?? 0,
    tightening: row.coil ?? 0,
    volumeDryUp: row.dry ?? 0,
    obv: row.obv ?? undefined,
    squats: row.squats,
    failedPokes: row.failedPokes,
    from52wHigh: row.fromHigh ?? 0,
    above52wLow: row.aboveLow ?? undefined,
    priceVs50Ma: row.vs50 ?? undefined,
    priceVs200Ma: row.vs200 ?? undefined,
    baseAgeWeeks: row.baseWk ?? undefined,
    baseDepth: row.baseDepth ?? undefined,
    listedWeeks: row.listedWk ?? undefined,
    setupLevel: row.level ?? undefined,
    tags: row.badges.length ? row.badges : undefined,
    screens: row.screens as SetupFilter[],
    turnoverCr: row.turnoverCr ?? undefined,
    marketCapCr: row.mcap ?? undefined,
    oscillatorScore: row.oscillatorScore?.score,
    planRiskPercent: row.oscillatorScore?.levels?.riskPercent,
    buyZoneHigh: row.oscillatorScore?.levels?.buyZoneHigh,
    breakoutDate: formatScanDate(row.breakoutTimestamp),
    breakoutTimestamp: row.breakoutTimestamp ?? undefined,
    breakoutVolume: row.breakoutVolume ?? undefined,
    closeInRange: row.closeInRange ?? undefined,
    resultPercent: row.breakoutReturn ?? undefined,
    exitReason: row.exitReason ?? undefined,
    exitDate: formatScanDate(row.exitTimestamp),
    exitTimestamp: row.exitTimestamp ?? undefined,
    history: row.history,
    syntheticId: row.key,
    rvol: row.rvol ?? null,
    riskFlags: row.riskFlags,
    status: isClimbing ? (row.changePercent >= 0 ? "Powering up" : "Cooling off") : undefined,
  };
}

function dashboardBuyingStatus(stock: StockRow, breadthPercent: number | null): BuyingStatus {
  const stageValid = stock.exitReason == null;
  return withRiskFlags(classifyBuyingStatus([
    { key: "breadth", label: `Breadth at least ${HEALTHY_BREADTH_PERCENT}%`, pass: breadthPercent != null && breadthPercent >= HEALTHY_BREADTH_PERCENT },
    { key: "liquid", label: "Liquidity at least ₹5 cr/day", pass: stock.turnoverCr != null && stock.turnoverCr >= 5 },
    { key: "rs", label: `RS at least ${BUY_READY_RULES.minRs}`, pass: stock.rs >= BUY_READY_RULES.minRs },
    { key: "trend", label: "Above 50-day and 200-day averages", pass: (stock.priceVs50Ma ?? -Infinity) > 0 && (stock.priceVs200Ma ?? -Infinity) > 0 },
    { key: "score", label: `Oscillator score at least ${BUY_READY_RULES.minScore}/15`, pass: (stock.oscillatorScore ?? -Infinity) >= BUY_READY_RULES.minScore },
    { key: "risk", label: `Planned risk at most ${BUY_READY_RULES.maxRiskPercent}%`, pass: stock.planRiskPercent != null && stock.planRiskPercent <= BUY_READY_RULES.maxRiskPercent },
    { key: "extension", label: "Price is inside the planned buy zone", pass: stock.price != null && stock.buyZoneHigh != null && stock.price <= stock.buyZoneHigh },
    { key: "pattern", label: "Setup remains active", pass: stageValid },
  ]), stock.riskFlags);
}

/** Buckets a live scan into the four stage tables the screen renders. */
function groupScanByStage(scan: ScreenScan): Record<PatternKey, StockRow[]> {
  const rows = [...scan.rows, ...(scan.extraRows ?? [])];
  const stages: Record<PatternKey, StockRow[]> = {
    forming: [],
    breakouts: [],
    climbing: [],
    "played-out": [],
  };
  for (const row of rows) {
    if (!row.stage) continue;
    stages[SCAN_STAGE_TO_PATTERN[row.stage]].push(scanRowToStockRow(row));
  }
  return stages;
}

export function LivePatternSection({
  scan,
  scanError,
  scanLoadingMessage,
  quotes,
  lastUpdate,
  watchlistSymbols = [],
  onAddToWatchlist,
  onOpenBreakouts,
}: LivePatternSectionProps) {
  const [active, setActive] = useState<PatternKey>("forming");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<Record<PatternKey, BreakoutState | "all">>({
    forming: "all", breakouts: "all", climbing: "all", "played-out": "all",
  });
  const activeStateFilter = stateFilter[active];
  const [sortBy, setSortBy] = useState<Record<PatternKey, string>>(DEFAULT_SORT_BY);
  const [sortDescending, setSortDescending] = useState(true);
  const [showFullFeed, setShowFullFeed] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [showSetupMenu, setShowSetupMenu] = useState(false);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [setupFilter, setSetupFilter] = useState<SetupFilter>("VCP");
  const [pickedSubgroups, setPickedSubgroups] = useState<Set<string>>(() => new Set());
  const [openPopover, setOpenPopover] = useState<"download" | "measures" | "chart" | null>(null);
  const showDownloadMenu = openPopover === "download";
  const showMeasurePanel = openPopover === "measures";
  const showChartPanel = openPopover === "chart";
  const togglePopover = (id: "download" | "measures" | "chart") =>
    setOpenPopover((current) => (current === id ? null : id));
  const closePopovers = () => setOpenPopover(null);
  useEffect(() => {
    if (!openPopover && !showSetupMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenPopover(null);
      setShowSetupMenu(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-popover]")) return;
      setOpenPopover(null);
      setShowSetupMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [openPopover, showSetupMenu]);
  const [selectedMeasures, setSelectedMeasures] = useState<Record<PatternKey, string[]>>(DEFAULT_SELECTED_MEASURES);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [manualFilters, setManualFilters] = useState({
    minRs: "",
    minPivot: "",
    maxPivot: "",
    minPriceVs50Ma: "",
  });
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const liveStages = useMemo(
    () => (scan ? groupScanByStage(scan) : null),
    [scan],
  );

  const activePattern = PATTERN_ITEMS.find((item) => item.key === active) ?? PATTERN_ITEMS[0];
  const adjustedStocks: Record<PatternKey, StockRow[]> = useMemo(
    () => liveStages ?? { forming: [], breakouts: [], climbing: [], "played-out": [] },
    [liveStages],
  );
  const stagePool: Record<PatternKey, StockRow[]> = useMemo(() => {
    const filterRows = (stageRows: StockRow[]) =>
      stageRows.filter((stock) => {
        if (!passesSetupFilter(stock, setupFilter)) return false;
        const minRs = Number(manualFilters.minRs);
        const minPivot = Number(manualFilters.minPivot);
        const maxPivot = Number(manualFilters.maxPivot);
        const minPriceVs50Ma = Number(manualFilters.minPriceVs50Ma);
        if (manualFilters.minRs && Number.isFinite(minRs) && stock.rs < minRs) return false;
        if (manualFilters.minPivot && Number.isFinite(minPivot) && stock.pivot < minPivot) return false;
        if (manualFilters.maxPivot && Number.isFinite(maxPivot) && stock.pivot > maxPivot) return false;
        if (
          manualFilters.minPriceVs50Ma &&
          Number.isFinite(minPriceVs50Ma) &&
          (stock.priceVs50Ma ?? Number.NEGATIVE_INFINITY) < minPriceVs50Ma
        ) {
          return false;
        }
        return true;
      });
    const rowsByStage: Record<PatternKey, StockRow[]> = {
      forming: filterRows(adjustedStocks.forming),
      breakouts: filterRows(adjustedStocks.breakouts),
      climbing: filterRows(adjustedStocks.climbing),
      "played-out": filterRows(adjustedStocks["played-out"]),
    };

    return rowsByStage;
  }, [adjustedStocks, manualFilters, setupFilter]);

  // Pool the industry pickers count from: the stage after every other filter,
  // but before the industry pick itself (mirrors the source's _indPool).
  const industryPool = useMemo(
    () => stagePool[active].map((stock) => ({ industry: getIndustry(stock), subgroup: getSubgroup(stock) })),
    [active, stagePool],
  );
  const industryGroupMap = useMemo(() => {
    const everyRow = (Object.keys(stagePool) as PatternKey[]).flatMap((key) => stagePool[key]);
    return buildGroupMap(everyRow.map((stock) => ({ industry: getIndustry(stock), subgroup: getSubgroup(stock) })));
  }, [stagePool]);

  const filteredStocks: Record<PatternKey, StockRow[]> = useMemo(() => {
    if (!pickedSubgroups.size) return stagePool;
    const apply = (stageRows: StockRow[]) => stageRows.filter((stock) => pickedSubgroups.has(getSubgroup(stock)));
    return {
      forming: apply(stagePool.forming),
      breakouts: apply(stagePool.breakouts),
      climbing: apply(stagePool.climbing),
      "played-out": apply(stagePool["played-out"]),
    };
  }, [pickedSubgroups, stagePool]);
  const historySymbols = useMemo(
    () => filteredStocks[active].filter((stock) => !stock.locked).map((stock) => tickerFromSymbol(stock.symbol)),
    [active, filteredStocks],
  );
  const dailyCandles = useDailyCandles(historySymbols, HISTORY_CANDLES);
  const stateCounts = useMemo(() => {
    const counts = new Map<BreakoutState, number>();
    for (const stock of filteredStocks[active]) {
      const state = getBreakoutState(stock, active);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return counts;
  }, [active, filteredStocks]);
  const searchedRows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const stageRows = activeStateFilter === "all"
      ? filteredStocks[active]
      : filteredStocks[active].filter((stock) => getBreakoutState(stock, active) === activeStateFilter);
    const matchingRows = trimmed
      ? stageRows.filter((stock) => getSearchText(stock).includes(trimmed))
      : stageRows;
    return sortRows(matchingRows, sortBy[active], sortDescending);
  }, [active, activeStateFilter, filteredStocks, query, sortBy, sortDescending]);
  const rows = searchedRows;
  const dashboardBreadth = useMemo(
    () => movingAverageBreadth(scan?.marketRows ?? scan?.rows ?? [], "vs50").percent,
    [scan],
  );
  const buyingStatuses = useMemo(
    () => new Map(rows.map((stock) => [stock.syntheticId ?? stock.symbol, dashboardBuyingStatus(stock, dashboardBreadth)])),
    [dashboardBreadth, rows],
  );
  /**
   * Most rows in "Forming" are Avoid (a stock check fails) — on a 36-row stage
   * that buries the 0-5 that are actually actionable today. Default to hiding
   * them; a toggle reveals the full list.
   */
  const [hideAvoid, setHideAvoid] = useState(true);
  const visibleRows = useMemo(() => {
    if (!hideAvoid) return rows;
    return rows.filter((stock) => buyingStatuses.get(stock.syntheticId ?? stock.symbol)?.key !== "avoid");
  }, [rows, hideAvoid, buyingStatuses]);
  const hiddenAvoidCount = rows.length - visibleRows.length;
  const playedSummary = useMemo(() => {
    const results = filteredStocks["played-out"]
      .map((stock) => stock.resultPercent)
      .filter((value): value is number => value != null);
    if (!results.length) return null;
    const wins = results.filter((value) => value > 0);
    const losses = results.filter((value) => value <= 0);
    const average = (values: number[]) =>
      values.length ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10 : 0;
    return {
      count: results.length,
      winners: wins.length,
      winRate: Math.round((wins.length / results.length) * 100),
      avgWin: average(wins),
      avgLoss: average(losses),
    };
  }, [filteredStocks]);
  const activeCount = filteredStocks[active].length;
  const shownCount = rows.length;
  const activeSortBy = sortBy[active];
  const selectedSetup = SETUP_FILTERS.find((option) => option.label === setupFilter) ?? SETUP_FILTERS[0];
  const watchlistSet = useMemo(() => new Set(watchlistSymbols.map((symbol) => symbol.toUpperCase())), [watchlistSymbols]);

  // Market-wide, so it deliberately ignores the selected screen and every
  // other filter on this page — it counts what broke out across the market.
  const breakoutFeed = useBreakoutFeed();
  const marketWide = latestSession(breakoutFeed);
  // The feed follows the selected screen, like the stage counts beside it.
  const screenFeed = useMemo(
    () =>
      (scan?.feed ?? [])
        .filter((event) => event.screens.includes(setupFilter))
        .sort((a, b) => FEED_ORDER.indexOf(a.type) - FEED_ORDER.indexOf(b.type) || a.name.localeCompare(b.name)),
    [scan, setupFilter],
  );

  const copyRows = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(rows));
      setCopyStatus(`Copied ${rows.length} rows`);
    } catch (error) {
      setCopyStatus(error instanceof DOMException ? "Copy blocked; download CSV" : "Copy failed");
    }
    closePopovers();
    window.setTimeout(() => setCopyStatus(null), 2200);
  };

  const copySymbols = async () => {
    try {
      await navigator.clipboard.writeText(rows.map((row) => row.symbol).join(",\n"));
      setCopyStatus(`Copied ${rows.length} symbols`);
    } catch (error) {
      setCopyStatus(error instanceof DOMException ? "Copy blocked; download CSV" : "Copy failed");
    }
    closePopovers();
    window.setTimeout(() => setCopyStatus(null), 2200);
  };

  const downloadRows = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active}-stocks.csv`;
    link.click();
    URL.revokeObjectURL(url);
    closePopovers();
  };

  return (
    <section className="space-y-7">
      {!scan && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {scanError ? "Screen data unavailable. No candidates can be shown until the scan succeeds." : scanLoadingMessage ?? "Loading screen data. No candidates shown yet."}
        </p>
      )}
      {scan && scanError && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Scan refresh failed. The displayed candidates may be stale.
        </p>
      )}
      {scan && (
        <MarketGateBanner
          breadth={dashboardBreadth}
          healthy={dashboardBreadth != null && dashboardBreadth >= HEALTHY_BREADTH_PERCENT}
          compact
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-foreground">Screen</span>
          <div className="relative" data-popover>
            <button
              id="setup-filter"
              type="button"
              aria-haspopup="menu"
              aria-expanded={showSetupMenu}
              onClick={() => setShowSetupMenu((show) => !show)}
              className="inline-flex min-w-[132px] items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold shadow-sm outline-none"
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-[#178d52]" aria-hidden>{selectedSetup.icon}</span>
                <span>{selectedSetup.label}</span>
              </span>
              <span className="text-xs text-slate-400" aria-hidden>▾</span>
            </button>
            {showSetupMenu && (
              <div
                role="menu"
                aria-labelledby="setup-filter"
                className="absolute left-0 top-[calc(100%+0.55rem)] z-30 w-[270px] rounded-2xl border border-slate-200 bg-white p-2 text-sm shadow-2xl"
              >
                <div className="px-4 pb-2 pt-3 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  Core and specialist setups
                </div>
                {SETUP_FILTERS.map((setup) => {
                  const selected = setup.label === setupFilter;
                  return (
                    <button
                      key={setup.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setSetupFilter(setup.label);
                        setShowSetupMenu(false);
                      }}
                      title={setup.description}
                      className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left font-black transition ${
                        selected ? "bg-[#dff1e8] text-foreground" : "text-foreground hover:bg-slate-50"
                      }`}
                    >
                      <span className="inline-flex items-center gap-3">
                        <span className={selected ? "text-[#178d52]" : "text-slate-500"} aria-hidden>
                          {setup.icon}
                        </span>
                        <span>
                          <span className="block">{setup.label}</span>
                          <span className="mt-0.5 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{setup.category}</span>
                        </span>
                      </span>
                      <span className="text-slate-400" aria-hidden>›</span>
                    </button>
                  );
                })}
                <div className="px-4 pb-2 pt-3 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  Combine
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSetupMenu(false);
                    setShowFiltersPanel(true);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left font-black text-foreground hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="text-slate-500" aria-hidden>▧</span>
                    <span>Multiple screens</span>
                  </span>
                  <span className="text-slate-400" aria-hidden>›</span>
                </button>
                <div className="px-4 pb-2 pt-3 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  Create
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSetupMenu(false);
                    setShowFiltersPanel(true);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left font-black text-foreground hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="text-slate-500" aria-hidden>⊕</span>
                    <span>Create your own screen</span>
                  </span>
                  <span className="text-slate-400" aria-hidden>›</span>
                </button>
              </div>
            )}
          </div>
          <a href="/backtest" title="Ten-year backtest of buying this screen's breakouts on their own, 1% risk a trade: 8% stop, exit on a close under the 50-day average, only while 50%+ of stocks are above their 50-day average, costs included. Trading Blue sky and Multi-year together with 2% risk and a 35% breadth gate made about 46% a year. Today's stock list, so delisted stocks are missing." className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 hover:border-emerald-500 hover:text-emerald-700">
            10-yr test: {SETUP_EVIDENCE[setupFilter]}
          </a>
          <button
            type="button"
            onClick={() => setShowFiltersPanel((show) => !show)}
            className="rounded-xl bg-[#178d52] px-4 py-2.5 text-sm font-black text-white shadow-sm"
          >
            Filters ⚙
          </button>
          <IndustryFilterPopovers
            idPrefix="lv"
            pool={industryPool}
            groupMap={industryGroupMap}
            picked={pickedSubgroups}
            onChange={setPickedSubgroups}
            allLabel={`All ${industryPool.length} in this stage`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {marketWide && marketWide.count > 0 && (
            <button
              type="button"
              id="bo-banner"
              onClick={() => onOpenBreakouts?.()}
              title={`Breakouts on ${formatSessionLabel(marketWide.day)} across the whole market`}
              className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[9px] border border-[#178d52] bg-[#178d52] px-[13px] py-[7px] text-[12.5px] font-bold text-white transition hover:shadow-md"
            >
              <span className="inline-flex flex-none" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                  <path d="M3 17l6-6 4 4 8-8" />
                  <path d="M14 7h7v7" />
                </svg>
              </span>
              <span>{marketWide.count} broke out market-wide</span>
              <span className="ml-px font-bold opacity-75" aria-hidden>›</span>
            </button>
          )}
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-up" />
            <span>Updated • {lastUpdate ? formatUpdateDate(lastUpdate) : formatUpdateDate(null)}</span>
          </div>
        </div>
      </div>

      {showFiltersPanel && (
        <div className="rounded-2xl border border-[#cbe9d8] bg-[#f4fbf7] p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-black text-foreground">Filters</div>
              <p className="mt-1 text-xs text-muted">
                Narrow the current screen without changing the underlying BananaPatterns-style stage criteria.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setManualFilters({
                  minRs: "",
                  minPivot: "",
                  maxPivot: "",
                  minPriceVs50Ma: "",
                })
              }
              className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-black text-[#16894f]"
            >
              Reset filters
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-black text-slate-500">
              Minimum RS rating
              <input
                type="number"
                min="1"
                max="99"
                value={manualFilters.minRs}
                onChange={(event) => setManualFilters((current) => ({ ...current, minRs: event.target.value }))}
                placeholder="Any"
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 font-semibold outline-none"
              />
            </label>
            <label className="text-xs font-black text-slate-500">
              Min now vs pivot (%)
              <input
                type="number"
                value={manualFilters.minPivot}
                onChange={(event) => setManualFilters((current) => ({ ...current, minPivot: event.target.value }))}
                placeholder="Any"
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 font-semibold outline-none"
              />
            </label>
            <label className="text-xs font-black text-slate-500">
              Max now vs pivot (%)
              <input
                type="number"
                value={manualFilters.maxPivot}
                onChange={(event) => setManualFilters((current) => ({ ...current, maxPivot: event.target.value }))}
                placeholder="Any"
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 font-semibold outline-none"
              />
            </label>
            <label className="text-xs font-black text-slate-500">
              Min price vs 50-MA
              <input
                type="number"
                value={manualFilters.minPriceVs50Ma}
                onChange={(event) => setManualFilters((current) => ({ ...current, minPriceVs50Ma: event.target.value }))}
                placeholder="Any"
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 font-semibold outline-none"
              />
            </label>
          </div>
        </div>
      )}

      <div className="rounded-[18px] border border-border bg-white p-6 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
        <h2 className="text-3xl font-black tracking-[-0.04em] text-foreground">
          {getStageHeadline(active, activeCount)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Every setup this screen finds, at the stage it has reached — tap a stage to see the names.
        </p>

        <div className="mt-4 grid items-stretch gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="grid grid-cols-2 gap-[10px]">
              {PATTERN_ITEMS.map((item) => {
                const selected = item.key === active;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActive(item.key)}
                    className={`min-h-[132px] rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? "border-[#14945a] bg-[#e7f6ee] shadow-[inset_0_0_0_1px_rgba(20,148,90,0.25)]"
                        : "border-border bg-white hover:border-[#14945a]/60 hover:bg-[#fbfdfb]"
                    }`}
                  >
                    <div className="text-right text-xs font-bold text-[#16894f]">
                      tap to view ›
                    </div>
                    <div className="mt-5 text-3xl font-black tracking-[-0.06em]">
                      {filteredStocks[item.key].length}
                    </div>
                    <div className="font-black leading-tight">{item.label}</div>
                    <div className="mt-1 text-xs italic text-muted">{item.detail}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-[#f7f9fa] p-4">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-3 text-sm font-black text-foreground">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden>↺</span>
                <span>What changed since last close?</span>
              </span>
              {scan?.feedDay && <span className="text-xs font-bold text-muted">{formatSessionLabel(scan.feedDay)}</span>}
            </div>

            <div className="mt-3 space-y-2">
              {screenFeed.length === 0 ? (
                <p className="text-sm text-muted">
                  {scan ? `Nothing changed for ${selectedSetup.label} names on the last session.` : "Waiting for the market scan."}
                </p>
              ) : (showFullFeed ? screenFeed : screenFeed.slice(0, 3)).map((event) => (
                <p key={`${event.type}-${event.symbol}-${event.breakoutTimestamp ?? ""}`} className="rounded-xl border border-border bg-white p-3 text-sm leading-6">
                  <span className="font-black">{event.name}</span> {describeFeedEvent(event)}
                </p>
              ))}
            </div>

            {screenFeed.length > 3 && (
              <button
                type="button"
                onClick={() => setShowFullFeed((show) => !show)}
                className="mt-4 text-sm font-black text-[#16894f]"
              >
                {showFullFeed ? "Show less ↑" : `Show the full feed (${screenFeed.length}) ›`}
              </button>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="text-sm text-muted">
            Eligible equities in the configured universe, based on the latest available scan ·{" "}
            <button
              type="button"
              onClick={() => setShowMethod((show) => !show)}
              className="font-black text-[#16894f]"
            >
              how we find these →
            </button>
          </p>
          <button
            type="button"
            onClick={() => setShowSummary((show) => !show)}
            className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-black text-[#16894f] shadow-sm transition-colors hover:border-accent"
          >
            Setup summary ›
          </button>
        </div>
        {showMethod && (
          <div id="method" className="mt-4 grid gap-3 rounded-2xl border border-[#cbe9d8] bg-[#f4fbf7] p-4 text-sm text-slate-700 md:grid-cols-4">
            <div>
              <div className="font-black text-foreground">1. Forming</div>
              <p className="mt-1">A base starts at a peak and needs 2+ weeks. Its pivot is the highest close since — a high that pokes above it and closes back under is a squat. Screened on today&apos;s facts.</p>
            </div>
            <div>
              <div className="font-black text-foreground">2. Fresh breakouts</div>
              <p className="mt-1">First close above the pivot, within 5 sessions. Screened on the breakout day&apos;s facts. Falling back inside within 10 sessions, without clearing the base&apos;s high, makes it a failed poke instead.</p>
            </div>
            <div>
              <div className="font-black text-foreground">3. Climbing</div>
              <p className="mt-1">Breakouts 5+ sessions old with no close 8% under the breakout close and no close below the 50-day average since.</p>
            </div>
            <div>
              <div className="font-black text-foreground">4. Played out</div>
              <p className="mt-1">This year&apos;s breakouts that hit the 8% stop or closed below the 50-day average, with the real exit date and close-to-close result.</p>
            </div>
          </div>
        )}
        {showSummary && (
          <div className="mt-4 rounded-2xl border border-border bg-white p-4 text-sm text-muted">
            <h3 className="font-black text-foreground">Setup summary</h3>
            <p className="mt-3">Fresh breakouts: {filteredStocks.breakouts.length} / Climbing: {filteredStocks.climbing.length} / Played out: {filteredStocks["played-out"].length}</p>
            {playedSummary && (
              <p className="mt-2">
                Of the {playedSummary.count} played-out breakouts, {playedSummary.winners} ended in profit ({playedSummary.winRate}%),
                averaging {formatPatternPercent(playedSummary.avgWin)} on winners and {formatPatternPercent(playedSummary.avgLoss)} on losers.
              </p>
            )}
            <p className="mt-2 text-xs">
              Close-to-close from the breakout close to the exit close, before costs and slippage, with no position sizing. Breakouts still running are not included. A record of what happened, not a promise.
            </p>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
            <h3 className="text-2xl font-black tracking-[-0.04em]">{activePattern.title}</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-black text-slate-500">
              {activeCount}
            </span>
            {(query.trim() || activeStateFilter !== "all") && (
              <span className="rounded-full bg-[#e7f6ee] px-2.5 py-1 text-xs font-bold text-[#16894f]">
                {shownCount} shown
              </span>
            )}
            <div className="relative" data-popover>
              <button
                type="button"
                onClick={() => togglePopover("download")}
                className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-muted shadow-sm"
              >
                {copyStatus ?? "↓ Download / Copy"}
              </button>
              {showDownloadMenu && (
                <div className="absolute left-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-white text-sm shadow-xl">
                  <button type="button" onClick={copySymbols} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                    Copy symbols
                  </button>
                  <button type="button" onClick={copyRows} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                    Copy table as CSV
                  </button>
                  <button type="button" onClick={downloadRows} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                    Download CSV
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a stock"
              className="h-10 w-36 rounded-xl border border-border bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`rounded-xl border px-3 py-2 text-sm shadow-sm ${
                viewMode === "cards" ? "border-[#16894f] bg-[#e7f6ee] font-black text-[#16894f]" : "border-border bg-white text-muted"
              }`}
            >
              ▦ Chart cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`rounded-xl px-3 py-2 text-sm shadow-sm ${
                viewMode === "list" ? "bg-[#16894f] font-black text-white" : "border border-border bg-white text-muted"
              }`}
            >
              ☰ Data table
            </button>
            <div className="relative" data-popover>
              <button
                type="button"
                onClick={() => togglePopover("measures")}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-muted shadow-sm"
              >
                ◉ Measures: {selectedMeasures[active].length}
              </button>
              {showMeasurePanel && (
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-white p-3 text-sm shadow-xl">
                  <div className="mb-2 font-black text-foreground">Choose measures</div>
                  <div className="space-y-2">
                    {SORT_OPTIONS[active].map((measure) => (
                      <label key={measure} className="flex items-center gap-2 text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedMeasures[active].includes(measure)}
                          onChange={(event) => {
                            setSelectedMeasures((current) => {
                              const next = event.target.checked
                                ? [...current[active], measure]
                                : current[active].filter((item) => item !== measure);
                              return {
                                ...current,
                                [active]: next.length ? next : [measure],
                              };
                            });
                          }}
                        />
                        {measure}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="relative" data-popover>
              <button
                type="button"
                onClick={() => togglePopover("chart")}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-muted shadow-sm"
              >
                ◉ Chart: daily
              </button>
              {showChartPanel && (
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-white p-3 text-sm shadow-xl">
                  <div className="mb-2 font-black text-foreground">Chart settings</div>
                  <label className="flex items-center gap-2 py-1 text-slate-600">
                    <input
                      type="checkbox"
                      checked={chartSettings.showVolume}
                      onChange={(event) => setChartSettings((current) => ({ ...current, showVolume: event.target.checked }))}
                    />
                    Show volume
                  </label>
                  <label className="flex items-center gap-2 py-1 text-slate-600">
                    <input
                      type="checkbox"
                      checked={chartSettings.showPivot}
                      onChange={(event) => setChartSettings((current) => ({ ...current, showPivot: event.target.checked }))}
                    />
                    Show pivot line
                  </label>
                  <label className="flex items-center gap-2 py-1 text-slate-600">
                    <input
                      type="checkbox"
                      checked={chartSettings.showMovingAverage}
                      onChange={(event) => setChartSettings((current) => ({ ...current, showMovingAverage: event.target.checked }))}
                    />
                    Show trailing line
                  </label>
                  <label className="mt-2 block text-slate-600">
                    Trailing line
                    <select
                      value={chartSettings.trailingLine}
                      onChange={(event) =>
                        setChartSettings((current) => ({
                          ...current,
                          trailingLine: event.target.value,
                          showMovingAverage: event.target.value !== "No trailing line",
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 outline-none"
                    >
                      {TRAILING_LINE_OPTIONS.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 block text-slate-600">
                    Candles
                    <select
                      value={chartSettings.candleCount}
                      onChange={(event) => setChartSettings((current) => ({ ...current, candleCount: Number(event.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 outline-none"
                    >
                      <option value={28}>28</option>
                      <option value={56}>56</option>
                      <option value={80}>80</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              Sort
              <select
                value={SORT_VALUE_BY_LABEL[activeSortBy] ?? activeSortBy}
                onChange={(event) =>
                  event.target.value === "__custom"
                    ? setOpenPopover("measures")
                    : setSortBy((current) => ({
                        ...current,
                        [active]: SORT_LABEL_BY_VALUE[event.target.value] ?? event.target.value,
                      }))
                }
                className="h-10 rounded-xl border border-border bg-white px-3 text-sm font-bold text-foreground outline-none"
              >
                {!SORT_OPTIONS[active].includes(activeSortBy) && <option value={activeSortBy}>{activeSortBy}</option>}
                {SORT_OPTIONS[active].map((option) => (
                  <option key={option} value={SORT_VALUE_BY_LABEL[option] ?? option}>{option}</option>
                ))}
                <option value="──────────" disabled>──────────</option>
                <option value="__custom">Customise this list…</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSortDescending((descending) => !descending)}
              className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-muted shadow-sm"
              aria-label={sortDescending ? "Sorting largest first" : "Sorting smallest first"}
            >
              {sortDescending ? "↓" : "↑"}
            </button>
          </div>
        </div>

        <p className="max-w-3xl text-sm leading-6 text-muted">{activePattern.description}</p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-[#e7f5ee] px-2.5 py-1 text-[#136b40]">
            {selectedSetup.label}: {selectedSetup.description}
          </span>
          <StyleTag horizon={SETUP_HORIZON[setupFilter]} />
          {SOURCE_SCREEN_CRITERIA[setupFilter].map((criterion) => (
            <span key={criterion} className="rounded-full bg-slate-100 px-2.5 py-1">
              {criterion}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Stage rules:</span>
          {STAGE_RULES[active].map((rule) => (
            <span key={rule} className="rounded-full bg-slate-100 px-2.5 py-1">
              {rule}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Breakout state">
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Breakout state</span>
          {(["all", ...STATES_BY_STAGE[active]] as const).map((state) => {
            const selected = activeStateFilter === state;
            const count = state === "all" ? activeCount : stateCounts.get(state) ?? 0;
            const info = state === "all" ? null : BREAKOUT_STATES[state];
            return (
              <button
                key={state}
                type="button"
                aria-pressed={selected}
                title={info?.rule ?? "Every stock in this stage"}
                disabled={!selected && count === 0}
                onClick={() => setStateFilter((current) => ({ ...current, [active]: state }))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected
                    ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {info && <span className={`h-2 w-2 rounded-full ${STATE_DOT_CLASS[info.tone]}`} aria-hidden />}
                {info?.label ?? "All"}
                <span className={`font-mono text-[11px] ${selected ? "text-white opacity-75" : "text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white">
            <EmptyState tone="search" title="No matches">No stocks match the current stage, breakout state and search.</EmptyState>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white">
            <EmptyState tone="search" title="All matches are Avoid">
              {hiddenAvoidCount} stock{hiddenAvoidCount === 1 ? "" : "s"} matched but every one fails a check.{" "}
              <button type="button" onClick={() => setHideAvoid(false)} className="font-black text-emerald-700 underline">
                Show them anyway
              </button>
            </EmptyState>
          </div>
        ) : viewMode === "cards" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleRows.map((stock, index) => {
              const quote = getQuoteForStock(quotes, stock.symbol);
              const ticker = tickerFromSymbol(stock.symbol);
              const history = dailyCandles[stock.symbol] ?? dailyCandles[ticker];
              if (!history || history.length < 2) {
                return (
                  <article key={stock.syntheticId ?? stock.symbol} className="rounded-2xl border border-border bg-white p-4">
                    <p className="font-black">{stock.name} · {ticker}</p>
                    <p className="mt-2 text-sm text-muted">Daily chart unavailable; no chart is inferred from quotes.</p>
                  </article>
                );
              }
              const price = quote?.ltp ?? stock.price;
              const changePercent = quote?.changePercent ?? stock.changePercent;
              const isAdded = watchlistSet.has(stock.symbol.toUpperCase()) || watchlistSet.has(ticker.toUpperCase());
              const lastCandle = history[history.length - 1];
              const measures = getCardMeasures(stock, active).filter((measure) =>
                selectedMeasures[active].includes(measure.label),
              );
              const cardState = getBreakoutState(stock, active);
              const flags = getCardFlags(stock, active);
              const historyLine = getHistoryLine(stock, active, setupFilter);
              const visibleCount = Math.min(chartSettings.candleCount, MAX_VISIBLE_CARD_CANDLES, history.length);
              const candles = getChartCandles(history).slice(-visibleCount);
              const trailingValues = chartSettings.showMovingAverage
                ? trailingLineValues(history, chartSettings.trailingLine).slice(-visibleCount)
                : [];
              const pivotPrice = getPivotPrice(stock);
              const priceAreaWidth = 458;
              const chartHeight = 190;
              const volumeHeight = 30;
              const topPadding = 8;
              const pricePlotHeight = chartHeight - volumeHeight - topPadding - 8;
              const candleSlot = priceAreaWidth / candles.length;
              const candleWidth = Math.max(4, candleSlot * 0.56);
              const prices = [
                ...candles.flatMap((candle) => [candle.high, candle.low]),
                ...(pivotPrice == null ? [] : [pivotPrice]),
                ...trailingValues.filter((value): value is number => value != null),
              ];
              const minPrice = Math.min(...prices);
              const maxPrice = Math.max(...prices);
              const priceRange = maxPrice - minPrice || 1;
              const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
              const xForCandle = (index: number) => index * candleSlot + candleSlot / 2;
              const yForPrice = (value: number) => topPadding + ((maxPrice - value) / priceRange) * pricePlotHeight;
              const maPath = getLinePath(trailingValues, xForCandle, yForPrice);
              return (
                <article
                  key={`card-${stock.syntheticId ?? `${stock.symbol}-${stock.breakoutDate ?? index}`}`}
                  className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_10px_30px_rgba(17,24,39,0.06)] transition-colors hover:border-[#16894f]/40"
                >
                  <div className="flex items-start justify-between gap-3 px-4 pt-4">
                    <div className="min-w-0">
                      <StockSymbolButton symbol={ticker} className="block max-w-full truncate text-base font-black leading-tight text-foreground">{stock.name}</StockSymbolButton>
                      <div className="mt-1 text-xs font-bold tracking-[0.08em] text-slate-400">{ticker}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        disabled={!onAddToWatchlist || isAdded}
                        onClick={() => onAddToWatchlist?.(stock.symbol)}
                        className={`rounded-full px-2.5 py-1 text-xs font-black ${
                          isAdded ? "bg-[#e7f6ee] text-[#16894f]" : "bg-slate-100 text-slate-500 hover:bg-[#e7f6ee] hover:text-[#16894f]"
                        }`}
                      >
                        {isAdded ? "Added" : "☆"}
                      </button>
                      <div className="whitespace-nowrap font-mono text-sm font-black text-slate-700">
                        {price == null ? "—" : `₹${formatPatternPrice(price)}`}
                        {changePercent == null ? null : (
                          <span className={`ml-1 text-[11px] ${toneClass(changePercent)}`}>
                            ({formatCompactPercent(changePercent)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mx-4 mt-3 rounded-xl border border-slate-200 bg-[#fbfcfd] p-3">
                    <div className="flex items-start justify-between gap-3 text-[11px] font-bold text-slate-400">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                        <span>{formatChartDate(candles[candles.length - 1]?.timestamp ?? lastUpdate)}</span>
                        <span>O {formatPatternPrice(lastCandle.open)}</span>
                        <span>H {formatPatternPrice(lastCandle.high)}</span>
                        <span>L {formatPatternPrice(lastCandle.low)}</span>
                        <span>C {formatPatternPrice(lastCandle.close)}</span>
                        <span className={toneClass(changePercent ?? 0)}>
                          {changePercent == null ? "—" : `(${formatCompactPercent(changePercent)})`}
                        </span>
                      </div>
                      <div className="text-right font-mono">
                        <div>{getVolumeLabel(quote?.volume ?? candles[candles.length - 1]?.volume)}</div>
                        <div>RS {stock.rs || "—"}</div>
                      </div>
                    </div>

                    <div className="relative mt-2 h-[190px] overflow-hidden rounded-lg bg-white">
                      <svg viewBox="0 0 501 190" className="absolute inset-0 h-full w-full" aria-label={`${ticker} setup chart`}>
                        <rect x="0" y="0" width="501" height="190" style={{ fill: "var(--chart-surface)" }} />
                        {[0.2, 0.5, 0.8].map((ratio) => (
                          <line
                            key={ratio}
                            x1="0"
                            x2={priceAreaWidth}
                            y1={topPadding + pricePlotHeight * ratio}
                            y2={topPadding + pricePlotHeight * ratio}
                            style={{ stroke: "var(--chart-grid)" }}
                            strokeWidth="1"
                          />
                        ))}
                        {chartSettings.showPivot && pivotPrice != null ? (
                          <line
                            x1="0"
                            x2={priceAreaWidth}
                            y1={yForPrice(pivotPrice)}
                            y2={yForPrice(pivotPrice)}
                            stroke="#16894f"
                            strokeDasharray="5 4"
                            strokeWidth="1.4"
                          />
                        ) : null}
                        {maPath ? (
                          <path d={maPath} fill="none" stroke="#e8a317" strokeWidth="1.6" strokeLinecap="round" />
                        ) : null}
                        {candles.map((candle, candleIndex) => {
                          const x = xForCandle(candleIndex);
                          const isUp = candle.close >= candle.open;
                          const bodyTop = yForPrice(Math.max(candle.open, candle.close));
                          const bodyBottom = yForPrice(Math.min(candle.open, candle.close));
                          const bodyHeight = Math.max(bodyBottom - bodyTop, 2);
                          const volumeBarHeight = Math.max((candle.volume / maxVolume) * (volumeHeight - 4), 3);
                          const color = isUp ? "#16894f" : "#d04444";

                          return (
                            <g key={`${candle.timestamp}-${candleIndex}`}>
                              {chartSettings.showVolume && (
                                <rect
                                  x={x - candleWidth / 2}
                                  y={chartHeight - volumeBarHeight}
                                  width={candleWidth}
                                  height={volumeBarHeight}
                                  fill={isUp ? "rgba(22,137,79,0.22)" : "rgba(208,68,68,0.18)"}
                                />
                              )}
                              <line
                                x1={x}
                                x2={x}
                                y1={yForPrice(candle.high)}
                                y2={yForPrice(candle.low)}
                                stroke={color}
                                strokeWidth="1.3"
                              />
                              <rect
                                x={x - candleWidth / 2}
                                y={bodyTop}
                                width={candleWidth}
                                height={bodyHeight}
                                rx="1.2"
                                style={{ fill: isUp ? color : "var(--chart-surface)" }}
                                stroke={color}
                                strokeWidth="1.3"
                              />
                            </g>
                          );
                        })}
                        <line x1={priceAreaWidth} x2={priceAreaWidth} y1="0" y2={chartHeight} style={{ stroke: "var(--chart-grid)" }} />
                        {[maxPrice, (maxPrice + minPrice) / 2, minPrice].map((axisPrice) => (
                          <text
                            key={axisPrice}
                            x={priceAreaWidth + 5}
                            y={yForPrice(axisPrice)}
                            dominantBaseline="middle"
                            fill="#94a3b8"
                            fontSize="10"
                            fontFamily="monospace"
                          >
                            {formatPatternPrice(axisPrice)}
                          </text>
                        ))}
                        <text x="8" y="184" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                          {formatChartDate(candles[0]?.timestamp ?? null)}
                        </text>
                        <text x="414" y="184" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                          {formatChartDate(candles[candles.length - 1]?.timestamp ?? null)}
                        </text>
                      </svg>
                    </div>
                  </div>

                  <div className="grid gap-px bg-slate-100 px-4 py-3 text-xs">
                    {measures.map((measure) => (
                      <div key={measure.label} className="flex items-center justify-between gap-3 bg-white px-2 py-2 first:rounded-t-lg last:rounded-b-lg">
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          {measure.label}

                        </span>
                        <span className="whitespace-nowrap font-mono font-black text-foreground">{measure.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                    {(stock.tags ?? []).map((tag) => (
                      <span key={tag} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold text-slate-400">
                        {tag}
                      </span>
                    ))}
                    {flags.map((flag) => (
                      <span
                        key={`${flag.icon}-${flag.label}`}
                        title={flag.tip}
                        className="cursor-help rounded-full bg-[#fff7db] px-2 py-0.5 text-[11px] font-black text-[#8a6a00]"
                      >
                        {flag.icon} {flag.label}
                      </span>
                    ))}
                  </div>
                  {historyLine && <p className="px-4 pb-3 text-xs italic text-slate-500">{historyLine}</p>}

                  <div className="flex items-center justify-end gap-3 border-t border-border bg-[#fbfcfd] px-4 py-3 text-xs">

                    <div title={BREAKOUT_STATES[cardState].rule} className={`rounded-full px-2.5 py-1 font-black ${STATE_TONE_CLASS[BREAKOUT_STATES[cardState].tone]}`}>
                      {BREAKOUT_STATES[cardState].label}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
            <div className="flex items-center gap-5">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">Results</div>
                <div className="mt-0.5 text-lg font-black text-slate-900">
                  {visibleRows.length}
                  {hiddenAvoidCount > 0 && <span className="ml-1 font-mono text-xs font-bold text-slate-400">of {rows.length}</span>}
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">Average RS</div>
                <div className="mt-0.5 font-mono text-lg font-black text-slate-900">
                  {Math.round(rows.reduce((sum, stock) => sum + stock.rs, 0) / rows.length)}
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">Buy ready</div>
                <div className="mt-0.5 font-mono text-lg font-black text-emerald-600">
                  {[...buyingStatuses.values()].filter((status) => status.key === "buy-ready").length}
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">Watch</div>
                <div className="mt-0.5 font-mono text-lg font-black text-sky-600">
                  {[...buyingStatuses.values()].filter((status) => status.key === "watch").length}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">Sorted by</div>
              <div className="mt-0.5 text-xs font-bold text-slate-700">{activeSortBy} {sortDescending ? "↓" : "↑"}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 border-b border-slate-100 bg-white px-4 py-2 text-[11px] font-semibold text-slate-500">
            <label className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-black text-slate-600">
              <input type="checkbox" checked={hideAvoid} onChange={(e) => setHideAvoid(e.target.checked)} className="h-3 w-3" />
              Hide Avoid{hiddenAvoidCount > 0 ? ` (${hiddenAvoidCount})` : ""}
            </label>
            <span className="font-black uppercase tracking-wide text-slate-400">Status</span>
            <span><b className="text-emerald-700">Buy ready:</b> every check passes</span>
            <span><b className="text-sky-700">Watch:</b> waiting only for breadth or a risk flag</span>
            <span><b className="text-amber-700">Extended:</b> past the buy zone, don&apos;t chase</span>
            <span><b className="text-slate-600">Avoid:</b> a stock check fails</span>
          </div>
          <div className="max-h-[680px] overflow-auto">
            <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-left text-xs">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[25%]" />
                <col className="w-[13%]" />
                <col className="w-[14%]" />
                {selectedMeasures[active].map((measure) => (
                  <col key={measure} className="w-[12%]" />
                ))}
                <col className="w-[9%]" />
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr className="bg-[#f7f9fa] text-[11px] uppercase tracking-[0.08em] text-slate-400 shadow-[0_1px_0_#e2e8f0]">
                  <th className="sticky left-0 z-30 bg-[#f7f9fa] px-3 py-3 text-center font-black">#</th>
                  <th className="sticky left-[59px] z-30 bg-[#f7f9fa] px-3 py-3 font-black">
                    <button
                      type="button"
                      onClick={() => {
                        if (activeSortBy === "Name") setSortDescending((descending) => !descending);
                        else setSortDescending(false);
                        setSortBy((current) => ({ ...current, [active]: "Name" }));
                      }}
                    >
                      Instrument
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right font-black">Last price / Day</th>
                  <th className="px-3 py-3 font-black">Status</th>
                  {selectedMeasures[active].map((measure) => (
                    <th key={measure} className="px-3 py-3 text-right font-black">
                      <button
                        type="button"
                        onClick={() => {
                          setSortBy((current) => ({ ...current, [active]: measure }));
                          if (activeSortBy === measure) setSortDescending((descending) => !descending);
                        }}
                        className="inline-flex items-center justify-end gap-1"
                      >
                        {measure}
                        {activeSortBy === measure && <span>{sortDescending ? "↓" : "↑"}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 bg-[#f7f9fa] px-3 py-3 text-right font-black">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((stock, index) => {
                  const quote = getQuoteForStock(quotes, stock.symbol);
                  const ticker = tickerFromSymbol(stock.symbol);
                  const price = quote?.ltp ?? stock.price;
                  const changePercent = quote?.changePercent ?? stock.changePercent;
                  const tags = stock.tags ?? [];
                  const isAdded = watchlistSet.has(stock.symbol.toUpperCase()) || watchlistSet.has(ticker.toUpperCase());
                  const buyingStatus = buyingStatuses.get(stock.syntheticId ?? stock.symbol)!;

                  return (
                    <tr
                      key={stock.syntheticId ?? `${stock.symbol}-${stock.breakoutDate ?? index}`}
                      className="group text-foreground transition-colors odd:bg-white even:bg-[#fafbfc] hover:bg-[#f0f9f4]"
                    >
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-3 text-center font-mono text-[11px] font-bold text-slate-400">
                        {String(index + 1).padStart(2, "0")}
                      </td>
                      <td className="sticky left-[59px] z-10 border-b border-slate-100 bg-inherit px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-black text-white shadow-sm">
                            {ticker.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <StockSymbolButton symbol={ticker} className="font-mono text-sm font-black tracking-tight text-slate-900">{ticker}</StockSymbolButton>
                              <BreakoutStateBadge state={getBreakoutState(stock, active)} />
                            </div>
                            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{stock.name}</div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-12">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold leading-none text-slate-400"
                            >
                              {tag}
                            </span>
                          ))}
                          {active !== "played-out" && <RiskFlagChips flags={stock.riskFlags} />}
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right">
                        <div className="whitespace-nowrap font-mono text-sm font-black text-slate-900">
                          {price == null ? "—" : `₹${formatPatternPrice(price)}`}
                        </div>
                        {changePercent == null ? null : (
                          <div className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 font-mono text-[11px] font-black ${
                            changePercent > 0 ? "bg-emerald-50 text-emerald-700" : changePercent < 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
                          }`}>{formatCompactPercent(changePercent)}</div>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <BuyingStatusBadge status={buyingStatus} />
                      </td>
                      {selectedMeasures[active].map((measure) => {
                        const value = getMeasureValue(stock, measure);
                        return (
                        <td
                          key={measure}
                          className={`border-b border-slate-100 px-3 py-3 text-right font-mono text-slate-700 ${
                            measure === "Result of the breakout (%)" && stock.resultPercent != null
                              ? stock.resultPercent >= 0
                                ? "text-up"
                                : "text-down"
                              : ""
                          }`}
                        >
                          {measure === "Relative volume (RVOL)" ? (
                            <RvolPill rvol={stock.rvol} />
                          ) : measure === "RS rating" ? (
                            <div className="ml-auto w-20">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-black text-slate-900">{value}</span>
                                <span className="text-[10.5px] text-slate-400">/99</span>
                              </div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                                <div className={`h-full rounded-full ${stock.rs >= 80 ? "bg-emerald-500" : stock.rs >= 60 ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${Math.min(100, stock.rs)}%` }} />
                              </div>
                            </div>
                          ) : measure === "Now vs pivot (%)" ? (
                            <span className={`inline-flex rounded-md px-2 py-1 font-black ${
                              stock.pivot > BUY_ZONE_PERCENT && active !== "forming" && active !== "played-out" ? "bg-amber-50 text-amber-700" : stock.pivot >= 0 ? "bg-emerald-50 text-emerald-700" : stock.pivot >= -5 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                            }`}>{value}</span>
                          ) : (
                            <span className="font-semibold">{value}</span>
                          )}
                        </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 border-b border-slate-100 bg-inherit px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!onAddToWatchlist || isAdded}
                            onClick={() => onAddToWatchlist?.(stock.symbol)}
                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black transition ${
                              isAdded
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                            }`}
                            aria-label={isAdded ? `${ticker} is in your watchlist` : `Add ${ticker} to watchlist`}
                          >
                            {isAdded ? "★ Added" : "☆ Watch"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
