"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MoversPayload } from "@/lib/market/engine";
import type { ConnectionState, MarketStatus, Quote } from "@/lib/market/types";

export interface DataSourceInfo {
  id: string;
  label: string;
  isRealtime: boolean;
}

interface StreamState {
  quotes: Record<string, Quote>;
  movers: MoversPayload | null;
  status: MarketStatus | null;
  dataSource: DataSourceInfo | null;
  connection: ConnectionState;
  lastUpdate: number | null;
}

const INITIAL: StreamState = {
  quotes: {},
  movers: null,
  status: null,
  dataSource: null,
  connection: "connecting",
  lastUpdate: null,
};

const MAX_SSE_FAILURES = 3;
const POLL_INTERVAL_MS = 5000;

/**
 * Single live-data channel for the app.
 *
 * Prefers Server-Sent Events and degrades to REST polling after repeated
 * connection failures, so the dashboard keeps updating behind proxies that
 * buffer or block streaming responses.
 */
export function useMarketStream(symbols: string[]) {
  const [state, setState] = useState<StreamState>(INITIAL);

  // Stringify so the effect re-runs on content change, not array identity.
  const symbolKey = useMemo(
    () => [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(","),
    [symbols],
  );

  const mergeQuotes = useCallback((incoming: Quote[]) => {
    if (incoming.length === 0) return;
    setState((prev) => {
      const quotes = { ...prev.quotes };
      for (const quote of incoming) quotes[quote.symbol] = quote;
      return { ...prev, quotes, lastUpdate: Date.now() };
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const query = symbolKey ? `?symbols=${encodeURIComponent(symbolKey)}` : "";

    const startPolling = () => {
      if (disposed || pollTimer) return;
      setState((prev) => ({ ...prev, connection: "polling" }));

      const poll = async () => {
        try {
          const [quotesRes, moversRes] = await Promise.all([
            fetch(`/api/market/quotes${query}`, { cache: "no-store" }),
            fetch("/api/market/movers", { cache: "no-store" }),
          ]);
          if (disposed) return;
          if (!quotesRes.ok || !moversRes.ok) {
            throw new Error(`Market data request failed: ${quotesRes.status}/${moversRes.status}`);
          }
          const quotesJson = await quotesRes.json();
          const movers = (await moversRes.json()) as MoversPayload;
          if (disposed) return;

          setState((prev) => {
            const quotes = { ...prev.quotes };
            for (const quote of quotesJson.quotes as Quote[]) {
              quotes[quote.symbol] = quote;
            }
            return {
              ...prev,
              quotes,
              movers,
              status: quotesJson.status,
              dataSource: quotesJson.dataSource,
              connection: "polling",
              lastUpdate: Date.now(),
            };
          });
        } catch {
          if (!disposed) setState((prev) => ({ ...prev, connection: "offline" }));
        }
      };

      void poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
      return () => {
        disposed = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    source = new EventSource(`/api/market/stream${query}`);

    source.addEventListener("open", () => {
      failures = 0;
      setState((prev) => ({ ...prev, connection: "live" }));
    });

    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data);
      setState((prev) => ({
        ...prev,
        quotes: Object.fromEntries(
          (payload.quotes as Quote[]).map((q) => [q.symbol, q]),
        ),
        movers: payload.movers ?? prev.movers,
        status: payload.status,
        dataSource: payload.dataSource,
        connection: "live",
        lastUpdate: Date.now(),
      }));
    });

    source.addEventListener("provider-error", () => {
      source?.close();
      setState((prev) => ({ ...prev, connection: "offline" }));
    });

    source.addEventListener("quotes", (event) => {
      mergeQuotes(JSON.parse((event as MessageEvent<string>).data) as Quote[]);
    });

    source.addEventListener("status", (event) => {
      const status = JSON.parse((event as MessageEvent<string>).data) as MarketStatus;
      setState((prev) => ({ ...prev, status }));
    });

    source.addEventListener("movers", (event) => {
      const movers = JSON.parse((event as MessageEvent<string>).data) as MoversPayload;
      setState((prev) => ({ ...prev, movers }));
    });

    source.addEventListener("error", () => {
      failures += 1;
      setState((prev) => ({ ...prev, connection: "connecting" }));
      if (failures >= MAX_SSE_FAILURES) {
        source?.close();
        startPolling();
      }
    });

    return () => {
      disposed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [symbolKey, mergeQuotes]);

  return state;
}
