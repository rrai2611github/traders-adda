import { VISIBLE_SCANNER_KEYS, type ScannerKey } from "./screen/chartinkScans.ts";
import { RSI_EDGE_SCAN_KEYS, type RsiEdgeScanKey } from "./screen/rsiEdgeSource.ts";
import type { DashboardMetric } from "./screen/dashboardMetrics";

export type MarketMenuKey = "breakouts" | "breadth" | "rotation" | "sectors" | "map";
export type ActiveNavKey = "today" | "monthly" | "bottomed" | "metrics" | "research" | "directory" | "picks" | "screens" | "signals" | "scanners" | "rsi-edge" | "market" | "watchlist" | "journal" | "learn";

/** Everything needed to reproduce a view from a shared link. */
export interface AppRoute {
  nav: ActiveNavKey;
  scanner: ScannerKey;
  market: MarketMenuKey;
  rsiEdge: RsiEdgeScanKey;
  stock: string | null;
  metric: DashboardMetric;
}

export const DEFAULT_ROUTE: AppRoute = {
  nav: "today",
  scanner: "range",
  market: "breakouts",
  rsiEdge: "daily-bullish",
  stock: null,
  metric: "above50",
};

const MARKET_SLUGS: Record<MarketMenuKey, string> = {
  breakouts: "breakouts",
  breadth: "breadth",
  rotation: "rotation",
  sectors: "sectors",
  map: "heatmap",
};

const SIMPLE_HASHES: Partial<Record<ActiveNavKey, string>> = {
  picks: "picks",
  screens: "setups",
  signals: "signals",
  watchlist: "watchlist",
  journal: "journal",
  learn: "about",
  research: "research",
  monthly: "monthly-setups",
  bottomed: "bottomed-out",
  directory: "scanner-directory",
};

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9&_.-]{0,24}$/;

export function normalizeSymbol(value: string | null | undefined): string | null {
  const symbol = (value ?? "").trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

/** Reads a route from `location.hash` and `location.search`. Unknown parts fall back to defaults. */
export function parseRoute(hash: string, search: string, base: AppRoute = DEFAULT_ROUTE): AppRoute {
  const slug = decodeURIComponent(hash.replace(/^#\/?/, "")).toLowerCase();
  const stock = normalizeSymbol(new URLSearchParams(search).get("stock"));
  const route: AppRoute = { ...base, nav: "today", stock };

  const simple = (Object.entries(SIMPLE_HASHES) as [ActiveNavKey, string][]).find(([, value]) => value === slug);
  if (simple) return { ...route, nav: simple[0] };
  if (slug.startsWith("metric-")) {
    const metric = slug.slice("metric-".length);
    const metrics: DashboardMetric[] = ["above50", "above200", "advancing", "buyReady", "shortReady"];
    const match = metrics.find((key) => key.toLowerCase() === metric);
    return match ? { ...route, nav: "metrics", metric: match } : route;
  }

  if (slug.startsWith("scanner-")) {
    const key = slug.slice("scanner-".length);
    if ((VISIBLE_SCANNER_KEYS as string[]).includes(key)) return { ...route, nav: "scanners", scanner: key as ScannerKey };
    return route;
  }
  if (slug === "rsi-edge" || slug.startsWith("rsi-edge-")) {
    const key = slug.slice("rsi-edge-".length);
    const rsiEdge = (RSI_EDGE_SCAN_KEYS as string[]).includes(key) ? (key as RsiEdgeScanKey) : DEFAULT_ROUTE.rsiEdge;
    return { ...route, nav: "rsi-edge", rsiEdge };
  }
  if (slug === "market" || slug.startsWith("market-")) {
    const key = slug.slice("market-".length);
    const market = (Object.entries(MARKET_SLUGS) as [MarketMenuKey, string][]).find(([, value]) => value === key)?.[0];
    return { ...route, nav: "market", market: market ?? DEFAULT_ROUTE.market };
  }
  return route;
}

/** Hash for the page part of a route (no `#` for Today). */
export function routeHash(route: AppRoute): string {
  switch (route.nav) {
    case "today":
      return "";
    case "metrics":
      return `#metric-${route.metric.toLowerCase()}`;
    case "scanners":
      return `#scanner-${route.scanner}`;
    case "rsi-edge":
      return `#rsi-edge-${route.rsiEdge}`;
    case "market":
      return `#market-${MARKET_SLUGS[route.market]}`;
    default:
      return `#${SIMPLE_HASHES[route.nav]}`;
  }
}

/** Full relative URL for a route, keeping any unrelated query parameters. */
export function routeUrl(route: AppRoute, pathname: string, currentSearch = ""): string {
  const params = new URLSearchParams(currentSearch);
  if (route.stock) params.set("stock", route.stock);
  else params.delete("stock");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${routeHash(route)}`;
}
