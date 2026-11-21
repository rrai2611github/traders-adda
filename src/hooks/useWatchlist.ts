"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/market/defaults";
import { normalizeWatchlistSymbol } from "@/lib/market/watchlistSymbols";

export { normalizeWatchlistSymbol } from "@/lib/market/watchlistSymbols";

/**
 * Watchlist persisted to the signed-in user's account.
 *
 * Starts from the default list on the server and during the first paint, then
 * hydrates from the API in an effect to avoid a server/client markup mismatch.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/user/watchlist", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { symbols?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error ?? `Could not load watchlist (${response.status}).`);
        if (!Array.isArray(result.symbols) || !result.symbols.every((symbol) => typeof symbol === "string")) {
          throw new Error("The saved watchlist response was invalid.");
        }
        if (active) {
          setSymbols(result.symbols as string[]);
          setHydrated(true);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load your watchlist.");
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void fetch("/api/user/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? `Could not save watchlist (${response.status}).`);
      })
      .then(() => setError(null))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not save your watchlist."));
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

  return { symbols, hydrated, error, add, remove, toggle, reset };
}
