import type { Candle } from "../market/types.ts";
import { PA_RULES, priceActionRating, type PriceActionRating } from "./priceActionRating.ts";

/**
 * Reference rating for stocks below the liquidity floor but trading at least
 * ₹1 Cr a day (PA_RULES.illiquidBelowCr). Display only: such stocks never get a
 * Buy/Short status, trade levels, picks or emails, and they are not added to
 * the RS universe, so every liquid stock's RS stays unchanged.
 */
export interface ReferenceRating {
  symbol: string;
  /** Where the stock's performance would rank among liquid stocks, 1-99. */
  rs: number | null;
  paRating: PriceActionRating;
  turnoverCr: number | null;
}

/** 1-99 position of `score` within the liquid universe's scores (same scale as rankToRs). */
export function rsAgainst(score: number | null, liquidScores: ReadonlyArray<number>): number | null {
  if (score == null || !Number.isFinite(score) || liquidScores.length < 2) return null;
  let below = 0;
  let equal = 0;
  for (const value of liquidScores) {
    if (value < score) below += 1;
    else if (value === score) equal += 1;
  }
  // An exact match takes that stock's rank; a value between two stocks sits halfway.
  const position = Math.max(0, Math.min(liquidScores.length - 1, below + (equal - 1) / 2));
  const percentile = position / (liquidScores.length - 1);
  return Math.max(1, Math.min(99, Math.round(1 + percentile * 98)));
}

export function referenceRating(
  symbol: string,
  candles: ReadonlyArray<Candle>,
  turnoverCr: number | null,
  score: number | null,
  liquidScores: ReadonlyArray<number>,
): ReferenceRating | null {
  if (turnoverCr == null || turnoverCr < PA_RULES.illiquidBelowCr) return null;
  return { symbol, rs: rsAgainst(score, liquidScores), paRating: priceActionRating(candles, turnoverCr), turnoverCr };
}
