"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Quote } from "@/lib/market/types";

/**
 * One shared poller for the latest market price of every stock shown anywhere on screen.
 * Components register the symbols they display; the poller asks the quotes endpoint for the union
 * (at most MAX_SYMBOLS, 60 per call) every 5 seconds while the market is open and every 30 seconds
 * otherwise, and pauses while the tab is hidden. Tables then show these instead of a completed close.
 */

const CHUNK = 60; // the quotes endpoint takes at most 60 symbols a call
const MAX_SYMBOLS = 180;
const POLL_LIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;

export interface LiveQuotes {
  quotes: ReadonlyMap<string, Quote>;
  /** Epoch ms of the last successful refresh, or null before the first. */
  asOf: number | null;
  /** The market is in continuous trading, so prices are moving. */
  live: boolean;
}

const EMPTY: LiveQuotes = { quotes: new Map(), asOf: null, live: false };
let snapshot: LiveQuotes = EMPTY;
const registry = new Map<string, number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let fetching = false;

const emit = () => listeners.forEach((listener) => listener());

async function poll() {
  timer = undefined;
  if (fetching) return;
  let delay = POLL_LIVE_MS;
  const symbols = [...registry.keys()].slice(0, MAX_SYMBOLS);
  if (!symbols.length) { running = false; return; }
  if (!document.hidden) {
    fetching = true;
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
      const responses = await Promise.all(chunks.map(async (chunk) => {
        const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(chunk.join(","))}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { quotes: Quote[]; status: { isLive: boolean } };
      }));
      const quotes = new Map(snapshot.quotes);
      for (const r of responses) for (const quote of r.quotes) quotes.set(quote.symbol, quote);
      const live = responses.some((r) => r.status.isLive);
      snapshot = { quotes, asOf: Date.now(), live };
      delay = live ? POLL_LIVE_MS : POLL_IDLE_MS;
      emit();
    } catch {
      delay = POLL_LIVE_MS * 2; // keep the last prices; retry
    } finally {
      fetching = false;
    }
  }
  timer = setTimeout(() => void poll(), delay);
}

/** Registers symbols for polling; returns the function that releases them. */
export function registerLiveSymbols(symbols: ReadonlyArray<string>): () => void {
  const unique = [...new Set(symbols)];
  for (const symbol of unique) registry.set(symbol, (registry.get(symbol) ?? 0) + 1);
  if (!running) { running = true; void poll(); }
  else if (timer && unique.some((symbol) => !snapshot.quotes.has(symbol))) { clearTimeout(timer); void poll(); }
  return () => {
    for (const symbol of unique) {
      const count = (registry.get(symbol) ?? 1) - 1;
      if (count <= 0) registry.delete(symbol); else registry.set(symbol, count);
    }
  };
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

export function useLiveQuotes(symbols: ReadonlyArray<string>): LiveQuotes {
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => (key ? registerLiveSymbols(key.split(",")) : undefined), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Age label for a quote that is older than it should be while trading ("3 min old"), else null. */
export function staleLabel(quote: Quote | undefined, live: boolean, now = Date.now()): string | null {
  if (!quote || !live) return null;
  const age = now - quote.timestamp;
  return age > 120_000 ? `${Math.round(age / 60_000)} min old` : null;
}
