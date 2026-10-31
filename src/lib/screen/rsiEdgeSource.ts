export type RsiEdgeScanKey = "daily-bullish" | "weekly-bullish" | "bearish";

export interface RsiEdgeSourceRow {
  symbol: string;
  name: string;
  bseCode: string | null;
  price: number;
  changePercent: number;
  volume: number;
  rsi: number | null;
}

export interface RsiEdgeSourceResult {
  key: RsiEdgeScanKey;
  label: string;
  slug: string;
  total: number;
  rows: RsiEdgeSourceRow[];
}

export interface RsiEdgeSourcePayload {
  updatedAt: number;
  delayed: boolean;
  scanners: Partial<Record<RsiEdgeScanKey, RsiEdgeSourceResult>>;
  errors: Partial<Record<RsiEdgeScanKey, string>>;
}

export const RSI_EDGE_SOURCES: Record<RsiEdgeScanKey, {
  label: string;
  slug: string;
  description: string;
}> = {
  "daily-bullish": {
    label: "Bullish Stocks · Daily",
    slug: "saatiish99-bullish",
    description: "Stocks returned by RSI Edge's public Daily Bullish scanner on Chartink.",
  },
  "weekly-bullish": {
    label: "Bullish Stocks · Weekly",
    slug: "saatiish99-bullish-weekly-4",
    description: "Stocks returned by RSI Edge's public Weekly Bullish scanner on Chartink.",
  },
  bearish: {
    label: "Bearish Stocks",
    slug: "sk-bearish-18",
    description: "Stocks returned by RSI Edge's public Bearish scanner on Chartink.",
  },
};

export const RSI_EDGE_SCAN_KEYS = Object.keys(RSI_EDGE_SOURCES) as RsiEdgeScanKey[];
