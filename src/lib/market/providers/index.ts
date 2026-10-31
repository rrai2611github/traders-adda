import { fyersProvider } from "./fyers";
import { kiteProvider } from "./kite";
import { mockProvider } from "./mock";
import { yahooProvider } from "./yahoo";
import type { MarketDataProvider } from "./types";

export type {
  MarketDataProvider,
  QuoteErrorListener,
  QuoteListener,
  Unsubscribe,
} from "./types";

/**
 * Resolves the active data source from `MARKET_PROVIDER`.
 *
 * Kite is selected only when both credentials are present. Otherwise the
 * active source is explicitly Yahoo Finance, so the surfaced attribution
 * matches the provider serving the data.
 */
function createProvider(): MarketDataProvider {
  const id = (process.env.MARKET_PROVIDER ?? "yahoo").toLowerCase();

  switch (id) {
    case "mock":
      return mockProvider;
    case "yahoo":
      return yahooProvider;
    case "fyers":
      // Live Fyers quotes while today's login is active; Yahoo otherwise.
      return fyersProvider;
    case "kite":
      if (process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN) {
        return kiteProvider;
      }
      return yahooProvider;
    default:
      throw new Error(
        `Unknown MARKET_PROVIDER "${id}". Register an adapter in src/lib/market/providers/index.ts.`,
      );
  }
}

// Next.js dev mode re-evaluates modules on hot reload; caching on globalThis
// keeps a single provider (and therefore a single upstream connection) alive.
const globalRef = globalThis as typeof globalThis & {
  __marketProvider?: MarketDataProvider;
};

export function getProvider(): MarketDataProvider {
  if (!globalRef.__marketProvider || typeof globalRef.__marketProvider.getDailyCandles !== "function") {
    globalRef.__marketProvider = createProvider();
  }
  return globalRef.__marketProvider;
}
