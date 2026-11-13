/** Sidebar match counts returned by `/api/market/nav-counts`. */
export type NavCountKey = "scanners" | "rsi-edge" | "monthly" | "bottomed";

export interface NavCounts {
  updatedAt: number;
  /** Whole-market figures; null while that result set is still loading or unavailable. */
  counts: Record<NavCountKey, number | null>;
}

/** Change against the counts seen on the previous visit; null when there is nothing to compare. */
export type NavCountDeltas = Partial<Record<NavCountKey, number>>;

export const NAV_COUNT_HINT: Record<NavCountKey, string> = {
  scanners: "liquid stocks matching at least one trade trigger (whole NSE, last completed candle)",
  "rsi-edge": "stocks on at least one RSI Edge scan",
  monthly: "liquid stocks with a monthly breakout or a tight monthly range",
  bottomed: "fallen stocks with a higher low",
};

export function navCountDeltas(
  current: NavCounts["counts"] | null,
  baseline: Partial<NavCounts["counts"]> | null,
): NavCountDeltas {
  const deltas: NavCountDeltas = {};
  if (!current || !baseline) return deltas;
  for (const key of Object.keys(current) as NavCountKey[]) {
    const now = current[key];
    const before = baseline[key];
    if (now != null && before != null && now !== before) deltas[key] = now - before;
  }
  return deltas;
}
