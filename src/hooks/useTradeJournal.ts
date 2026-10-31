"use client";

import { useCallback, useEffect, useState } from "react";
import type { JournalEntry } from "@/lib/screen/tradeJournal";

const STORAGE_KEY = "sa.tradeJournal.v1";

function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.symbol === "string" && typeof v.entryPrice === "number"
    && typeof v.stop === "number" && typeof v.quantity === "number"
    && (v.status === "open" || v.status === "closed");
}

function read(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isJournalEntry) : [];
  } catch {
    return [];
  }
}

/** Trade journal persisted to localStorage, same hydration pattern as useWatchlist. */
export function useTradeJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Deliberately synchronous: see useAccountSize/useWatchlist for why this
    // runs in an effect rather than a lazy initial state (SSR hydration).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(read());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage can be unavailable (private mode, quota) — keep state in memory.
    }
  }, [entries, hydrated]);

  const add = useCallback((entry: Omit<JournalEntry, "id" | "status">) => {
    const id = `${entry.symbol}-${Date.now()}`;
    setEntries((current) => [{ ...entry, id, status: "open" }, ...current]);
    return id;
  }, []);

  const close = useCallback((id: string, exitPrice: number, exitDate: string) => {
    setEntries((current) => current.map((e) => (e.id === id ? { ...e, status: "closed", exitPrice, exitDate } : e)));
  }, []);

  const reopen = useCallback((id: string) => {
    setEntries((current) => current.map((e) => (e.id === id ? { ...e, status: "open", exitPrice: undefined, exitDate: undefined } : e)));
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((current) => current.filter((e) => e.id !== id));
  }, []);

  return { entries, add, close, reopen, remove };
}
