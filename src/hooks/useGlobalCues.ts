"use client";

import { useEffect, useState } from "react";
import type { MarketCues } from "@/lib/market/globalCues";

/** Cues change slowly relative to the tape, and the route caches for 5 minutes. */
const POLL_MS = 5 * 60_000;

export interface GlobalCuesState {
  data: MarketCues | null;
  error: boolean;
  loading: boolean;
}

export function useGlobalCues(enabled = true): GlobalCuesState {
  const [state, setState] = useState<GlobalCuesState>({ data: null, error: false, loading: true });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const response = await fetch("/api/market/global-cues", { cache: "no-store" });
        if (!response.ok) throw new Error(`Global cues request failed: ${response.status}`);
        const body = (await response.json()) as MarketCues;
        if (alive) setState({ data: body, error: false, loading: false });
      } catch {
        // Keep the last good payload; a failed refresh must not blank the brief.
        if (alive) setState((prior) => ({ ...prior, error: true, loading: false }));
      } finally {
        if (alive) timer = setTimeout(load, POLL_MS);
      }
    };

    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}
