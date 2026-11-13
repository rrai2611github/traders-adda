"use client";

import { useEffect, useState } from "react";
import { navCountDeltas, type NavCountDeltas, type NavCounts } from "@/lib/navCounts";

const POLL_MS = 60_000;
/** Counts last shown in this browser; at the start of the next visit they become the comparison point. */
const SEEN_KEY = "traders-adda:nav-counts-seen";
/** Comparison point for this visit (one browser session), so moving between pages keeps the arrows. */
const BASELINE_KEY = "traders-adda:nav-counts-baseline";

function readJson(storage: Storage, key: string): Partial<NavCounts["counts"]> | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<NavCounts["counts"]>) : null;
  } catch {
    return null;
  }
}

/** The previous visit's counts, fixed for the whole of this visit. */
function visitBaseline(): Partial<NavCounts["counts"]> | null {
  try {
    const existing = sessionStorage.getItem(BASELINE_KEY);
    if (existing != null) return existing === "none" ? null : readJson(sessionStorage, BASELINE_KEY);
    const previous = localStorage.getItem(SEEN_KEY);
    sessionStorage.setItem(BASELINE_KEY, previous ?? "none");
    return previous ? (JSON.parse(previous) as Partial<NavCounts["counts"]>) : null;
  } catch {
    return null;
  }
}

function remember(counts: NavCounts["counts"]) {
  try {
    // Keep earlier figures for anything still loading, so a warm-up null never erases a known number.
    const merged = { ...(readJson(localStorage, SEEN_KEY) ?? {}) };
    for (const [key, value] of Object.entries(counts)) if (value != null) merged[key as keyof typeof merged] = value;
    localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
  } catch {
    // Private mode: arrows simply will not appear next time.
  }
}

/** Polls the sidebar counts once a minute while the tab is visible; a failed look keeps the last numbers. */
export function useNavCounts(): { counts: NavCounts["counts"] | null; deltas: NavCountDeltas } {
  const [counts, setCounts] = useState<NavCounts["counts"] | null>(null);
  const [baseline, setBaseline] = useState<Partial<NavCounts["counts"]> | null>(null);

  useEffect(() => {
    // Deliberately synchronous: the first client render must match the server (no arrows), so browser
    // storage is only read after mount (same hydration pattern as useWatchlist).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseline(visitBaseline());
    let alive = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/market/nav-counts", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as NavCounts;
        if (!alive) return;
        setCounts(body.counts);
        remember(body.counts);
      } catch {
        // Keep whatever is shown; the next poll tries again.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { counts, deltas: navCountDeltas(counts, baseline) };
}
