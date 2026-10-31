import type { ScreenScan } from "../../hooks/useScreenScan";
import type { ScannerPayload } from "./chartinkScans";
import type { RsiEdgeSourcePayload } from "./rsiEdgeSource";

export type UniverseKey = "all" | "nifty50" | "nifty100" | "nifty200" | "nifty500" | "fno";

export const UNIVERSE_OPTIONS: { key: UniverseKey; label: string; detail: string }[] = [
  { key: "all", label: "All NSE", detail: "Every liquid NSE stock we scan" },
  { key: "nifty50", label: "Nifty 50", detail: "Large-cap benchmark" },
  { key: "nifty100", label: "Nifty 100", detail: "Nifty 50 + Next 50" },
  { key: "nifty200", label: "Nifty 200", detail: "Large + mid caps" },
  { key: "nifty500", label: "Nifty 500", detail: "Large, mid + small caps" },
  { key: "fno", label: "F&O stocks", detail: "Stocks with futures & options; only these can be shorted positionally" },
];

export const UNIVERSE_STORAGE_KEY = "traders-adda:universe";

export function isUniverseKey(value: unknown): value is UniverseKey {
  return UNIVERSE_OPTIONS.some((option) => option.key === value);
}

type Predicate = ((symbol: string) => boolean) | null;

/**
 * Narrows scan rows to a universe. Market-wide figures (breadth, scanned
 * counts) are left untouched: the universe is a view filter, not a new scan.
 */
export function filterScan(scan: ScreenScan | null, keep: Predicate): ScreenScan | null {
  if (!scan || !keep) return scan;
  return {
    ...scan,
    marketRows: scan.marketRows ?? scan.rows,
    rows: scan.rows.filter((row) => keep(row.symbol)),
    extraRows: scan.extraRows?.filter((row) => keep(row.symbol)),
    feed: scan.feed?.filter((event) => keep(event.symbol)),
  };
}

export function filterScanners(data: ScannerPayload | null, keep: Predicate): ScannerPayload | null {
  if (!data || !keep) return data;
  const results = Object.fromEntries(
    Object.entries(data.results).map(([key, rows]) => [key, rows.filter((row) => keep(row.symbol))]),
  ) as ScannerPayload["results"];
  return { ...data, results };
}

export function filterRsiEdge(data: RsiEdgeSourcePayload | null, keep: Predicate): RsiEdgeSourcePayload | null {
  if (!data || !keep) return data;
  const scanners: RsiEdgeSourcePayload["scanners"] = {};
  for (const [key, result] of Object.entries(data.scanners) as [keyof RsiEdgeSourcePayload["scanners"], NonNullable<RsiEdgeSourcePayload["scanners"][keyof RsiEdgeSourcePayload["scanners"]]>][]) {
    const rows = result.rows.filter((row) => keep(row.symbol));
    scanners[key] = { ...result, rows, total: rows.length };
  }
  return { ...data, scanners };
}
