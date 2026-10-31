import test from "node:test";
import assert from "node:assert/strict";
import { resolveTicker } from "../src/lib/market/providers/yahooTickers.ts";

test("Yahoo index symbols use the current finance tickers", () => {
  assert.equal(resolveTicker("NIFTY50"), "^NSEI");
  assert.equal(resolveTicker("BANKNIFTY"), "^NSEBANK");
  assert.equal(resolveTicker("NIFTYMIDCAP"), "NIFTY_MIDCAP_100.NS");
  assert.equal(resolveTicker("NIFTYIT"), "^CNXIT");
  assert.equal(resolveTicker("INDIAVIX"), "^INDIAVIX");
});
