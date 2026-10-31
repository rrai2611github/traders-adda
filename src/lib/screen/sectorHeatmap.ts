import type { ScanRow } from "../../hooks/useScreenScan.ts";
import { macroSector, UNCLASSIFIED } from "../industry.ts";
import { MIN_SECTOR_MEMBERS } from "./commandCenter.ts";

/** What the heatmap colours by. */
export type HeatMetric = "change" | "vs50" | "rs";

/** −3 (deep red) … 0 (flat) … +3 (deep green). */
export type HeatLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export interface HeatStock {
  symbol: string;
  name: string;
  changePercent: number;
  vs50: number | null;
  rs: number | null;
  turnoverCr: number;
  /** The selected metric's value for this stock, null when unknown. */
  value: number | null;
}

export interface HeatSector {
  sector: string;
  total: number;
  advancing: number;
  turnoverCr: number;
  /** Sector value for the selected metric, null when no member has it. */
  value: number | null;
  /** Members by traded value, largest first. */
  members: HeatStock[];
}

export const HEAT_METRICS: Record<HeatMetric, { label: string; short: string; sectorRule: string; stockRule: string }> = {
  change: {
    label: "1-day move",
    short: "1D",
    sectorRule: "Average 1-day move of the sector's stocks.",
    stockRule: "The stock's 1-day move.",
  },
  vs50: {
    label: "Above 50-day line",
    short: ">50D",
    sectorRule: "Share of the sector's stocks closing above their 50-day average.",
    stockRule: "Distance from the 50-day average.",
  },
  rs: {
    label: "RS rating",
    short: "RS",
    sectorRule: "Median RS rating (1–99) of the sector's stocks.",
    stockRule: "The stock's RS rating (1–99).",
  },
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stockValue(row: ScanRow, metric: HeatMetric): number | null {
  if (metric === "change") return row.changePercent;
  if (metric === "vs50") return row.vs50;
  return row.rs;
}

function sectorValue(members: ScanRow[], metric: HeatMetric): number | null {
  if (metric === "change") return members.reduce((sum, row) => sum + row.changePercent, 0) / members.length;
  if (metric === "vs50") {
    const known = members.filter((row) => row.vs50 != null);
    return known.length ? (known.filter((row) => (row.vs50 ?? 0) > 0).length / known.length) * 100 : null;
  }
  return median(members.flatMap((row) => (row.rs == null ? [] : [row.rs])));
}

/** Sectors (macro NSE sectors, ≥ MIN_SECTOR_MEMBERS stocks) with members, largest traded value first. */
export function buildSectorHeatmap(rows: ReadonlyArray<ScanRow>, metric: HeatMetric): HeatSector[] {
  const groups = new Map<string, ScanRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Number.isFinite(row.changePercent) || seen.has(row.symbol)) continue;
    const sector = macroSector(row.sector);
    if (sector === UNCLASSIFIED) continue;
    seen.add(row.symbol);
    groups.set(sector, [...(groups.get(sector) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= MIN_SECTOR_MEMBERS)
    .map(([sector, members]) => ({
      sector,
      total: members.length,
      advancing: members.filter((row) => row.changePercent > 0).length,
      turnoverCr: members.reduce((sum, row) => sum + (row.turnoverCr ?? 0), 0),
      value: sectorValue(members, metric),
      members: members
        .map((row) => ({
          symbol: row.symbol,
          name: row.name,
          changePercent: row.changePercent,
          vs50: row.vs50,
          rs: row.rs,
          turnoverCr: row.turnoverCr ?? 0,
          value: stockValue(row, metric),
        }))
        .sort((a, b) => b.turnoverCr - a.turnoverCr),
    }))
    .sort((a, b) => b.turnoverCr - a.turnoverCr);
}

export interface SectorHeatLine {
  sector: string;
  /** Average 1-day move of the sector's stocks, in percent. */
  changePercent: number;
  /** Share of the sector's stocks above their 50-day average, in percent. */
  above50Percent: number | null;
  advancing: number;
  total: number;
}

/** One line per sector for the hourly email, hottest 1-day move first. */
export function sectorHeatLines(rows: ReadonlyArray<ScanRow>): SectorHeatLine[] {
  const above = new Map(buildSectorHeatmap(rows, "vs50").map((sector) => [sector.sector, sector.value]));
  return buildSectorHeatmap(rows, "change")
    .filter((sector) => sector.value != null)
    .map((sector) => ({
      sector: sector.sector,
      changePercent: sector.value as number,
      above50Percent: above.get(sector.sector) ?? null,
      advancing: sector.advancing,
      total: sector.total,
    }))
    .sort((a, b) => b.changePercent - a.changePercent);
}

// Thresholds for +1/+2/+3 (and their mirror for −1/−2/−3) around each scale's neutral point.
const SCALES: Record<"change" | "vs50Stock" | "percent", { center: number; steps: [number, number, number] }> = {
  change: { center: 0, steps: [0.25, 1, 2] },
  vs50Stock: { center: 0, steps: [1, 5, 10] },
  percent: { center: 50, steps: [5, 15, 25] },
};

/** Colour level for a value. Sector vs50 is a % share and RS is 1–99, both centred on 50. */
export function heatLevel(metric: HeatMetric, value: number | null, scope: "sector" | "stock"): HeatLevel {
  if (value == null || !Number.isFinite(value)) return 0;
  const scale = metric === "change"
    ? SCALES.change
    : metric === "vs50" && scope === "stock"
      ? SCALES.vs50Stock
      : SCALES.percent;
  const delta = value - scale.center;
  const size = Math.abs(delta);
  const step = size >= scale.steps[2] ? 3 : size >= scale.steps[1] ? 2 : size >= scale.steps[0] ? 1 : 0;
  return (delta < 0 ? -step : step) as HeatLevel;
}

export function formatHeatValue(metric: HeatMetric, value: number | null, scope: "sector" | "stock"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (metric === "rs") return String(Math.round(value));
  if (metric === "vs50" && scope === "sector") return `${Math.round(value)}%`;
  return `${value > 0 ? "+" : ""}${value.toFixed(metric === "change" ? 2 : 1)}%`;
}
