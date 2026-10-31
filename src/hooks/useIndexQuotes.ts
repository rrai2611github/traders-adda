"use client";

import { useEffect, useState } from "react";
import { DEFAULT_INDEX_SYMBOLS } from "@/lib/market/defaults";
import type { Quote } from "@/lib/market/types";

const POLL_MS = 5_000;

interface IndexQuoteState {
  quotes: Quote[];
  lastUpdate: number | null;
  error: boolean;
}

/**
 * Indices poll independently of the larger SSE stream. Some corporate proxies
 * interrupt long-lived streams; a small five-symbol REST request stays live.
 */
export function useIndexQuotes(enabled = true): IndexQuoteState {
  const [state, setState] = useState<IndexQuoteState>({ quotes: [], lastUpdate: null, error: false });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const symbols = DEFAULT_INDEX_SYMBOLS.join(",");

    const load = async () => {
      try {
        const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Index quote request failed: ${response.status}`);
        const body = (await response.json()) as { quotes: Quote[] };
        if (!alive) return;
        const bySymbol = new Map(body.quotes.map((quote) => [quote.symbol, quote]));
        setState({
          quotes: DEFAULT_INDEX_SYMBOLS.map((symbol) => bySymbol.get(symbol)).filter((quote): quote is Quote => quote != null),
          lastUpdate: Date.now(),
          error: false,
        });
      } catch {
        if (alive) setState((prior) => ({ ...prior, error: true }));
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
