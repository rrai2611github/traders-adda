import type { MarketRegime, SectorSummary } from "./commandCenter.ts";

export type PulseMood = "bullish" | "constructive" | "neutral" | "cautious" | "bearish" | "no-data";
export type PulseStance = "Press longs" | "Be selective" | "Build watchlist" | "Defend capital" | "Stand aside";

export interface PulseSignal {
  label: string;
  value: string;
  verdict: "bull" | "bear" | "neutral";
  note: string;
}

export interface MarketPulse {
  /** 0–100 weighted mood, or null when no breadth input is available. */
  score: number | null;
  mood: PulseMood;
  moodLabel: string;
  inputs: number;
  headline: string;
  summary: string;
  stance: PulseStance;
  meaning: string;
  tapeFavours: string;
  signals: PulseSignal[];
}

const WEIGHTS = { breadth50: 0.4, breadth200: 0.3, advance: 0.3 } as const;

const MOODS: { min: number; mood: PulseMood; label: string }[] = [
  { min: 65, mood: "bullish", label: "Bullish" },
  { min: 55, mood: "constructive", label: "Constructive" },
  { min: 45, mood: "neutral", label: "Neutral" },
  { min: 35, mood: "cautious", label: "Cautious" },
  { min: 0, mood: "bearish", label: "Bearish" },
];

const verdictFor = (value: number | null, bull: number, bear: number): PulseSignal["verdict"] =>
  value == null ? "neutral" : value >= bull ? "bull" : value < bear ? "bear" : "neutral";

const listSectors = (sectors: ReadonlyArray<SectorSummary>) =>
  sectors.slice(0, 2).map((sector) => sector.sector).join(" and ");

/**
 * Plain-English reading of market breadth: a 0–100 mood, a stance, what it means today and
 * what the tape favours. Every sentence is derived from the same regime that gates Buy ready.
 */
export function marketPulse(
  regime: MarketRegime,
  sectors: ReadonlyArray<SectorSummary>,
  counts: { buyReady: number; shortReady: number },
): MarketPulse {
  const advance = regime.total ? Math.round((regime.advancing / regime.total) * 100) : null;
  const parts = [
    [regime.breadth50, WEIGHTS.breadth50],
    [regime.breadth200, WEIGHTS.breadth200],
    [advance, WEIGHTS.advance],
  ].filter((part): part is [number, number] => part[0] != null);
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  const score = parts.length ? Math.round(parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight) : null;

  const signals: PulseSignal[] = [
    {
      label: "Above 50 DMA",
      value: regime.breadth50 != null ? `${regime.breadth50}%` : "—",
      verdict: verdictFor(regime.breadth50, 60, 40),
      note: "Medium-term participation; Buy ready needs at least 50%.",
    },
    {
      label: "Above 200 DMA",
      value: regime.breadth200 != null ? `${regime.breadth200}%` : "—",
      verdict: verdictFor(regime.breadth200, 50, 40),
      note: "Long-term trend health.",
    },
    {
      label: "Advancing today",
      value: advance != null ? `${advance}%` : "—",
      verdict: verdictFor(advance, 60, 40),
      note: advance != null ? `${regime.advancing} up · ${regime.declining} down of ${regime.total}.` : "No prices yet.",
    },
  ];

  if (score == null) {
    return {
      score: null,
      mood: "no-data",
      moodLabel: "No data",
      inputs: 0,
      headline: "Waiting for market data",
      summary: "No breadth has loaded yet. Wait for the scan before reading anything into this card.",
      stance: "Stand aside",
      meaning: "There is no tape to read yet. Let the scan finish before drawing any conclusion.",
      tapeFavours: "Nothing — wait for data",
      signals,
    };
  }

  const { mood, label: moodLabel } = MOODS.find((item) => score >= item.min)!;
  const leaders = listSectors(sectors.filter((sector) => sector.avgChange > 0));
  const laggards = listSectors([...sectors].filter((sector) => sector.avgChange < 0).sort((a, b) => a.avgChange - b.avgChange));
  const countLine = `${counts.buyReady} Buy ready · ${counts.shortReady} Short ready on the latest scan.`;

  let stance: PulseStance;
  let meaning: string;
  let tapeFavours: string;
  if (regime.key === "risk-on") {
    stance = "Press longs";
    meaning = "Broad participation: breakouts have the best odds of following through. Act on Buy ready setups with normal size.";
    tapeFavours = leaders ? `Buy ready breakouts, led by ${leaders}` : "Buy ready breakouts";
  } else if (regime.key === "selective" && (regime.breadth50 ?? 0) >= 50) {
    stance = "Be selective";
    meaning = "Participation is healthy but narrow. Stick to the strongest sectors and cut size on marginal setups.";
    tapeFavours = leaders ? `Relative-strength leaders in ${leaders}` : "Relative-strength leaders only";
  } else if (regime.key === "selective") {
    stance = "Build watchlist";
    meaning = "Breadth is under 50%, so Buy ready is paused. Prepare Watch names for when the market turns.";
    tapeFavours = "Watch names — plan entries, don't take them yet";
  } else {
    stance = "Defend capital";
    meaning = "Most stocks are below their averages. Protect capital; only well-defined F&O shorts have an edge.";
    tapeFavours = laggards ? `Cash, or F&O shorts in weak ${laggards} names` : "Cash, or well-defined F&O shorts";
  }

  if (advance != null && regime.key === "risk-off" && advance >= 60) {
    meaning += ` Today's bounce (${advance}% advancing) sits inside a weak trend — don't chase it.`;
  } else if (advance != null && regime.key === "risk-on" && advance <= 40) {
    meaning += ` Today's dip (${advance}% advancing) sits inside a healthy trend — watch quality names near support.`;
  }

  return {
    score,
    mood,
    moodLabel,
    inputs: parts.length,
    headline: `${regime.label} market`,
    summary: `${regime.breadth50 ?? "—"}% of liquid stocks are above their 50-day average and ${regime.breadth200 ?? "—"}% above their 200-day. ${countLine}`,
    stance,
    meaning,
    tapeFavours,
    signals,
  };
}
