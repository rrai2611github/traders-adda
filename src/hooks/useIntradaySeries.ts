"use client";

import { useEffect, useState } from "react";
import type { PricePoint } from "@/lib/market/types";

const REFRESH_MS = 60_000;

/**
 * Intraday points for sparklines.
 *
 * Kept off the SSE channel deliberately: the shape of the day changes slowly,
 * so refetching once a minute is far cheaper than streaming full series.
 */
export function useIntradaySeries(symbols: string[]) {
  const [series, setSeries] = useState<Record<string, PricePoint[]>>({});
  const key = [...symbols].sort().join(",");

  useEffect(() => {
    if (!key) {
      // Clears stale series from a previous non-empty `symbols` prop; this
      // depends on a changing prop, so it cannot be a lazy initial state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeries({});
      return;
    }

    let disposed = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/market/series?symbols=${encodeURIComponent(key)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (!disposed) setSeries(json.series ?? {});
      } catch {
        // Sparklines are decorative; a failure must not disturb the price grid.
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [key]);

  return series;
}
