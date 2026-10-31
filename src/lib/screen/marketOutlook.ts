import type { CueQuote, IndexLevels, OpeningBias } from "./morningBrief";

/**
 * Pre-open market and index outlook: Bullish / Bearish / Neutral, built from GIFT Nifty,
 * the overnight global tape, completed-session trend and breadth. Every input is a
 * point score the email shows, so the call can be audited; it is a weighted reading of
 * conditions, not a forecast or a probability.
 */

export interface GiftNiftyQuote {
  price: number;
  /** Move against GIFT Nifty's own previous settlement, in percent. */
  changePercent: number;
  changePoints: number;
  asOf: number;
  source: string;
}

export type OutlookLabel = "Bullish" | "Bearish" | "Neutral";
export type Conviction = "High" | "Medium" | "Low";

export interface OutlookDriver {
  label: string;
  /** Short value text, e.g. "+0.10% vs Nifty close". */
  detail: string;
  /** Contribution to the score, −2 … +2. */
  points: number;
}

export type GiftVerdict = "confirms" | "diverges" | "flat-vs-move" | "leads" | "flat";

export interface GiftComparison {
  quote: GiftNiftyQuote;
  niftyClose: number;
  /** GIFT minus the last completed Nifty close. */
  gapPoints: number;
  gapPercent: number;
  /** Weighted overnight global tone in percent (the opening bias score), or null. */
  tonePercent: number | null;
  verdict: GiftVerdict;
  text: string;
  /** Where the GIFT-implied open sits against the pivot levels. */
  levelNote: string | null;
}

export interface IndexOutlook {
  key: string;
  name: string;
  label: OutlookLabel;
  score: number;
  conviction: Conviction;
  drivers: OutlookDriver[];
  /** One-line reason from the two strongest drivers. */
  summary: string;
}

export interface MarketOutlook {
  label: OutlookLabel;
  score: number;
  /** Largest possible score, so a meter can be drawn. */
  maxScore: number;
  conviction: Conviction;
  drivers: OutlookDriver[];
  summary: string;
  gift: GiftComparison | null;
  indexes: IndexOutlook[];
}

export interface OutlookIndexInput {
  dailyTrend?: string | null;
  weeklyTrend?: string | null;
  /** Share of the index's stocks above their 50-day average, in percent. */
  breadth50?: number | null;
}

export interface OutlookInput {
  gift: GiftNiftyQuote | null;
  bias: OpeningBias;
  cues: ReadonlyArray<CueQuote>;
  levels: ReadonlyArray<IndexLevels>;
  /** Keyed NIFTY50, BANKNIFTY, NIFTYIT, NIFTYMIDCAP. */
  indexes: Record<string, OutlookIndexInput | undefined>;
}

const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
const whole = (value: number) => Math.round(value).toLocaleString("en-IN");

/** ±1 beyond the first threshold, ±2 beyond the second. */
const step = (value: number, first: number, second: number): number =>
  value >= second ? 2 : value >= first ? 1 : value <= -second ? -2 : value <= -first ? -1 : 0;

const cue = (cues: ReadonlyArray<CueQuote>, key: string) => cues.find((c) => c.key === key && Number.isFinite(c.changePercent));

const trendPoints = (trend: string | null | undefined) => (trend === "Constructive" ? 1 : trend === "Weak" ? -1 : 0);

const breadthPoints = (b: number) => (b >= 75 ? 2 : b >= 60 ? 1 : b <= 25 ? -2 : b <= 40 ? -1 : 0);

function conviction(score: number, high: number, medium: number): Conviction {
  const size = Math.abs(score);
  return size >= high ? "High" : size >= medium ? "Medium" : "Low";
}

const labelFor = (score: number, threshold: number): OutlookLabel =>
  score >= threshold ? "Bullish" : score <= -threshold ? "Bearish" : "Neutral";

