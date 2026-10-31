import type { Candle, PricePoint } from "../types.ts";

export function asNumber(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export interface YahooChartResult {
  meta?: {
    symbol?: string;
    previousClose?: number;
    chartPreviousClose?: number;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

/** Intraday close points, each kept with its own timestamp; null closes are skipped, not shifted. */
export function buildSeriesFromChart(chart: YahooChartResult, maxPoints = 60): PricePoint[] {
  const closes = chart.indicators?.quote?.[0]?.close ?? [];
  const timestamps = chart.timestamp ?? [];
  const points: PricePoint[] = [];
  for (let i = 0; i < Math.min(closes.length, timestamps.length); i += 1) {
    const time = timestamps[i];
    const price = closes[i];
    if (typeof time === "number" && Number.isFinite(time) && typeof price === "number" && Number.isFinite(price)) {
      points.push({ t: time, p: Number(price.toFixed(2)) });
    }
  }

  if (points.length === 0) return [];
  const limit = Math.max(1, Math.min(maxPoints, points.length));
  const step = Math.max(1, Math.ceil(points.length / limit));

  const sliced: PricePoint[] = [];
  for (let i = 0; i < points.length; i += step) {
    sliced.push(points[i]);
  }
  const lastPoint = points[points.length - 1];
  if (sliced[sliced.length - 1]?.t !== lastPoint.t) {
    sliced.push(lastPoint);
  }
  return sliced;
}

export function buildCandlesFromChart(chart: YahooChartResult, maxCandles = 80): Candle[] {
  const quoteSet = chart.indicators?.quote?.[0];
  if (!quoteSet) return [];

  const timestamps = chart.timestamp ?? [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quoteSet.open?.[i];
    const high = quoteSet.high?.[i];
    const low = quoteSet.low?.[i];
    const close = quoteSet.close?.[i];
    if (
      typeof timestamps[i] !== "number" ||
      typeof open !== "number" ||
      typeof high !== "number" ||
      typeof low !== "number" ||
      typeof close !== "number"
    ) {
      continue;
    }

    candles.push({
      t: timestamps[i] * 1000,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: asNumber(quoteSet.volume?.[i], 0),
    });
  }

  return candles.slice(-Math.max(1, maxCandles));
}
