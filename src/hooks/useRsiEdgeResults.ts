"use client";

import { useEffect, useState } from "react";
import type { RsiEdgeSourcePayload } from "@/lib/screen/rsiEdgeSource";
import { RSI_EDGE_SCAN_KEYS } from "@/lib/screen/rsiEdgeSource";

const POLL_MS = 60_000;
const ERROR_POLL_MS = 120_000;

function isRsiEdgePayload(value: unknown): value is RsiEdgeSourcePayload {
  if (value == null || typeof value !== "object") return false;
  const payload = value as Partial<RsiEdgeSourcePayload>;
  if (typeof payload.updatedAt !== "number" || payload.scanners == null || typeof payload.scanners !== "object") return false;
  return RSI_EDGE_SCAN_KEYS.some((key) => {
    const scanner = payload.scanners?.[key];
    return scanner != null && scanner.key === key && Array.isArray(scanner.rows) && scanner.total === scanner.rows.length;
  });
}

export function useRsiEdgeResults(enabled: boolean): {
  data: RsiEdgeSourcePayload | null;
  error: string | null;
  loading: boolean;
} {
  const [data, setData] = useState<RsiEdgeSourcePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      let delay = POLL_MS;
      if (alive) setLoading(true);
      try {
        const response = await fetch("/api/market/rsi-edge", { cache: "no-store" });
        const body = await response.json() as unknown;
        if (!response.ok) {
          const message = body != null && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `RSI Edge source returned HTTP ${response.status}.`;
          throw new Error(message);
        }
        if (!isRsiEdgePayload(body)) throw new Error("RSI Edge source returned an invalid response.");
        if (!alive) return;
        setData(body);
        setError(null);
      } catch (caught) {
        if (alive) {
          setError(caught instanceof Error ? caught.message : "RSI Edge source results are unavailable.");
          delay = ERROR_POLL_MS;
        }
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, delay);
        }
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return { data, error, loading };
}
