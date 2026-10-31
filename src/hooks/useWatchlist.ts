"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/market/defaults";

const STORAGE_KEY = "sa.watchlist.v1";

// NSE symbol changes, so saved watchlists keep the successor listing.
const RENAMED_SYMBOLS: Record<string, string> = { ZOMATO: "ETERNAL", TATAMOTORS: "TMPV" };

/** Screen rows label tickers as "NSE:XYZ"; the watchlist and stream use bare tickers. */
export function normalizeWatchlistSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase().replace(/^NSE:/, "");
  return RENAMED_SYMBOLS[upper] ?? upper;
}

function read(): string[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    return [
      ...new Set(
        parsed
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .map(normalizeWatchlistSymbol),
      ),
    ];
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

/**
 * Watchlist persisted to localStorage.
 *
 * Starts from the default list on the server and during the first paint, then
 * hydrates from storage in an effect to avoid a server/client markup mismatch.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Deliberately synchronous: the first client render must match the server's
    // DEFAULT_WATCHLIST markup exactly, so storage is only read after mount.
    // Deferring to a callback would reintroduce the server/client mismatch this avoids.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSymbols(read());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      // Storage can be unavailable (private mode, quota) — keep state in memory.
    }
  }, [symbols, hydrated]);

  const add = useCallback((symbol: string) => {
    const upper = normalizeWatchlistSymbol(symbol);
    setSymbols((prev) => (prev.includes(upper) ? prev : [...prev, upper]));
  }, []);

  const remove = useCallback((symbol: string) => {
    const upper = normalizeWatchlistSymbol(symbol);
    setSymbols((prev) => prev.filter((s) => s !== upper));
  }, []);

  const toggle = useCallback((symbol: string) => {
    const upper = normalizeWatchlistSymbol(symbol);
    setSymbols((prev) =>
      prev.includes(upper) ? prev.filter((s) => s !== upper) : [...prev, upper],
    );
  }, []);

  const reset = useCallback(() => setSymbols(DEFAULT_WATCHLIST), []);

  return { symbols, hydrated, add, remove, toggle, reset };
}
