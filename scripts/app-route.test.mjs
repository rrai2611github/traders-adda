import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROUTE, normalizeSymbol, parseRoute, routeHash, routeUrl } from "../src/lib/appRoute.ts";

test("empty URL is Today with no stock", () => {
  assert.deepEqual(parseRoute("", ""), DEFAULT_ROUTE);
});

test("every page round-trips through its hash", () => {
  const routes = [
    { nav: "today" },
    { nav: "research" },
    { nav: "directory" },
    { nav: "monthly" },
    { nav: "bottomed" },
    ...["above50", "above200", "advancing", "buyReady", "shortReady"].map(metric => ({ nav: "metrics", metric })),
    { nav: "screens" },
    { nav: "signals" },
    { nav: "watchlist" },
    { nav: "learn" },
    { nav: "scanners", scanner: "nr7" },
    { nav: "rsi-edge", rsiEdge: "weekly-bullish" },
    { nav: "rsi-edge", rsiEdge: "bearish" },
    { nav: "market", market: "map" },
    { nav: "market", market: "rotation" },
  ];
  for (const partial of routes) {
    const route = { ...DEFAULT_ROUTE, ...partial };
    assert.deepEqual(parseRoute(routeHash(route), ""), route, routeHash(route));
  }
});

test("readable hashes", () => {
  assert.equal(routeHash({ ...DEFAULT_ROUTE, nav: "market", market: "map" }), "#market-heatmap");
  assert.equal(routeHash({ ...DEFAULT_ROUTE, nav: "screens" }), "#setups");
  assert.equal(routeHash({ ...DEFAULT_ROUTE, nav: "learn" }), "#about");
  assert.equal(routeHash(DEFAULT_ROUTE), "");
});

test("legacy #scanner-* and #signals links still work", () => {
  assert.equal(parseRoute("#scanner-range", "").nav, "scanners");
  assert.equal(parseRoute("#signals", "").nav, "signals");
});

test("unknown or hidden values fall back safely", () => {
  assert.equal(parseRoute("#nonsense", "").nav, "today");
  assert.equal(parseRoute("#metric-invalid", "").nav, "today");
  assert.equal(parseRoute("#scanner-doesnotexist", "").nav, "today");
  const rsi = parseRoute("#rsi-edge-xyz", "");
  assert.equal(rsi.nav, "rsi-edge");
  assert.equal(rsi.rsiEdge, "daily-bullish");
  assert.equal(parseRoute("#market-xyz", "").market, "breakouts");
});

test("stock comes from ?stock= and is validated", () => {
  assert.equal(parseRoute("#watchlist", "?stock=reliance").stock, "RELIANCE");
  assert.equal(parseRoute("", "?stock=M%26M").stock, "M&M");
  assert.equal(parseRoute("", "?stock=BAJAJ-AUTO").stock, "BAJAJ-AUTO");
  assert.equal(parseRoute("", "?stock=%3Cscript%3E").stock, null);
  assert.equal(normalizeSymbol(""), null);
});

test("routeUrl encodes the stock and keeps unrelated query parameters", () => {
  const route = { ...DEFAULT_ROUTE, nav: "rsi-edge", rsiEdge: "bearish", stock: "M&M" };
  assert.equal(routeUrl(route, "/", "?ref=mail"), "/?ref=mail&stock=M%26M#rsi-edge-bearish");
  assert.equal(routeUrl({ ...route, stock: null }, "/", "?stock=TCS"), "/#rsi-edge-bearish");
  assert.equal(routeUrl(DEFAULT_ROUTE, "/", ""), "/");
});
