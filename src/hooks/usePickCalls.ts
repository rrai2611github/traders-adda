"use client";

import { useEffect, useState } from "react";
import type { PickCall } from "@/lib/radar/pickCalls";

export interface PickCallsData {
  today: string;
  lastRecorded: { at: number; email: string; listed: number; added: number } | null;
  calls: Record<string, PickCall>;
}

/** First calls for the Top picks, refreshed every five minutes. A failure leaves the last result and reports `failed`. */
export function usePickCalls() {
  const [data, setData] = useState<PickCallsData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch("/api/market/pick-calls", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload: PickCallsData = await response.json();
        if (alive) { setData(payload); setFailed(false); }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[pick-calls] Refresh failed:", error);
        if (alive) setFailed(true);
      } finally {
        if (alive) timer = setTimeout(load, 5 * 60_000);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);
  return { data, failed };
}
