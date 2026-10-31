import test from "node:test";
import assert from "node:assert/strict";
import { measureHighBreakout, niftyReturn65, rankHighBreakouts, highBreakoutsVisible } from "../src/lib/screen/highBreakout.ts";

const DAY = 86400e3;
/** 300 sessions: steady rise, a 20-day flat base, then a final bar given by `last`. */
function series(last) {
  const c = [];
  for (let i = 0; i < 279; i++) { const p = 100 + i * 0.5; c.push({ t: i * DAY, open: p, high: p + 1, low: p - 1, close: p, volume: 100_000 }); }
  for (let i = 279; i < 299; i++) c.push({ t: i * DAY, open: 239, high: 240, low: 236, close: 238, volume: 80_000 });
  c.push({ t: 299 * DAY, open: 239, high: last.close + 1, low: 238, close: last.close, volume: last.volume });
  return c;
}

test("confirmed breakout needs a close over the base high, 1.5x volume and beating Nifty", () => {
  const hit = measureHighBreakout(series({ close: 243, volume: 200_000 }), 0.02);
  assert.equal(hit.screened, true);
  assert.ok(hit.pick);
  assert.equal(hit.pick.baseHigh, 240);
  assert.equal(hit.pick.tightBase, true);
  assert.ok(hit.pick.volumeRatio >= 1.5);

  const lowVolume = measureHighBreakout(series({ close: 243, volume: 100_000 }), 0.02);
  assert.deepEqual(lowVolume, { screened: true, pick: null });
  const inBase = measureHighBreakout(series({ close: 239, volume: 200_000 }), 0.02);
  assert.deepEqual(inBase, { screened: true, pick: null });
  const lagsNifty = measureHighBreakout(series({ close: 243, volume: 200_000 }), 5);
  assert.deepEqual(lagsNifty, { screened: true, pick: null });
  const noNifty = measureHighBreakout(series({ close: 243, volume: 200_000 }), null);
  assert.deepEqual(noNifty, { screened: true, pick: null });
});

test("screen rejects far-from-high, short history and cheap stocks", () => {
  assert.deepEqual(measureHighBreakout(series({ close: 200, volume: 200_000 }), 0), { screened: false });
  assert.deepEqual(measureHighBreakout(series({ close: 243, volume: 200_000 }).slice(-200), 0), { screened: false });
  const cheap = series({ close: 243, volume: 200_000 }).map((k) => ({ ...k, open: k.open / 3, high: k.high / 3, low: k.low / 3, close: k.close / 3 }));
  assert.deepEqual(measureHighBreakout(cheap, 0), { screened: false });
});

test("nifty return, ranking and breadth gate", () => {
  const nifty = Array.from({ length: 70 }, (_, i) => ({ t: i * DAY, open: 0, high: 0, low: 0, close: 100 + i, volume: 0 }));
  assert.equal(niftyReturn65(nifty, 69 * DAY), 169 / 104 - 1);
  assert.equal(niftyReturn65(nifty.slice(0, 10), 9 * DAY), null);
  assert.equal(niftyReturn65(null, 0), null);
  const a = { tightBase: false, volumeRatio: 4 }, b = { tightBase: true, volumeRatio: 1.6 }, c = { tightBase: true, volumeRatio: 2 };
  assert.deepEqual([a, b, c].sort(rankHighBreakouts), [c, b, a]);
  assert.equal(highBreakoutsVisible(50), true);
  assert.equal(highBreakoutsVisible(49.9), false);
  assert.equal(highBreakoutsVisible(null), false);
});
