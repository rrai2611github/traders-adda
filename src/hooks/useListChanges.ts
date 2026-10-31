"use client";

import { useEffect, useMemo, useState } from "react";
import { diffList, rollListMemory, type ListChanges, type ListMemory } from "@/lib/listChanges";

const KEY = "traders-adda:list-memory:";
const istDay = (now: number) => Math.floor((now + 19_800_000) / 86_400_000);

const read = (listId: string): ListMemory | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY + listId) ?? "null") as ListMemory | null;
    return parsed && Array.isArray(parsed.current) ? parsed : null;
  } catch {
    return null;
  }
};

const EMPTY: ListChanges = { hasBaseline: false, since: null, added: new Set(), dropped: [] };

/**
 * New and dropped stocks against the last day this browser saw the list. Pass null while the list is still
 * loading so an empty first render never overwrites the memory. Stored per browser; it never leaves it.
 */
export function useListChanges(listId: string, symbols: ReadonlyArray<string> | null): ListChanges {
  const [memory, setMemory] = useState<ListMemory | null>(null);
  const signature = symbols ? symbols.join(",") : null;

  useEffect(() => {
    if (signature == null) return;
    const list = signature ? signature.split(",") : [];
    const next = rollListMemory(read(listId), istDay(Date.now()), list);
    try { localStorage.setItem(KEY + listId, JSON.stringify(next)); } catch { /* private window: the tags just stay off */ }
    const id = setTimeout(() => setMemory(next), 0);
    return () => clearTimeout(id);
  }, [listId, signature]);

  return useMemo(() => (signature == null || !memory ? EMPTY : diffList(memory, signature ? signature.split(",") : [])), [memory, signature]);
}

/** "since 16 Oct" for the day number a baseline was taken. */
export const sinceLabel = (since: number | null) =>
  since == null ? "" : new Date(since * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
