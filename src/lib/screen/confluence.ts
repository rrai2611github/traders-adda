import type { ScanRow, ScreenScan } from "../../hooks/useScreenScan.ts";
import { formatPrice } from "../format.ts";
import { SCANNERS, VISIBLE_SCANNER_KEYS, type ScannerKey, type ScannerPayload } from "./chartinkScans.ts";
import { RSI_EDGE_SCAN_KEYS, RSI_EDGE_SOURCES, type RsiEdgeSourcePayload } from "./rsiEdgeSource.ts";

/**
 * Independent scanner families. Confluence counts families, not individual scans, so
 * two overlapping Core Setups (for example VCP and Flat base) count once.
 */
export const CONFLUENCE_FAMILIES = ["Core Setups", "RPCI", "Oscillators", "Trade Triggers", "RSI Edge"] as const;
export type ConfluenceFamily = (typeof CONFLUENCE_FAMILIES)[number];

export type SignalTone = "bull" | "bear" | "neutral" | "muted";

export interface ConfluenceSignal {
  family: ConfluenceFamily;
  label: string;
  /** Only "bull" and "bear" signals count towards confluence. */
  tone: SignalTone;
  detail?: string;
}

export interface Confluence {
  symbol: string;
  signals: ConfluenceSignal[];
  bull: ConfluenceFamily[];
  bear: ConfluenceFamily[];
  /** True when at least one family is bullish and another is bearish. */
  conflict: boolean;
}

export type ConfluenceLevelKey = "none" | "single" | "confirmed" | "high";

export const SCAN_STAGE_LABELS: Record<NonNullable<ScanRow["stage"]>, string> = {
  forming: "Base forming",
  breakout: "Fresh breakout",
  climbing: "Climbing",
  "played-out": "Played out",
};

/** fall4 buys a pullback against the trend, so it is shown but does not add trend confluence. */
const COUNTER_TREND_SCANNERS: ReadonlySet<ScannerKey> = new Set(["fall4"]);

function screenSignals(rows: ReadonlyArray<ScanRow>): ConfluenceSignal[] {
  const items: ConfluenceSignal[] = [];
  const screens = [...new Set(rows.flatMap((item) => item.screens))];
  for (const screen of screens) {
    const stage = rows.find((item) => item.screens.includes(screen))?.stage;
    items.push({
      family: "Core Setups",
      label: screen,
      tone: stage === "played-out" ? "muted" : "bull",
      detail: stage ? SCAN_STAGE_LABELS[stage] : undefined,
    });
  }
  const row = rows[0];
  if (row?.rpciApprox) {
    items.push({ family: "RPCI", label: `RPCI ${row.rpciApprox.stage}`, tone: "bull", detail: `Pivot ₹${formatPrice(row.rpciApprox.pivotPrice)}` });
  }
  if (row?.oscillatorScore) {
    const score = row.oscillatorScore;
    items.push({
      family: "Oscillators",
      label: `Score ${score.score.toFixed(1)}/15`,
      tone: score.verdict === "strong" || score.verdict === "bullish" ? "bull" : score.verdict === "bearish" ? "bear" : "neutral",
      detail: score.freshJump ? "Fresh jump into strong band" : score.verdict,
    });
  }
  return items;
}

function scannerSignal(key: ScannerKey, passesFloor: boolean, mode: ScannerPayload["mode"]): ConfluenceSignal {
  return {
    family: "Trade Triggers",
    label: SCANNERS[key].menuLabel,
    tone: !passesFloor ? "muted" : COUNTER_TREND_SCANNERS.has(key) ? "neutral" : "bull",
    detail: passesFloor ? (mode === "live" ? "Provisional live candle" : "Completed candle") : "Below liquidity floor",
  };
}

function rsiEdgeSignal(key: (typeof RSI_EDGE_SCAN_KEYS)[number]): ConfluenceSignal {
  return { family: "RSI Edge", label: RSI_EDGE_SOURCES[key].label, tone: key === "bearish" ? "bear" : "bull", detail: "Chartink source" };
}

