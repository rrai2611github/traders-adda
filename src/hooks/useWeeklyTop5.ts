"use client";

import { useEffect, useState } from "react";
import type { WeeklyTop5Payload } from "@/lib/screen/weeklyTop5Results";

/** The Weekly Top 5 payload, refreshed every two minutes (every five seconds while the price history is still loading). */
export function useWeeklyTop5(): { data: WeeklyTop5Payload | null; message: string | null; failed: boolean } {
  const [data, setData] = useState<WeeklyTop5Payload | null>(null);
  const [message, setMessage] = useState<string | null>("Finding the strongest stocks…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 120_000;
      try {
        const response = await fetch("/api/market/weekly-top5", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) { if (alive) setMessage(body.error ?? "Loading price history…"); delay = 5_000; return; }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload: WeeklyTop5Payload = await response.json();
        if (alive) { setData(payload); setMessage(null); setFailed(false); }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[weekly-top5] Refresh failed:", error);
        if (alive) { setFailed(true); setMessage(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);
  return { data, message, failed };
}
