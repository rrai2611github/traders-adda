import type { FeedEvent, ScanRow } from "../../hooks/useScreenScan.ts";
import { macroSector, UNCLASSIFIED } from "../industry.ts";
import { HEALTHY_BREADTH_PERCENT, movingAverageBreadth } from "./breadth.ts";
import type { BuyingStatus } from "./buyingStatus.ts";
import { horizonBuySignal, type BuyHorizon, type HorizonSignal } from "./horizonSignal.ts";
import { currentScanShortSellingStatus, type ShortSellingStatus } from "./shortSellingStatus.ts";

/** Averages over a handful of names are noise, so small sectors are left out. */
export const MIN_SECTOR_MEMBERS = 3;
export const IDEA_MIN_TURNOVER_CR = 5;

export type RegimeKey = "risk-on" | "selective" | "risk-off";

export interface MarketRegime {
  key: RegimeKey;
  label: "Risk-on" | "Selective" | "Risk-off";
  guidance: string;
  breadth50: number | null;
  breadth200: number | null;
  advancing: number;
  declining: number;
  total: number;
}

export interface SectorSummary {
  sector: string;
  advancing: number;
  total: number;
  avgChange: number;
  turnoverCr: number;
}

export interface BuyIdea {
  row: ScanRow;
  signal: HorizonSignal;
}

export interface ShortIdea {
  row: ScanRow;
  status: ShortSellingStatus;
}

/**
 * Breadth-driven market regime. Thresholds mirror the Buy ready breadth gate:
 * at least 50% of liquid stocks above their 50-day average is required for Buy ready.
 */
export function regimeKeyFor(breadth50: number | null, breadth200: number | null): RegimeKey {
  if (breadth50 != null && breadth50 >= 60 && (breadth200 ?? 0) >= 50) return "risk-on";
  if (breadth50 == null || breadth50 < 40 || (breadth50 < HEALTHY_BREADTH_PERCENT && (breadth200 ?? 0) < 40)) return "risk-off";
  return "selective";
}

export function marketRegime(rows: ReadonlyArray<ScanRow>): MarketRegime {
  const priced = rows.filter((row) => Number.isFinite(row.changePercent));
  const advancing = priced.filter((row) => row.changePercent > 0).length;
  const declining = priced.filter((row) => row.changePercent < 0).length;
  const breadth50 = movingAverageBreadth(rows, "vs50").percent;
  const breadth200 = movingAverageBreadth(rows, "vs200").percent;
  const base = { breadth50, breadth200, advancing, declining, total: priced.length };

  if (regimeKeyFor(breadth50, breadth200) === "risk-on") {
    return {
      ...base,
      key: "risk-on",
      label: "Risk-on",
      guidance: "Broad participation. Breakouts have the best follow-through; act on Buy ready setups with normal position size.",
    };
  }
  if (regimeKeyFor(breadth50, breadth200) === "risk-off") {
    return {
      ...base,
      key: "risk-off",
      label: "Risk-off",
      guidance: "Most stocks are below their averages. Buy ready is paused; protect capital, keep watchlists, and consider only well-defined shorts.",
    };
  }
  return {
    ...base,
    key: "selective",
    label: "Selective",
    guidance: (breadth50 ?? 0) >= HEALTHY_BREADTH_PERCENT
      ? "Participation is healthy but not broad. Favour the strongest sectors and reduce size on marginal setups."
      : "Breadth is below 50%, so Buy ready is paused. Build a Watch list for when the market recovers.",
  };
}

/** NSE macro-sector aggregates over every eligible equity that has a published sector. */
export function groupScanBySector(rows: ReadonlyArray<ScanRow>): SectorSummary[] {
  const groups = new Map<string, ScanRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.changePercent)) continue;
    const industry = macroSector(row.sector);
    if (industry === UNCLASSIFIED) continue;
    groups.set(industry, [...(groups.get(industry) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= MIN_SECTOR_MEMBERS)
    .map(([sector, members]) => ({
      sector,
      advancing: members.filter((row) => row.changePercent > 0).length,
      total: members.length,
      avgChange: members.reduce((sum, row) => sum + row.changePercent, 0) / members.length,
      turnoverCr: members.reduce((sum, row) => sum + (row.turnoverCr ?? 0), 0),
    }))
    .sort((left, right) => right.avgChange - left.avgChange);
}

const BUY_ORDER: Record<BuyingStatus["key"], number> = { "buy-ready": 0, watch: 1, extended: 2, avoid: 3 };

/** Liquid Buy ready and Watch candidates for one horizon; within a status, highest RS first (see `todaysPicks`). */
export function rankBuyIdeas(
  rows: ReadonlyArray<ScanRow>,
  horizon: BuyHorizon,
  breadthPercent: number | null,
): BuyIdea[] {
  return rows
    .filter((row) => row.turnoverCr != null && row.turnoverCr >= IDEA_MIN_TURNOVER_CR)
    .map((row) => ({ row, signal: horizonBuySignal(row, horizon, breadthPercent) }))
    .filter((idea) => idea.signal.plan != null && (idea.signal.status.key === "buy-ready" || idea.signal.status.key === "watch"))
    .sort((a, b) =>
      BUY_ORDER[a.signal.status.key] - BUY_ORDER[b.signal.status.key]
      || (b.row.rs ?? 0) - (a.row.rs ?? 0)
      || b.signal.status.rating - a.signal.status.rating);
}

/** Liquid Extended or near-miss (≥ 60% of checks) setups with levels (a plan, or a no-trade reason), used as reference when nothing qualifies. */
export function nearestBuyIdeas(
  rows: ReadonlyArray<ScanRow>,
  horizon: BuyHorizon,
  breadthPercent: number | null,
): BuyIdea[] {
  return rows
    .filter((row) => row.turnoverCr != null && row.turnoverCr >= IDEA_MIN_TURNOVER_CR)
    .map((row) => ({ row, signal: horizonBuySignal(row, horizon, breadthPercent) }))
    .filter((idea) => (idea.signal.plan != null || idea.signal.noTrade != null)
      && (idea.signal.status.key === "extended" || (idea.signal.status.key === "avoid" && idea.signal.status.rating >= 60)))
    .sort((a, b) => b.signal.status.rating - a.signal.status.rating || (b.row.rs ?? 0) - (a.row.rs ?? 0));
}

/** Liquid Short ready candidates, weakest RS first. */
export function rankShortIdeas(rows: ReadonlyArray<ScanRow>, breadthPercent: number | null): ShortIdea[] {
  return rows
    .filter((row) => row.turnoverCr != null && row.turnoverCr >= IDEA_MIN_TURNOVER_CR)
    .map((row) => ({ row, status: currentScanShortSellingStatus(row, breadthPercent) }))
    .filter((idea) => idea.status.key === "short-ready")
    .sort((a, b) => (a.row.rs ?? 100) - (b.row.rs ?? 100));
}

export interface SessionChanges {
  breakouts: FeedEvent[];
  failed: FeedEvent[];
  exits: FeedEvent[];
}

/** Splits the latest session feed into new breakouts, failed pokes, and played-out exits. */
export function sessionChanges(feed: ReadonlyArray<FeedEvent>): SessionChanges {
  const seen = new Set<string>();
  const unique = feed.filter((event) => {
    const group = event.type === "inner_breakout" ? "breakout" : event.type;
    const key = `${group}:${event.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    breakouts: unique
      .filter((event) => event.type === "breakout" || event.type === "inner_breakout")
      .sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)),
    failed: unique.filter((event) => event.type === "failed_poke"),
    exits: unique.filter((event) => event.type === "played_out"),
  };
}
