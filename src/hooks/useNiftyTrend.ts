"use client";

import { useEffect, useState } from "react";
import type { NiftyTrend } from "@/lib/market/niftyTrend";

/** The Nifty 50 against its 200-day average, refreshed every five minutes; null until loaded or if unavailable. */
export function useNiftyTrend(): NiftyTrend | null {
  const [data, setData] = useState<NiftyTrend | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/market/nifty-trend", { cache: "no-store", signal: controller.signal });
        if (response.ok && alive) setData((await response.json()) as NiftyTrend);
      } catch { /* the check simply stays hidden */ }
    };
    void load();
    const timer = setInterval(() => void load(), 300_000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);
  return data;
}
