"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenName } from "@/lib/screen/criteria";

const POLL_MS = 60_000;

export interface BreakoutEvent {
  /** Session date as YYYY-MM-DD in IST. */
  d: string;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  breakoutDayGain: number;
  nowVsPivot: number | null;
  rs: number | null;
  breakoutVolume: number | null;
  closeInRange: number | null;
  medianTurnover: number | null;
  marketCap: number | null;
  industry: string;
  subgroup: string;
  tags: ScreenName[];
}

export interface BreakoutFeed {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  /** Symbols the provider could not return data for; excluded, not back-filled. */
  unavailable: string[];
  /** Sessions that had at least one breakout, oldest first. */
  days: string[];
  counts: Record<string, number>;
  events: BreakoutEvent[];
}

/**
 * Polls the market-wide breakout feed.
 *
 * This is deliberately separate from the screen scan: the feed counts every
 * stock that cleared its ceiling, regardless of which screen is selected.
 */
export function useBreakoutFeed(days = 5): BreakoutFeed | null {
  const [feed, setFeed] = useState<BreakoutFeed | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const response = await fetch(`/api/market/breakouts?days=${days}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as BreakoutFeed;
        if (alive.current) setFeed(payload);
      } catch {
        // Keep the last good feed rather than blanking the banner on a blip.
      } finally {
        if (alive.current) timer = setTimeout(load, POLL_MS);
      }
    };

    void load();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [days]);

  return feed;
}

/** The latest session in the feed, and how many names broke out on it. */
export function latestSession(feed: BreakoutFeed | null): { day: string; count: number } | null {
  if (!feed || !feed.days.length) return null;
  const day = feed.days[feed.days.length - 1];
  return { day, count: feed.counts[day] ?? 0 };
}
