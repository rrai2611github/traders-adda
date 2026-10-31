/**
 * Pre-open morning brief.
 *
 * Two of the sections a typical broker brief carries cannot be sourced here:
 *
 * - GIFT Nifty has no free feed, so the opening call is *derived* from the
 *   overnight global tape and is labelled as such. It is never presented as a
 *   GIFT Nifty quote.
 * - NSE's option-chain API is bot-protected, so key levels come from the
 *   previous session's range (classic floor pivots), never from option OI.
 *
 * Everything here is pure so it can be unit-tested without network access.
 */

import type { IndexContext } from "../market/indexContext";

export type CueGroup = "india" | "asia" | "us" | "europe" | "commodity" | "rates" | "currency";

/** A single overnight/global input, already normalised by the data layer. */
export interface CueQuote {
  key: string;
  label: string;
  group: CueGroup;
  price: number;
  previousClose: number;
  changePercent: number;
  /** Prefix rendered before the price, e.g. "$". */
  prefix?: string;
  /** Suffix rendered after the price, e.g. "%" or "/bbl". */
  suffix?: string;
  /**
   * True when a rising print is a headwind for Indian equities (crude, the
   * dollar, yields, volatility), so the UI colours it red on the way up.
   */
  inverseTone?: boolean;
  /** Epoch ms of the quote. */
  asOf: number;
}

/** Previous completed session for an index, used to derive levels. */
export interface IndexSessionInput {
  key: string;
  label: string;
  close: number;
  high: number;
  low: number;
  /** Close of the session before this one; drives the change line. */
  priorClose: number;
}

export interface IndexLevels {
  key: string;
  label: string;
  close: number;
  changePercent: number;
  pivot: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  /** Rounded "support – resistance" band for the headline line. */
  zone: string;
}

export type BiasKey = "strong-up" | "mild-up" | "flat" | "mild-down" | "strong-down";

export interface BiasComponent {
  label: string;
  /** Percent move already sign-adjusted for the Indian market's point of view. */
  effect: number;
  raw: number;
  weight: number;
  note: string;
}

export interface OpeningBias {
  key: BiasKey;
  label: string;
  /** Weighted overnight move in percent, or null when no cue loaded. */
  score: number | null;
  summary: string;
  components: BiasComponent[];
}

export interface BriefCueLine {
  label: string;
  /** Price with its prefix and suffix already applied. */
  value: string;
  changePercent: number;
  /** True when a rise is a headwind, so the UI must not colour it green. */
  inverseTone: boolean;
}

export interface BriefSection {
  title: string;
  /** Short line explaining where the numbers come from. */
  source: string;
  lines: BriefCueLine[];
}

export interface MorningBriefIdea {
  symbol: string;
  name: string;
  statusLabel: string;
  rating: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
}

export interface MorningBrief {
  indexContext?: IndexContext;
  generatedAt: number;
  sessionLabel: string;
  bias: OpeningBias;
  cues: BriefSection[];
  levels: IndexLevels[];
  ideas: MorningBriefIdea[];
  /** Cue keys the data layer could not fetch, surfaced instead of hidden. */
  unavailable: string[];
}

/**
 * Weights for the derived opening call: the US close and the Asian and European tape only. A 10-year test (about 2,470 Indian
 * days) found these move the Nifty opening gap (correlation about 0.45), while crude oil and USD/INR showed no link to Nifty
 * (about 0.05 and 0.03), so they are shown as cues and sector notes but do not score the index.
 */
const BIAS_WEIGHTS: Record<string, { weight: number; invert?: boolean; note: string }> = {
  sp500: { weight: 3, note: "US close sets the overnight risk tone." },
  nasdaq: { weight: 2, note: "US tech close, the main driver for IT." },
  nikkei: { weight: 2, note: "Asia is trading while India is pre-open." },
  hangseng: { weight: 2, note: "Asia is trading while India is pre-open." },
  kospi: { weight: 1, note: "Asia is trading while India is pre-open." },
  stoxxde: { weight: 1, note: "European close." },
};

const BANDS: { min: number; key: BiasKey; label: string }[] = [
  { min: 0.5, key: "strong-up", label: "Positive start likely" },
  { min: 0.15, key: "mild-up", label: "Mildly positive start" },
  { min: -0.15, key: "flat", label: "Flat, range-bound open" },
  { min: -0.5, key: "mild-down", label: "Mildly negative start" },
  { min: -Infinity, key: "strong-down", label: "Weak start likely" },
];