function summarise(label: OutlookLabel, drivers: OutlookDriver[]): string {
  const top = [...drivers].filter((d) => d.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 2);
  if (!top.length) return `${label}: no input is pushing either way.`;
  return `${label}: ${top.map((d) => `${d.label} ${d.detail}`).join("; ")}.`;
}

/** Compares GIFT Nifty's gap with the overnight global tone and places the implied open against the pivots. */
export function compareGift(
  gift: GiftNiftyQuote,
  niftyClose: number,
  tonePercent: number | null,
  nifty: IndexLevels | undefined,
): GiftComparison {
  const gapPoints = gift.price - niftyClose;
  const gapPercent = (gapPoints / niftyClose) * 100;
  const giftBig = Math.abs(gapPercent) >= 0.15;
  const toneBig = tonePercent != null && Math.abs(tonePercent) >= 0.3;
  const toneWord = tonePercent == null ? "" : tonePercent > 0 ? "positive" : "negative";
  let verdict: GiftVerdict;
  let text: string;
  if (giftBig && toneBig && Math.sign(gapPercent) === Math.sign(tonePercent!)) {
    verdict = "confirms";
    text = `GIFT Nifty (${signed(gapPercent)}% vs the Nifty close) is in line with the ${toneWord} global tone (${signed(tonePercent!)}%).`;
  } else if (giftBig && toneBig) {
    verdict = "diverges";
    text = `GIFT Nifty is pointing ${gapPercent > 0 ? "up" : "down"} (${signed(gapPercent)}%) against a ${toneWord} global tone (${signed(tonePercent!)}%): India-specific factors are outweighing the global move.`;
  } else if (!giftBig && toneBig) {
    verdict = "flat-vs-move";
    text = `GIFT Nifty is flat (${signed(gapPercent)}%) while the global tone is ${toneWord} (${signed(tonePercent!)}%): India is not following the global move yet, so treat it as a risk, not a certainty.`;
  } else if (giftBig) {
    verdict = "leads";
    text = `GIFT Nifty is ${gapPercent > 0 ? "up" : "down"} ${signed(gapPercent)}% on India-specific factors; the global tone is neutral${tonePercent != null ? ` (${signed(tonePercent)}%)` : ""}.`;
  } else {
    verdict = "flat";
    text = `GIFT Nifty (${signed(gapPercent)}%) and the global tone${tonePercent != null ? ` (${signed(tonePercent)}%)` : ""} are both flat: a range-bound open is likely.`;
  }

  let levelNote: string | null = null;
  if (nifty) {
    const p = gift.price;
    const where = p > nifty.resistance2 ? `above R2 ${whole(nifty.resistance2)}`
      : p > nifty.resistance1 ? `between R1 ${whole(nifty.resistance1)} and R2 ${whole(nifty.resistance2)}`
        : p > nifty.pivot ? `between the pivot ${whole(nifty.pivot)} and R1 ${whole(nifty.resistance1)}`
          : p > nifty.support1 ? `between S1 ${whole(nifty.support1)} and the pivot ${whole(nifty.pivot)}`
            : p > nifty.support2 ? `between S2 ${whole(nifty.support2)} and S1 ${whole(nifty.support1)}`
              : `below S2 ${whole(nifty.support2)}`;
    levelNote = `GIFT-implied open ≈ ${whole(p)} (${signed(gapPoints, 0)} pts), ${where}.`;
  }
  return { quote: gift, niftyClose, gapPoints, gapPercent, tonePercent, verdict, text, levelNote };
}

