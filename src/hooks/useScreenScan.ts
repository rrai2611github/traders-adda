"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenName } from "@/lib/screen/criteria";
import type { RpciApproxResult } from "@/lib/screen/rpciApprox";
import type { MomentumResult } from "@/lib/screen/oscillators";
import type { OscillatorScore } from "@/lib/screen/oscillatorScore";
import type { RsiEdgeFacts } from "@/lib/screen/rsiEdgeScans";
import type { RelativeVolume, RiskFlag } from "@/lib/screen/riskFlags";
import type { PriceActionRating } from "@/lib/screen/priceActionRating";
import type { DataHealth } from "@/lib/market/historyQuality";

const POLL_MS = 30_000;
const WARMING_POLL_MS = 5_000;

export type ScanStage = "forming" | "breakout" | "climbing" | "played-out";

export interface ScanRow {
  /** Unique per row: a stock can sit in more than one stage at once. */
  key: string;
  symbol: string;
  name: string;
  /** False for names only the wider screen floor lists (thinner than the trading floor). */
  liquid?: boolean;
  /** NSE series; "BE" is trade-for-trade (delivery only). */
  series?: "EQ" | "BE";
  sector?: string;
  price: number;
  changePercent: number;
  rs: number | null;
  ext: number | null;
  vs50: number | null;
  vs200: number | null;
  fromHigh: number | null;
  aboveLow: number | null;
  coil: number | null;
  dry: number | null;
  /** Up/down volume, net, across the base: +1 all buying, -1 all selling. */
  obv: number | null;
  udBase: number | null;
  baseWk: number | null;
  baseDepth: number | null;
  listedWk: number | null;
  level: number | null;
  turnoverCr: number | null;
  mcap: number | null;
  pivotPrice: number | null;
  stage: ScanStage | null;
  /** Days in the base whose high poked above the pivot but closed back under. */
  squats: number;
  /** Closes above the pivot that fell back inside the base within 10 sessions. */
  failedPokes: number;
  baseStartTimestamp: number | null;
  breakoutReturn: number | null;
  exitReason: string | null;
  exitTimestamp: number | null;
  breakoutVolume: number | null;
  closeInRange: number | null;
  breakoutTimestamp: number | null;
  /** RS on the breakout day, which screens judge a breakout on. */
  entryRs: number | null;
  /** History-line inputs per screen ("all" when unscreened): only breakouts that passed the screen count. */
  history: Record<"all" | ScreenName, RowHistory>;
  badges: string[];
  screens: ScreenName[];
  rpciApprox: RpciApproxResult | null;
  momentum: MomentumResult | null;
  oscillatorScore: OscillatorScore | null;
  /** Local daily/weekly facts shown alongside authoritative RSI Edge source results. */
  rsiEdge: RsiEdgeFacts | null;
  quoteTimestamp: number | null;
  /** Session volume vs the 50-session average; projected to a full day while live. */
  rvol?: RelativeVolume | null;
  riskFlags?: RiskFlag[];
  /** Price Action Rating 0–100; absent from older cached payloads. */
  paRating?: PriceActionRating;
}

export interface RowHistory {
  /** The last counted breakout's result, compounded through any rebases, when it played out. */
  previous: { retPct: number; exitTimestamp: number | null } | null;
  /** This row is the Nth counted base of one run (N ≥ 2). */
  run: { bases: number; firstTimestamp: number; gainPct: number } | null;
}

export type FeedType =
  | "breakout"
  | "inner_breakout"
  | "failed_poke"
  | "played_out"
  | "milestone_10"
  | "milestone_20"
  | "now_climbing"
  | "squat"
  | "base_born";

/** One thing that changed on the latest session. */
export interface FeedEvent {
  type: FeedType;
  symbol: string;
  name: string;
  price: number;
  pivot: number;
  screens: ScreenName[];
  ext?: number;
  volumeRatio?: number | null;
  retPct?: number;
  why?: string | null;
  nth?: number;
  sinceTimestamp?: number;
  breakoutTimestamp?: number;
  baseWk?: number;
  baseDepth?: number;
  /** Base nesting level of a breakout (1 = outermost). */
  level?: number;
}

export interface ScreenScan extends DataHealth {
  updatedAt: number;
  sessionDateKey: string;
  marketOpen: boolean;
  source: { id: string; label: string; isRealtime: boolean };
  scanned: number;
  /** Symbols whose quote or daily history the provider could not return this scan. */
  unavailable: string[];
  /** Symbols with too few daily candles to measure (typically new listings). */
  insufficientHistory?: string[];
  universe: { source: string; generatedAt: string; count: number; total: number };
  eligible: number;
  /** One row per tradable stock, at its primary stage. */
  rows: ScanRow[];
  /**
   * Every row before a universe filter (Nifty 50, F&O, …) was applied. Market
   * breadth and regime always use these, so a filter never changes ratings.
   */
  marketRows?: ScanRow[];
  /** Further stage rows: bases built mid-run and this year's played-out breakouts. */
  extraRows?: ScanRow[];
  /** Calendar year the played-out list covers. */
  playedOutYear?: number;
  /** Played-out lists and history lines cover breakouts from this date (YYYY-MM-DD). */
  playedOutSince?: string;
  /** IST date (YYYY-MM-DD) of the session the feed describes. */
  feedDay?: string | null;
  feed?: FeedEvent[];
}

/**
 * Polls the live universe scan that decides screen membership and stage.
 *
 * The scan is expensive (a few hundred candles per symbol), so the server
 * caches it; polling only has to be frequent enough to track the tape.
 */
export function useScreenScan(): { scan: ScreenScan | null; error: boolean; loadingMessage: string | null } {
  const [scan, setScan] = useState<ScreenScan | null>(null);
  const [error, setError] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      let delay = POLL_MS;
      try {
        const response = await fetch("/api/market/screen", { cache: "no-store" });
        if (response.status === 503) {
          const body = (await response.json().catch(() => null)) as { warming?: boolean; error?: string } | null;
          if (body?.warming) {
            if (alive.current) {
              setLoadingMessage(body.error ?? "Loading the NSE universe.");
              setError(false);
            }
            delay = WARMING_POLL_MS;
            return;
          }
        }
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as ScreenScan;
        if (!alive.current) return;
        setScan(payload);
        setError(false);
        setLoadingMessage(null);
      } catch {
        if (alive.current) setError(true);
      } finally {
        if (alive.current) timer = setTimeout(load, delay);
      }
    };

    void load();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return useMemo(() => ({ scan, error, loadingMessage }), [scan, error, loadingMessage]);
}