export function summarizeConfluence(symbol: string, signals: ConfluenceSignal[]): Confluence {
  const bull = CONFLUENCE_FAMILIES.filter((family) => signals.some((item) => item.family === family && item.tone === "bull"));
  const bear = CONFLUENCE_FAMILIES.filter((family) => signals.some((item) => item.family === family && item.tone === "bear"));
  return { symbol, signals, bull, bear, conflict: bull.length > 0 && bear.length > 0 };
}

/** Every scanner signal for one stock across the workspaces. */
export function stockConfluence(
  symbol: string,
  row: ScanRow | null,
  extraRows: ReadonlyArray<ScanRow>,
  scanners: ScannerPayload | null,
  rsiEdge: RsiEdgeSourcePayload | null,
): Confluence {
  const rows = [row, ...extraRows].filter((item): item is ScanRow => item != null);
  const signals = screenSignals(rows);
  if (scanners) {
    for (const key of VISIBLE_SCANNER_KEYS) {
      const hit = scanners.results[key]?.find((item) => item.symbol === symbol);
      if (hit) signals.push(scannerSignal(key, hit.passesFloor, scanners.mode));
    }
  }
  if (rsiEdge) {
    for (const key of RSI_EDGE_SCAN_KEYS) {
      if (rsiEdge.scanners[key]?.rows.some((item) => item.symbol === symbol)) signals.push(rsiEdgeSignal(key));
    }
  }
  return summarizeConfluence(symbol, signals);
}

/** Confluence for every stock that appears in any source, keyed by symbol. */
export function buildConfluence(
  scan: Pick<ScreenScan, "rows" | "extraRows"> | null,
  scanners: ScannerPayload | null,
  rsiEdge: RsiEdgeSourcePayload | null,
): Map<string, Confluence> {
  const signals = new Map<string, ConfluenceSignal[]>();
  const push = (symbol: string, items: ConfluenceSignal[]) => {
    if (!items.length) return;
    const list = signals.get(symbol);
    if (list) list.push(...items);
    else signals.set(symbol, [...items]);
  };

  const rowsBySymbol = new Map<string, ScanRow[]>();
  for (const row of scan?.rows ?? []) rowsBySymbol.set(row.symbol, [row]);
  for (const row of scan?.extraRows ?? []) {
    const list = rowsBySymbol.get(row.symbol);
    if (list) list.push(row);
    else rowsBySymbol.set(row.symbol, [row]);
  }
  for (const [symbol, rows] of rowsBySymbol) push(symbol, screenSignals(rows));

  if (scanners) {
    for (const key of VISIBLE_SCANNER_KEYS) {
      const seen = new Set<string>();
      for (const hit of scanners.results[key] ?? []) {
        if (seen.has(hit.symbol)) continue;
        seen.add(hit.symbol);
        push(hit.symbol, [scannerSignal(key, hit.passesFloor, scanners.mode)]);
      }
    }
  }
  if (rsiEdge) {
    for (const key of RSI_EDGE_SCAN_KEYS) {
      for (const symbol of new Set((rsiEdge.scanners[key]?.rows ?? []).map((item) => item.symbol))) {
        push(symbol, [rsiEdgeSignal(key)]);
      }
    }
  }

  const result = new Map<string, Confluence>();
  for (const [symbol, items] of signals) result.set(symbol, summarizeConfluence(symbol, items));
  return result;
}

export function confluenceLevel(count: number): { key: ConfluenceLevelKey; label: string } {
  if (count >= 3) return { key: "high", label: "High confluence" };
  if (count === 2) return { key: "confirmed", label: "Confirmed" };
  if (count === 1) return { key: "single", label: "Single scanner" };
  return { key: "none", label: "No scanner" };
}

/**
 * Stocks where at least `minFamilies` independent families agree in one direction and
 * none disagree, strongest first (more families, then more individual signals).
 */
export function rankConfluence(
  confluence: ReadonlyMap<string, Confluence>,
  direction: "bull" | "bear",
  minFamilies = 2,
): Confluence[] {
  return [...confluence.values()]
    .filter((item) => item[direction].length >= minFamilies && !item.conflict)
    .sort((a, b) =>
      b[direction].length - a[direction].length
      || b.signals.filter((signal) => signal.tone === direction).length - a.signals.filter((signal) => signal.tone === direction).length
      || a.symbol.localeCompare(b.symbol));
}
