"use client";

import { useEffect, useState } from "react";
import type { ScannerMode, ScannerPayload } from "@/lib/screen/chartinkScans";

const POLL_MS = 60_000;
const WARMING_POLL_MS = 5_000;

/** Polls the Chartink-style scanner results once `enabled` turns on. */
export function useScannerResults(
  enabled: boolean,
  mode: ScannerMode,
): { data: ScannerPayload | null; error: boolean; loadingMessage: string | null } {
  const [data, setData] = useState<ScannerPayload | null>(null);
  const [errorMode, setErrorMode] = useState<ScannerMode | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      let delay = POLL_MS;
      try {
        const response = await fetch(`/api/market/scanners?mode=${mode}`, { cache: "no-store" });
        if (response.status === 503) {
          const body = (await response.json().catch(() => null)) as { warming?: boolean; error?: string } | null;
          if (body?.warming) {
            if (alive) {
              setLoadingMessage(body.error ?? "Loading the NSE universe.");
              setErrorMode(null);
            }
            delay = WARMING_POLL_MS;
            return;
          }
        }
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as ScannerPayload;
        if (!alive) return;
        setData(payload);
        setErrorMode(null);
        setLoadingMessage(null);
      } catch {
        if (alive) setErrorMode(mode);
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, mode]);

  const current = data?.mode === mode ? data : null;
  return {
    data: current,
    error: errorMode === mode,
    loadingMessage: current
      ? loadingMessage
      : mode === "live" ? "Building the provisional live scan." : "Loading completed-candle scanners.",
  };
}
