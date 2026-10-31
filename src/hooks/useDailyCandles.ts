"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candle } from "@/lib/market/types";

const REFRESH_MS = 10 * 60_000;

export function useDailyCandles(symbols: string[], limit = 80) {
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const key = useMemo(() => [...new Set(symbols)].sort().join(","), [symbols]);

  useEffect(() => {
    if (!key) {
      // Clears stale candles from a previous non-empty `symbols` prop; this
      // depends on a changing prop, so it cannot be a lazy initial state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCandles({});
      return;
    }

    let disposed = false;

    const load = async () => {
      const res = await fetch(
        `/api/market/history?symbols=${encodeURIComponent(key)}&limit=${limit}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`History request failed: ${res.status}`);
      }
      const json = await res.json();
      if (!disposed) setCandles(json.candles ?? {});
    };

    void load().catch(() => {
      if (!disposed) setCandles({});
    });

    const timer = window.setInterval(() => {
      void load().catch(() => {
        if (!disposed) setCandles({});
      });
    }, REFRESH_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [key, limit]);

  return candles;
}
