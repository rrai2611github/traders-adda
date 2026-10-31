"use client";

import { useEffect, useState } from "react";

export interface ResultsDates {
  today: string;
  dates: Record<string, string>;
}

/** Upcoming results dates by symbol (NSE board-meeting calendar), refreshed every hour; null until loaded or if unavailable. */
export function useResultsDates(): ResultsDates | null {
  const [data, setData] = useState<ResultsDates | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/market/results-dates", { cache: "no-store", signal: controller.signal });
        if (response.ok && alive) setData((await response.json()) as ResultsDates);
      } catch { /* the flag simply stays hidden */ }
    };
    void load();
    const timer = setInterval(() => void load(), 3_600_000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);
  return data;
}
