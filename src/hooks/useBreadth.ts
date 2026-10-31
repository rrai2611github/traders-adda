"use client";

import { useEffect, useState } from "react";
import type { BreadthDay, MarketMode } from "@/lib/screen/breadthHistory";

export interface BreadthPayload {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  covered: number;
  latest: BreadthDay | null;
  mode: MarketMode | null;
  history: BreadthDay[];
}

/** Share of liquid stocks above their 10/20/50/200-day averages, today and for the last ~130 sessions; refreshed every minute. */
export function useBreadth(): { data: BreadthPayload | null; failed: boolean } {
  const [data, setData] = useState<BreadthPayload | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/market/breadth", { cache: "no-store", signal: controller.signal });
        if (!alive) return;
        if (response.ok) { setData((await response.json()) as BreadthPayload); setFailed(false); }
        else if (response.status !== 503) setFailed(true);
      } catch {
        if (alive && !controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);
  return { data, failed };
}
