import type { ScanRow, ScreenScan } from "../../hooks/useScreenScan.ts";
import { SCANNERS, type ScannerKey, type ScannerPayload } from "./chartinkScans.ts";
import type { ScreenName } from "./criteria.ts";
import type { BuyHorizon } from "./horizonSignal.ts";
import { SCORE_BANDS } from "./oscillatorScore.ts";
import { RPCI_APPROX_RULES } from "./rpciApprox.ts";
import { RSI_EDGE_SOURCES, type RsiEdgeScanKey, type RsiEdgeSourcePayload } from "./rsiEdgeSource.ts";

/** Trading style per Buy-plan horizon; holding periods match the drawer and Watchlist. */
export const TRADING_STYLES: Record<BuyHorizon, { tag: string; holding: string }> = {
  short: { tag: "Swing", holding: "2–15 sessions" },
  mid: { tag: "Swing / positional", holding: "3–12 weeks" },
  long: { tag: "Positional", holding: "3–12+ months" },
};

export type DirectoryFamily = "Core Setups" | "RPCI & Oscillators" | "Trade Triggers" | "RSI Edge" | "Monthly Setups" | "Reversals";
export type DirectoryDirection = "bull" | "bear" | "counter-trend" | "experimental";
export type DirectoryTarget = "monthly" | "bottomed" | "screens" | "signals" | "signals-momentum" | `rsi-edge-${RsiEdgeScanKey}` | `scanner-${ScannerKey}`;

export interface DirectoryEntry {
  id: string;
  family: DirectoryFamily;
  name: string;
  horizon: BuyHorizon;
  direction: DirectoryDirection;
  /** One-line summary of the rule the scanner actually runs. */
  rule: string;
  target: DirectoryTarget;
  /** Counting source; see directoryCounts. */
  source:
    | { kind: "screen"; screen: ScreenName }
    | { kind: "rpci" }
    | { kind: "oscillator"; fresh: boolean }
    | { kind: "monthly" }
    | { kind: "bottomed" }
    | { kind: "trigger"; key: ScannerKey }
    | { kind: "rsi-edge"; key: RsiEdgeScanKey };
}

const rpci = RPCI_APPROX_RULES;

const trigger = (key: ScannerKey, direction: DirectoryDirection, rule: string): DirectoryEntry => ({
  id: `trigger-${key}`,
  family: "Trade Triggers",
  name: SCANNERS[key].menuLabel,
  horizon: "short",
  direction,
  rule,
  target: `scanner-${key}`,
  source: { kind: "trigger", key },
});

const rsiEdge = (key: RsiEdgeScanKey, horizon: BuyHorizon, direction: DirectoryDirection): DirectoryEntry => ({
  id: `rsi-edge-${key}`,
  family: "RSI Edge",
  name: RSI_EDGE_SOURCES[key].label,
  horizon,
  direction,
  rule: "Membership copied verbatim from RSI Edge's public Chartink scan; its clause is hidden, so no rule is guessed.",
  target: `rsi-edge-${key}`,
  source: { kind: "rsi-edge", key },
});

/** Every scanner visible in normal navigation, in workspace order. Hidden scanners stay out. */
export const SCANNER_DIRECTORY: DirectoryEntry[] = [
  {
    id: "bottomed-out",
    family: "Reversals",
    name: "Bottomed Out",
    horizon: "mid",
    direction: "experimental",
    rule: "Liquid stock 35%+ below its 52-week high, 120-session low set 8–60 sessions ago, higher low in the last 5 sessions, close above the 20 EMA. The 50%+ deep tier is the only one that held up in the backtest (about +0.1R). Experimental.",
    target: "bottomed",
    source: { kind: "bottomed" },
  },
  {
    id: "monthly-setups",
    family: "Monthly Setups",
    name: "Monthly breakout & compression",
    horizon: "long",
    direction: "experimental",
    rule: "Completed-month close above the prior 12 monthly highs, or a mother candle containing at least two following complete months. Research only.",
    target: "monthly",
    source: { kind: "monthly" },
  },
  {
    id: "screen-vcp",
    family: "Core Setups",
    name: "VCP",
    horizon: "mid",
    direction: "bull",
    rule: "Base of 3–300 weeks, 2–35% deep, tightening range and drying volume, above the 50/200 DMA, within 30% of the 52W high, RS 70+.",
    target: "screens",
    source: { kind: "screen", screen: "VCP" },
  },
  {
    id: "screen-blue-sky",
    family: "Core Setups",
    name: "Blue sky",
    horizon: "mid",
    direction: "bull",
    rule: "Level-1 base at the stock's highest highs (no overhead supply), up to 20% below the pivot, RS 70+.",
    target: "screens",
    source: { kind: "screen", screen: "Blue sky" },
  },
  {
    id: "screen-multi-year",
    family: "Core Setups",
    name: "Multi-year breakouts",
    horizon: "long",
    direction: "bull",
    rule: "Base of 52–300 weeks (1–6 years), up to 20% below the pivot, above the 200 DMA, RS 60+.",
    target: "screens",
    source: { kind: "screen", screen: "Multi-year breakouts" },
  },
  {
    id: "screen-ipo",
    family: "Core Setups",
    name: "IPO base",
    horizon: "mid",
    direction: "bull",
    rule: "Listed 2–50 weeks, base 2–35% deep, above the 50 DMA, up to 20% below the pivot.",
    target: "screens",
    source: { kind: "screen", screen: "IPO base" },
  },
  {
    id: "rpci",
    family: "RPCI & Oscillators",
    name: "RPCI contraction",
    horizon: "short",
    direction: "bull",
    rule: `Three ${rpci.windowSessions}-session windows, each tighter than the last; latest ≤${rpci.maxRangePercent}% range on ≤${rpci.maxVolumeRatio}× volume, RS ${rpci.minRs}+; breakout needs ${rpci.minBreakoutVolumeRatio}× volume.`,
    target: "signals",
    source: { kind: "rpci" },
  },
  {
    id: "oscillator-strong",
    family: "RPCI & Oscillators",
    name: "Oscillators · strong score",
    horizon: "short",
    direction: "bull",
    rule: `At least ${SCORE_BANDS.strong} of 15 oscillators bullish, 3-session average, completed candles only.`,
    target: "signals-momentum",
    source: { kind: "oscillator", fresh: false },
  },
  {
    id: "oscillator-fresh",
    family: "RPCI & Oscillators",
    name: "Oscillators · fresh jump",
    horizon: "short",
    direction: "bull",
    rule: `Average score rose into the strong band (${SCORE_BANDS.strong}+/15) within the last 3 sessions and stayed there.`,
    target: "signals-momentum",
    source: { kind: "oscillator", fresh: true },
  },
  trigger("high52", "bull", "Close above the prior 252-session high on 1.5×+ the 50-day average volume."),
  trigger("pullback20", "bull", "Stage-2 stock (50 > 200 SMA, 200 rising) dipped to its rising 20 EMA and closed above it."),
  trigger("leader", "bull", "RS line (close ÷ Nifty 50) at a 52-week high, RS rating 90+, above the 50-day SMA."),
  trigger("range", "bull", "Widest range of 5 days, green candle above the week's and month's open, ₹1 Cr+ traded."),
  trigger("nr7", "bull", "Yesterday was the narrowest of 7 days, inside a 10 > 50 > 200 SMA uptrend; buy above its high."),
  trigger("ath", "bull", "Close above every earlier high in our ~3 years of data, RSI(14) 60–75."),
  trigger("pocket", "bull", "Up day on more volume than any down day of the last 10, within 5% of the 10-day SMA, in an uptrend."),
  trigger("fall4", "counter-trend", "Four lower highs and lows, then a higher high, still above the 200 EMA."),
  trigger("rsidiv", "experimental", "RSI(14) up 2 sessions while each day's high is lower; needs price confirmation."),
  trigger("arbm", "experimental", "GainzAlgo ARBM: close above a 50-day regression channel (±2σ) right after its narrowest squeeze; no backtested edge."),
  rsiEdge("daily-bullish", "short", "bull"),
  rsiEdge("weekly-bullish", "mid", "bull"),
  rsiEdge("bearish", "short", "bear"),
];

