/**
 * RS ratings (1 to 99) are a percentile rank among the tradable stocks. A thinner stock that the screens also list has no
 * place in that ranking, but it still needs a rating on the same scale: where its score would have landed among the
 * tradable scores. Adding it must never move anyone else's rating.
 */

/** Ratings for `scores`, ranked among themselves (the tradable stocks): percentile mapped onto 1 to 99. */
export function rankToRs(scores: ReadonlyArray<number>): number[] {
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score);
  const out: number[] = new Array(scores.length).fill(1);
  order.forEach((entry, rank) => {
    const percentile = order.length === 1 ? 1 : rank / (order.length - 1);
    out[entry.index] = Math.max(1, Math.min(99, Math.round(1 + percentile * 98)));
  });
  return out;
}

/** `sortedScores` ascending. The share of tradable scores below `score`, mapped onto 1 to 99 like `rankToRs`. */
export function rsAmong(sortedScores: ReadonlyArray<number>, score: number): number {
  const n = sortedScores.length;
  if (n === 0) return 1;
  if (n === 1) return score > sortedScores[0] ? 99 : 1;
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedScores[mid] < score) low = mid + 1;
    else high = mid;
  }
  // `low` stocks score below this one; they would occupy ranks 0..low-1, so it lands at rank `low` of n.
  const percentile = Math.min(1, low / (n - 1));
  return Math.max(1, Math.min(99, Math.round(1 + percentile * 98)));
}
