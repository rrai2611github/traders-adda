import { SCREEN_NAMES, matchesScreenName, type FactorValues, type ScreenName } from "./criteria.ts";

/**
 * A stock can be building several bases at once: a short one inside a year-long one. BananaPatterns lists a stock on a
 * screen if any one of its bases passes ("2 bases match"), so each base is judged on its own facts. This decides, for
 * the bases being built, which screen each one answers for.
 */
export interface BaseJudgement<B> {
  candidate: B;
  /** Screens this base satisfies on its own facts. */
  screens: ScreenName[];
  /** The subset it is the first (innermost) to satisfy, so each screen lists the stock once. */
  claimed: ScreenName[];
}

/**
 * `candidates` must be ordered innermost first. Each screen is claimed by the first base that satisfies it, unless it is
 * already covered (for example by the stock's main row).
 */
export function judgeBases<B>(
  candidates: ReadonlyArray<B>,
  valuesOf: (candidate: B) => FactorValues,
  alreadyCovered: ReadonlyArray<ScreenName> = [],
): BaseJudgement<B>[] {
  const covered = new Set<ScreenName>(alreadyCovered);
  return candidates.map((candidate) => {
    const values = valuesOf(candidate);
    const screens = SCREEN_NAMES.filter((name) => matchesScreenName(values, name));
    const claimed = screens.filter((name) => !covered.has(name));
    for (const name of claimed) covered.add(name);
    return { candidate, screens, claimed };
  });
}
