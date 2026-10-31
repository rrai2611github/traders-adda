"use client";

import { useEffect, useState } from "react";
import type { Candle } from "@/lib/market/types";
import type { IntradayTimeframe } from "@/lib/chart/intraday";

const REFRESH_MS = 5 * 60_000;

/**
 * Daily chart candles from Fyers when the user is logged in to Fyers today;
 * `null` otherwise, so the caller falls back to the scan's (Yahoo) candles.
 */
export function useFyersChartCandles(symbol: string, sessions = 750): Candle[] | null {
  const [state, setState] = useState<{ symbol: string; candles: Candle[] } | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/fyers/candles?symbol=${encodeURIComponent(symbol)}&sessions=${sessions}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { candles?: Candle[] };
        if (!disposed) setState(json.candles?.length ? { symbol, candles: json.candles } : null);
      } catch {
        if (!disposed) setState(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [symbol, sessions]);

  return state?.symbol === symbol ? state.candles : null;
}

const marketOpen = (now = Date.now()) => {
  const ist = new Date(now + 19_800_000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && minute >= 555 && minute <= 931;
};

/**
 * Intraday candles from Fyers for `resolution` (null = not needed). Refreshes
 * every 30 s while NSE is open.
 */
export function useFyersIntradayCandles(symbol: string, resolution: IntradayTimeframe | null) {
  const [state, setState] = useState<{ key: string; candles: Candle[]; error: string | null } | null>(null);
  const key = `${symbol}:${resolution}`;

  useEffect(() => {
    if (!resolution) return;
    let disposed = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const res = await fetch(`/api/fyers/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}`, { cache: "no-store" });
        const json = (await res.json()) as { candles?: Candle[]; error?: string };
        if (!res.ok) throw new Error(res.status === 401 ? "Fyers login expired. Reconnect on the Index Scalp Desk." : json.error || `HTTP ${res.status}`);
        if (!disposed) setState({ key, candles: json.candles ?? [], error: null });
      } catch (error) {
        // Keep the last good candles on a failed refresh.
        if (!disposed) setState((prev) => (prev?.key === key ? { ...prev, error: (error as Error).message } : { key, candles: [], error: (error as Error).message }));
      }
      if (!disposed && marketOpen()) timer = window.setTimeout(() => void load(), 30_000);
    };
    void load();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [key, symbol, resolution]);

  if (!resolution || state?.key !== key) return { candles: [] as Candle[], loading: !!resolution, error: null };
  return { candles: state.candles, loading: false, error: state.error };
}
