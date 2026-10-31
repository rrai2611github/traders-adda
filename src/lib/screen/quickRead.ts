/**
 * The "Quick read" at the top of the stock drawer: a few plain rows built only from numbers the drawer already has.
 * No new data and no new rules; it just says the same things in one word and one line.
 */

export type QuickTone = "good" | "ok" | "bad" | "none";

export interface QuickRow {
  key: "trend" | "strength" | "priceAction" | "volume" | "nearHigh" | "risk";
  label: string;
  rating: string;
  tone: QuickTone;
  note: string;
}

export interface QuickInput {
  vs50: number | null;
  vs200: number | null;
  rs: number | null;
  paScore: number | null;
  rvol: number | null;
  /** Percent below the 52-week high, 0 or more. */
  fromHigh: number | null;
  /** Severity of each risk flag on the stock. */
  riskFlags: string[] | null;
}

const NO_DATA = { rating: "—", tone: "none" as QuickTone, note: "Not enough data yet." };

export function quickRows(input: QuickInput): QuickRow[] {
  const { vs50, vs200, rs, paScore, rvol, fromHigh, riskFlags } = input;
  const rows: QuickRow[] = [];

  if (vs50 == null) rows.push({ key: "trend", label: "Trend", ...NO_DATA });
  else if (vs50 >= 0 && (vs200 == null || vs200 >= 0)) {
    rows.push({ key: "trend", label: "Trend", rating: "Up", tone: "good", note: vs200 == null ? "Above its 50-day average." : "Above its 50-day and 200-day averages." });
  } else if (vs50 < 0 && vs200 != null && vs200 < 0) {
    rows.push({ key: "trend", label: "Trend", rating: "Down", tone: "bad", note: "Below its 50-day and 200-day averages." });
  } else {
    rows.push({ key: "trend", label: "Trend", rating: "Mixed", tone: "ok", note: vs50 >= 0 ? "Above its 50-day average but below the 200-day." : "Below its 50-day average but above the 200-day." });
  }

  if (rs == null) rows.push({ key: "strength", label: "Strength vs market", ...NO_DATA });
  else {
    const rating = rs >= 70 ? "Strong" : rs <= 30 ? "Weak" : "Average";
    rows.push({ key: "strength", label: "Strength vs market", rating, tone: rs >= 70 ? "good" : rs <= 30 ? "bad" : "ok", note: `Has done better than about ${Math.round(rs)}% of NSE stocks lately.` });
  }

  if (paScore == null) rows.push({ key: "priceAction", label: "Price action", ...NO_DATA });
  else {
    const rating = paScore >= 70 ? "Good" : paScore < 35 ? "Weak" : "Fair";
    rows.push({ key: "priceAction", label: "Price action", rating, tone: paScore >= 70 ? "good" : paScore < 35 ? "bad" : "ok", note: `Scores ${Math.round(paScore)} out of 100 on trend, momentum and volume.` });
  }

  if (rvol == null) rows.push({ key: "volume", label: "Volume", ...NO_DATA });
  else {
    const rating = rvol >= 1.5 ? "High" : rvol < 1 ? "Low" : "Normal";
    rows.push({ key: "volume", label: "Volume", rating, tone: rvol >= 1.5 ? "good" : "ok", note: `Trading ${rvol.toFixed(1)}× its usual volume.` });
  }

  if (fromHigh == null) rows.push({ key: "nearHigh", label: "Near its high", ...NO_DATA });
  else {
    const rating = fromHigh <= 5 ? "At the high" : fromHigh <= 15 ? "Close" : fromHigh <= 30 ? "Far" : "Very far";
    rows.push({ key: "nearHigh", label: "Near its high", rating, tone: fromHigh <= 15 ? "good" : fromHigh <= 30 ? "ok" : "bad", note: `${fromHigh.toFixed(1)}% below its 52-week high.` });
  }

  if (riskFlags == null) rows.push({ key: "risk", label: "Red flags", ...NO_DATA });
  else if (riskFlags.includes("high")) rows.push({ key: "risk", label: "Red flags", rating: "Yes", tone: "bad", note: "At least one serious flag. See Risk flags below." });
  else if (riskFlags.length > 0) rows.push({ key: "risk", label: "Red flags", rating: "Caution", tone: "ok", note: "Some cautions. See Risk flags below." });
  else rows.push({ key: "risk", label: "Red flags", rating: "None", tone: "good", note: "No risk flags on this stock." });

  return rows;
}

export interface YearRange {
  low: number;
  high: number;
  price: number;
  /** 0 at the 52-week low, 100 at the 52-week high. */
  position: number;
}

/** Roughly a trading year (250 sessions) of high/low plus the current price; null when there is not enough history. */
export function yearRange(candles: { high: number; low: number; close: number }[], price: number | null): YearRange | null {
  const recent = candles.slice(-250);
  if (recent.length < 20) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const candle of recent) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  const last = price ?? recent[recent.length - 1].close;
  high = Math.max(high, last);
  low = Math.min(low, last);
  if (!(high > low)) return null;
  return { low, high, price: last, position: ((last - low) / (high - low)) * 100 };
}

export interface CheckLike {
  label: string;
  pass: boolean;
}

/** "What is working" are the passed checks; "What is missing or risky" are the failed ones plus any risk flag. */
export function whyLists(checks: CheckLike[], flags: { label: string; detail: string }[] | null, limit = 5) {
  return {
    why: checks.filter((check) => check.pass).map((check) => check.label).slice(0, limit),
    risks: [...(flags ?? []).map((flag) => `${flag.label}: ${flag.detail}`), ...checks.filter((check) => !check.pass).map((check) => check.label)].slice(0, limit),
  };
}
