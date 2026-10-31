import indexUniverses from "./data/index-universes.json";
import { UNIVERSE_OPTIONS, type UniverseKey } from "../screen/universeFilter.ts";

export { UNIVERSE_OPTIONS, type UniverseKey };

/**
 * Index and F&O membership snapshot (`npm run update-universe` regenerates
 * `data/index-universes.json` from niftyindices.com and NSE's F&O lot file).
 */
const SETS: Record<Exclude<UniverseKey, "all">, Set<string>> = {
  nifty50: new Set(indexUniverses.nifty50),
  nifty100: new Set(indexUniverses.nifty100),
  nifty200: new Set(indexUniverses.nifty200),
  nifty500: new Set(indexUniverses.nifty500),
  fno: new Set(indexUniverses.fno),
};

export const INDEX_UNIVERSES_AS_OF = indexUniverses.generatedAt;

export function universeSize(key: UniverseKey): number | null {
  return key === "all" ? null : SETS[key].size;
}

/** Predicate for a universe; `null` means no filtering (All NSE). */
export function universePredicate(key: UniverseKey): ((symbol: string) => boolean) | null {
  if (key === "all") return null;
  const set = SETS[key];
  return (symbol) => set.has(symbol.replace(/^NSE:/, "").toUpperCase());
}

/** True when the stock has single-stock futures and options on NSE (positional shorts possible). */
export function isFnO(symbol: string): boolean {
  return SETS.fno.has(symbol.replace(/^NSE:/, "").toUpperCase());
}