export interface DirectoryCount {
  /** Liquid, still-active candidates; null when the source has not loaded or failed. */
  count: number | null;
  /** Extra context, e.g. how many are fresh breakouts. */
  detail?: string;
}

function screenCount(rows: ReadonlyArray<ScanRow>, screen: ScreenName): DirectoryCount {
  const active = new Set<string>();
  const breakouts = new Set<string>();
  for (const row of rows) {
    if (!row.screens.includes(screen) || !row.stage || row.stage === "played-out") continue;
    active.add(row.symbol);
    if (row.stage === "breakout") breakouts.add(row.symbol);
  }
  return { count: active.size, detail: breakouts.size ? `${breakouts.size} fresh breakout${breakouts.size === 1 ? "" : "s"}` : undefined };
}

/** Current hit counts for every directory entry, from data the Today page already loads. */
export function directoryCounts(
  scan: Pick<ScreenScan, "rows" | "extraRows"> | null,
  scanners: Pick<ScannerPayload, "results"> | null,
  rsiEdgeData: Pick<RsiEdgeSourcePayload, "scanners" | "errors"> | null,
): Map<string, DirectoryCount> {
  const counts = new Map<string, DirectoryCount>();
  const rows = scan?.rows ?? [];
  const allRows = scan ? [...rows, ...(scan.extraRows ?? [])] : [];
  for (const entry of SCANNER_DIRECTORY) {
    const source = entry.source;
    let result: DirectoryCount = { count: null };
    if (source.kind === "screen") {
      if (scan) result = screenCount(allRows, source.screen);
    } else if (source.kind === "rpci") {
      if (scan) {
        const hits = rows.filter((row) => row.rpciApprox);
        const breakouts = hits.filter((row) => row.rpciApprox!.stage === "breakout").length;
        result = { count: hits.length, detail: breakouts ? `${breakouts} confirmed breakout${breakouts === 1 ? "" : "s"}` : undefined };
      }
    } else if (source.kind === "oscillator") {
      if (scan) {
        result = {
          count: rows.filter((row) => row.oscillatorScore && (source.fresh
            ? row.oscillatorScore.freshJump
            : row.oscillatorScore.score >= SCORE_BANDS.strong)).length,
        };
      }
    } else if (source.kind === "trigger") {
      const hits = scanners?.results[source.key];
      if (hits) {
        const liquid = new Set(hits.filter((hit) => hit.passesFloor).map((hit) => hit.symbol));
        const all = new Set(hits.map((hit) => hit.symbol));
        result = { count: liquid.size, detail: all.size > liquid.size ? `+${all.size - liquid.size} below liquidity floor` : undefined };
      }
    } else if (source.kind === "bottomed") {
      result = { count: null, detail: "Open workspace for bottomed-out counts" };
    } else if (source.kind === "monthly") {
      result = { count: null, detail: "Open workspace for monthly counts" };
    } else {
      const res = rsiEdgeData?.scanners[source.key];
      if (rsiEdgeData?.errors[source.key]) result = { count: null, detail: "Chartink source unavailable" };
      else if (res) result = { count: new Set(res.rows.map((row) => row.symbol)).size };
    }
    counts.set(entry.id, result);
  }
  return counts;
}