const GROUP_TITLES: Record<CueGroup, string> = {
  india: "India",
  asia: "Asia now",
  us: "US overnight",
  europe: "Europe",
  commodity: "Commodities",
  rates: "Rates",
  currency: "Currency",
};

const GROUP_SOURCES: Record<CueGroup, string> = {
  india: "Previous NSE close and India VIX.",
  asia: "Live Asian index quotes.",
  us: "Last completed US session.",
  europe: "Last completed European session.",
  commodity: "Front-month futures.",
  rates: "Benchmark government bond yield.",
  currency: "Spot FX.",
};

/** Order the sections are rendered in, most decision-relevant first. */
const GROUP_ORDER: CueGroup[] = ["us", "asia", "europe", "commodity", "rates", "currency", "india"];

const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;

const numberIn = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const wholeIn = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Levels are rounded to a step traders actually quote, which widens with the index. */
export function levelStep(close: number): number {
  if (close >= 40000) return 100;
  if (close >= 10000) return 50;
  if (close >= 1000) return 25;
  return 5;
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Classic floor-trader pivots off the previous session's range. These are price
 * structure, not option open interest.
 */
export function indexLevels(session: IndexSessionInput): IndexLevels {
  const { high, low, close } = session;
  const pivot = (high + low + close) / 3;
  const range = high - low;
  const resistance1 = 2 * pivot - low;
  const support1 = 2 * pivot - high;
  const step = levelStep(close);
  return {
    key: session.key,
    label: session.label,
    close,
    changePercent: session.priorClose > 0 ? ((close - session.priorClose) / session.priorClose) * 100 : 0,
    pivot,
    support1,
    support2: pivot - range,
    resistance1,
    resistance2: pivot + range,
    zone: `${wholeIn.format(roundTo(support1, step))} – ${wholeIn.format(roundTo(resistance1, step))}`,
  };
}

/**
 * Derived opening call. This replaces the GIFT Nifty line a broker brief would
 * carry; the label and summary must always say it is derived.
 */
export function openingBias(cues: ReadonlyArray<CueQuote>): OpeningBias {
  const components: BiasComponent[] = [];
  for (const cue of cues) {
    const config = BIAS_WEIGHTS[cue.key];
    if (!config || !Number.isFinite(cue.changePercent)) continue;
    components.push({
      label: cue.label,
      raw: cue.changePercent,
      effect: config.invert ? -cue.changePercent : cue.changePercent,
      weight: config.weight,
      note: config.note,
    });
  }

  if (!components.length) {
    return {
      key: "flat",
      label: "No overnight data",
      score: null,
      summary: "No global cues loaded yet, so there is no basis for an opening call.",
      components,
    };
  }

  const weight = components.reduce((sum, item) => sum + item.weight, 0);
  const score = components.reduce((sum, item) => sum + item.effect * item.weight, 0) / weight;
  const band = BANDS.find((item) => score >= item.min)!;
  const drivers = [...components]
    .sort((a, b) => Math.abs(b.effect * b.weight) - Math.abs(a.effect * a.weight))
    .slice(0, 2)
    .map((item) => `${item.label} ${signed(item.raw)}%`)
    .join(", ");

  return {
    key: band.key,
    label: band.label,
    score,
    summary: `Derived opening bias of ${signed(score)}% from the overnight tape (${drivers}). GIFT Nifty is not available from our data sources, so this is computed, not quoted.`,
    components,
  };
}

/**
 * The opening call for the email once a GIFT Nifty quote is in hand: GIFT is the direct read on India's open, so its gap sets the
 * label and score, and the overnight global tape is quoted beside it. Without a usable quote the derived bias is returned unchanged.
 */
export function openingBiasWithGift(bias: OpeningBias, gapPercent: number | null | undefined): OpeningBias {
  if (gapPercent == null || !Number.isFinite(gapPercent)) return bias;
  const band = BANDS.find((item) => gapPercent >= item.min)!;
  const tape = bias.score;
  const against = tape != null && Math.abs(tape) > 0.15 && Math.abs(gapPercent) > 0.15 && Math.sign(tape) !== Math.sign(gapPercent);
  return {
    ...bias,
    key: band.key,
    label: band.label,
    score: gapPercent,
    summary: `GIFT Nifty is ${signed(gapPercent)}% against the last Nifty close, the most direct read on the open. The overnight global tape alone reads ${tape != null ? `${signed(tape)}%` : "n/a"}${against ? ", so India is expected to open against the global mood" : ""}.`,
  };
}

function formatCue(cue: CueQuote): BriefCueLine {
  return {
    label: cue.label,
    value: `${cue.prefix ?? ""}${numberIn.format(cue.price)}${cue.suffix ?? ""}`,
    changePercent: cue.changePercent,
    inverseTone: cue.inverseTone === true,
  };
}

/** Groups cues into the rendered sections, dropping empty groups. */
export function cueSections(cues: ReadonlyArray<CueQuote>): BriefSection[] {
  return GROUP_ORDER.map((group) => ({
    title: GROUP_TITLES[group],
    source: GROUP_SOURCES[group],
    lines: cues.filter((cue) => cue.group === group).map(formatCue),
  })).filter((section) => section.lines.length > 0);
}

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Last completed daily candle plus the one before it.
 *
 * `excludeDateKey` drops an in-progress session (`YYYY-MM-DD`, IST) so a brief
 * written before the close never derives levels from a half-formed bar.
 */
export function previousSession(
  candles: ReadonlyArray<{ t: number; high: number; low: number; close: number }>,
  options: { key: string; label: string; excludeDateKey?: string | null },
): IndexSessionInput | null {
  const usable = options.excludeDateKey
    ? candles.filter((candle) => IST_DATE.format(candle.t) !== options.excludeDateKey)
    : [...candles];
  const last = usable.at(-1);
  if (!last || !(last.close > 0) || !(last.high >= last.low)) return null;
  return {
    key: options.key,
    label: options.label,
    close: last.close,
    high: last.high,
    low: last.low,
    priorClose: usable.at(-2)?.close ?? last.close,
  };
}

export function buildMorningBrief(input: {
  generatedAt: number;
  sessionLabel: string;
  cues: ReadonlyArray<CueQuote>;
  sessions: ReadonlyArray<IndexSessionInput>;
  ideas: ReadonlyArray<MorningBriefIdea>;
  unavailable: ReadonlyArray<string>;
}): MorningBrief {
  return {
    generatedAt: input.generatedAt,
    sessionLabel: input.sessionLabel,
    bias: openingBias(input.cues),
    cues: cueSections(input.cues),
    levels: input.sessions.map(indexLevels),
    ideas: [...input.ideas],
    unavailable: [...input.unavailable],
  };
}

/** Shareable plain-text rendering, in the order the card presents it. */
export function formatMorningBriefText(brief: MorningBrief): string {
  const parts: string[] = [`📊 3 Things That Will Decide the Market Today — ${brief.sessionLabel}`, ""];

  parts.push("🔴 Opening bias (derived, not GIFT Nifty)");
  parts.push(brief.bias.label + (brief.bias.score != null ? ` · ${signed(brief.bias.score)}%` : ""));
  parts.push(brief.bias.summary, "");

  parts.push("🌍 Macro / global cues");
  for (const section of brief.cues) {
    const rendered = section.lines.map((line) => `${line.label} ${line.value} (${signed(line.changePercent)}%)`);
    parts.push(`${section.title}: ${rendered.join(" · ")}`);
  }
  parts.push("");

  parts.push("📈 Key levels (previous-session pivots, not option OI)");
  for (const level of brief.levels) {
    parts.push(`👉 ${level.label} ${level.zone} zone · pivot ${wholeIn.format(level.pivot)}`);
  }

  if (brief.ideas.length) {
    parts.push("", "✅ Today's qualified ideas (from this workstation's scanners)");
    brief.ideas.forEach((idea, index) => {
      const plan = idea.entry != null && idea.stop != null && idea.target != null
        ? ` · entry ${numberIn.format(idea.entry)} / stop ${numberIn.format(idea.stop)} / target ${numberIn.format(idea.target)}`
        : "";
      parts.push(`${index + 1}. ${idea.symbol} — ${idea.statusLabel} ${idea.rating}%${plan}`);
    });
  }

  if (brief.unavailable.length) {
    parts.push("", `⚠ Unavailable: ${brief.unavailable.join(", ")}`);
  }

  parts.push("", "Scanner output, not investment advice.");
  return parts.join("\n");
}
