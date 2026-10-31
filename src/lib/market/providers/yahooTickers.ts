const INDEX_TICKERS: Record<string, string> = {
  NIFTY50: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  NIFTYMIDCAP: "NIFTY_MIDCAP_100.NS",
  NIFTYIT: "^CNXIT",
  INDIAVIX: "^INDIAVIX",
};

export function resolveTicker(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("^") || upper.includes(".")) return upper;
  return INDEX_TICKERS[upper] ?? `${upper}.NS`;
}
