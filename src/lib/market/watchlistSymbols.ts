export const MAX_WATCHLIST_SYMBOLS = 200;

const RENAMED_SYMBOLS: Record<string, string> = { ZOMATO: "ETERNAL", TATAMOTORS: "TMPV" };

/** Screen rows label tickers as "NSE:XYZ"; the watchlist and stream use bare tickers. */
export function normalizeWatchlistSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase().replace(/^NSE:/, "");
  return RENAMED_SYMBOLS[upper] ?? upper;
}

export function normalizeWatchlistSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Watchlist symbols must be an array.");
  if (value.length > MAX_WATCHLIST_SYMBOLS) throw new Error(`A watchlist can contain at most ${MAX_WATCHLIST_SYMBOLS} symbols.`);

  const symbols = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new Error("Every watchlist symbol must be text.");
    const symbol = normalizeWatchlistSymbol(item);
    if (!/^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(symbol)) throw new Error(`Invalid watchlist symbol: ${item}`);
    symbols.add(symbol);
  }
  return [...symbols];
}
