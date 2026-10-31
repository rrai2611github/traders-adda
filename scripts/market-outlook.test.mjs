import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketOutlook, compareGift } from "../src/lib/screen/marketOutlook.ts";
import { parseGiftScan } from "../src/lib/market/giftNifty.ts";
import { priorSessionClose } from "../src/lib/market/priorClose.ts";

const level = (key, close, pivot) => ({ key, label: key, close, changePercent: 1, pivot, support1: pivot - 150, support2: pivot - 300, resistance1: pivot + 150, resistance2: pivot + 300, zone: "" });
const NIFTY = level("nifty", 22000, 22000);
const gift = (price) => ({ price, changePercent: 1, changePoints: 100, asOf: 0, source: "test" });
const bias = (score) => ({ key: "flat", label: "x", score, summary: "", components: [] });
const cue = (key, changePercent) => ({ key, label: key, group: "us", price: 1, previousClose: 1, changePercent, asOf: 0 });
const idx = (daily, weekly, breadth50) => ({ dailyTrend: daily, weeklyTrend: weekly, breadth50 });

test("priorSessionClose uses the last candle while the live session has no close yet", () => {
  const candles = [{ t: Date.parse("2026-10-08T00:00:00Z"), close: 6625.9 }, { t: Date.parse("2026-10-12T00:00:00Z"), close: 6384.2 }];
  // Kospi trading on the 13th: its own candle is missing, so the prior session is the 12th.
  assert.equal(priorSessionClose(candles, Date.parse("2026-10-13T05:00:00Z")), 6384.2);
  // After the 13th has a close the prior session is the 12th again (one candle back).
  const done = [...candles, { t: Date.parse("2026-10-13T00:00:00Z"), close: 6035 }];
  assert.equal(priorSessionClose(done, Date.parse("2026-10-13T06:30:00Z")), 6384.2);
  assert.equal(priorSessionClose([], 1), null);
});

test("GIFT Nifty scanner payload is parsed and anything unexpected returns null", () => {
  const ok = { data: [{ s: "NSEIX:NIFTY1!", d: ["NIFTY1!", "GIFT NIFTY 50 INDEX FUTURES", 22744.5, 1.6718, 374, "streaming"] }] };
  assert.deepEqual({ ...parseGiftScan(ok, 5), source: "" }, { price: 22744.5, changePercent: 1.67, changePoints: 374, asOf: 5, source: "" });
  assert.equal(parseGiftScan({ data: [] }, 1), null);
  assert.equal(parseGiftScan({ data: [{ s: "NSEIX:NIFTY1!", d: ["NIFTY1!", "x", null, 1, 1] }] }, 1), null);
  assert.equal(parseGiftScan(null, 1), null);
});

test("GIFT vs global tone: confirms, diverges, flat against a move, leads, flat", () => {
  assert.equal(compareGift(gift(22100), 22000, 0.6, NIFTY).verdict, "confirms");
  assert.equal(compareGift(gift(21900), 22000, 0.6, NIFTY).verdict, "diverges");
  const flatVsMove = compareGift(gift(22010), 22000, -0.7, NIFTY);
  assert.equal(flatVsMove.verdict, "flat-vs-move");
  assert.match(flatVsMove.text, /not following the global move/);
  assert.equal(compareGift(gift(22100), 22000, 0.05, NIFTY).verdict, "leads");
  assert.equal(compareGift(gift(22010), 22000, 0.05, NIFTY).verdict, "flat");
  const c = compareGift(gift(22100), 22000, 0.6, NIFTY);
  assert.equal(c.gapPoints, 100);
  assert.match(c.levelNote, /between S1|between the pivot 22,000 and R1 22,150/);
});

test("market outlook adds up point scores into Bullish, Bearish or Neutral", () => {
  const bearish = buildMarketOutlook({
    gift: gift(22010), bias: bias(-0.9), cues: [cue("indiavix", 1)], levels: [NIFTY],
    indexes: { NIFTY50: idx("Weak", "Weak", 20) },
  });
  // gift 0, tone -2, trend -1 -1, breadth -2, vix 0
  assert.equal(bearish.score, -6);
  assert.equal(bearish.label, "Bearish");
  assert.equal(bearish.conviction, "High");
  assert.match(bearish.summary, /^Bearish: /);

  const bullish = buildMarketOutlook({
    gift: gift(22200), bias: bias(0.9), cues: [cue("indiavix", -8)], levels: [NIFTY],
    indexes: { NIFTY50: idx("Constructive", "Constructive", 80) },
  });
  assert.equal(bullish.label, "Bullish");
  assert.ok(bullish.score >= 3);

  const mixed = buildMarketOutlook({ gift: gift(22000), bias: bias(0.1), cues: [], levels: [NIFTY], indexes: { NIFTY50: idx("Weak", "Constructive", 50) } });
  assert.equal(mixed.label, "Neutral");
  assert.equal(mixed.conviction, "Low");
});

test("without GIFT Nifty the outlook still works and says nothing about it", () => {
  const out = buildMarketOutlook({ gift: null, bias: bias(-0.9), cues: [], levels: [NIFTY], indexes: { NIFTY50: idx("Weak", "Weak", 20) } });
  assert.equal(out.gift, null);
  assert.ok(!out.drivers.some((d) => d.label === "GIFT Nifty"));
  assert.equal(out.label, "Bearish");
});

test("each index uses its own drivers: IT follows Nasdaq and the rupee, Bank Nifty the rupee the other way", () => {
  const out = buildMarketOutlook({
    gift: gift(22000), bias: bias(0), cues: [cue("nasdaq", 1.2), cue("usdinr", 0.5)], levels: [NIFTY],
    indexes: { NIFTY50: idx("Weak", "Weak", 30), BANKNIFTY: idx("Weak", "Mixed", 20), NIFTYIT: idx("Constructive", "Mixed", 60), NIFTYMIDCAP: { breadth50: 20 } },
  });
  const by = Object.fromEntries(out.indexes.map((i) => [i.key, i]));
  assert.ok(by.NIFTYIT.drivers.find((d) => d.label === "Nasdaq").points === 2);
  assert.ok(by.NIFTYIT.drivers.find((d) => d.label === "USD/INR").points > 0);
  assert.ok(by.BANKNIFTY.drivers.find((d) => d.label === "USD/INR").points < 0);
  assert.equal(by.NIFTYIT.label, "Bullish");
  assert.equal(by.BANKNIFTY.label, "Bearish");
  assert.equal(by.NIFTYMIDCAP.drivers.length, 2, "midcap: GIFT and breadth only (no VIX cue, no trend history)");
});