export function buildMarketOutlook(input: OutlookInput): MarketOutlook {
  const { gift, bias, cues, levels, indexes } = input;
  const niftyLevels = levels.find((l) => l.key === "nifty");
  const niftyClose = niftyLevels?.close ?? null;
  const comparison = gift && niftyClose ? compareGift(gift, niftyClose, bias.score, niftyLevels) : null;

  const giftDriver = (): OutlookDriver | null => comparison
    ? { label: "GIFT Nifty", detail: `${signed(comparison.gapPercent)}% vs Nifty close`, points: step(comparison.gapPercent, 0.15, 0.5) }
    : null;
  const toneDriver = (): OutlookDriver | null => bias.score != null
    ? { label: "Global tone", detail: `${signed(bias.score)}% overnight`, points: step(bias.score, 0.3, 0.8) }
    : null;
  const trendDrivers = (key: string, name: string): OutlookDriver[] => {
    const x = indexes[key];
    const out: OutlookDriver[] = [];
    if (x?.dailyTrend) out.push({ label: `${name} daily trend`, detail: x.dailyTrend.toLowerCase(), points: trendPoints(x.dailyTrend) });
    if (x?.weeklyTrend) out.push({ label: `${name} weekly trend`, detail: x.weeklyTrend.toLowerCase(), points: trendPoints(x.weeklyTrend) });
    return out;
  };
  const breadthDriver = (key: string, name: string): OutlookDriver[] => {
    const b = indexes[key]?.breadth50;
    return b == null ? [] : [{ label: `${name} breadth`, detail: `${Math.round(b)}% above 50 DMA`, points: breadthPoints(b) }];
  };
  const vix = cue(cues, "indiavix");
  const vixDriver = (): OutlookDriver[] => vix ? [{ label: "India VIX", detail: `${signed(vix.changePercent)}% on the day`, points: vix.changePercent >= 5 ? -1 : vix.changePercent <= -5 ? 1 : 0 }] : [];
  const compact = (list: Array<OutlookDriver | null | OutlookDriver[]>) => list.flat().filter((d): d is OutlookDriver => d != null);

  const marketDrivers = compact([giftDriver(), toneDriver(), trendDrivers("NIFTY50", "Nifty"), breadthDriver("NIFTY50", "Nifty"), vixDriver()]);
  const marketScore = marketDrivers.reduce((s, d) => s + d.points, 0);
  const marketLabel = labelFor(marketScore, 3);

  const build = (key: string, name: string, drivers: OutlookDriver[]): IndexOutlook => {
    const score = drivers.reduce((s, d) => s + d.points, 0);
    const label = labelFor(score, 2);
    return { key, name, label, score, conviction: conviction(score, 4, 2), drivers, summary: summarise(label, drivers) };
  };
  const nasdaq = cue(cues, "nasdaq");
  const usdinr = cue(cues, "usdinr");
  const idx: IndexOutlook[] = [
    build("NIFTY50", "Nifty", marketDrivers),
    build("BANKNIFTY", "Bank Nifty", compact([
      giftDriver(), trendDrivers("BANKNIFTY", "Bank Nifty"), breadthDriver("BANKNIFTY", "Bank Nifty"),
      usdinr ? { label: "USD/INR", detail: `${signed(usdinr.changePercent)}% (${usdinr.changePercent > 0 ? "weaker rupee pressures flows" : "stronger rupee supports flows"})`, points: step(-usdinr.changePercent, 0.2, 0.5) } : null,
    ])),
    build("NIFTYIT", "Nifty IT", compact([
      nasdaq ? { label: "Nasdaq", detail: `${signed(nasdaq.changePercent)}% overnight`, points: step(nasdaq.changePercent, 0.25, 0.8) } : null,
      usdinr ? { label: "USD/INR", detail: `${signed(usdinr.changePercent)}% (${usdinr.changePercent > 0 ? "weaker rupee helps IT" : "stronger rupee hurts IT earnings"})`, points: step(usdinr.changePercent, 0.15, 0.4) } : null,
      giftDriver(), trendDrivers("NIFTYIT", "IT"), breadthDriver("NIFTYIT", "IT"),
    ])),
    build("NIFTYMIDCAP", "Midcap 100", compact([giftDriver(), breadthDriver("NIFTYMIDCAP", "Midcap"), vixDriver()])),
  ];

  return {
    label: marketLabel,
    score: marketScore,
    maxScore: 8,
    conviction: conviction(marketScore, 5, 3),
    drivers: marketDrivers,
    summary: summarise(marketLabel, marketDrivers),
    gift: comparison,
    indexes: idx,
  };
}
