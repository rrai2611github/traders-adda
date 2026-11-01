import test from "node:test";
import assert from "node:assert/strict";
import { buyPayload, floorToTick, fyersSymbol, orderTag, planFingerprint, sendBlocks } from "../src/lib/orders/fyersOrders.ts";

const o = (symbol, shares = 10, skipAbove = 105.07, invested = 1000) => ({ symbol, shares, skipAbove, invested });
const ok = { accountSize: 100_000, planDay: "2026-10-30", dataDay: "2026-10-30", killed: false };

test("a buy is a day limit order at the skip-above price, rounded down to the 5-paise step, for delivery", () => {
  const p = buyPayload(o("TCS", 7, 105.07), "2026-10-30", false);
  assert.deepEqual({ ...p, orderTag: undefined }, {
    symbol: "NSE:TCS-EQ", qty: 7, type: 1, side: 1, productType: "CNC", limitPrice: 105.05, stopPrice: 0, validity: "DAY", disclosedQty: 0, offlineOrder: false, orderTag: undefined,
  });
});

test("after the close the order is an after-market order", () => {
  assert.equal(buyPayload(o("TCS"), "2026-10-30", true).offlineOrder, true);
});

test("the limit is never above the rule's price", () => {
  for (const price of [99.99, 100.04, 250.01, 1234.567, 18.05]) assert.ok(floorToTick(price) <= price + 1e-9);
  assert.equal(floorToTick(18.05), 18.05);
});

test("symbols and tags are safe for the broker", () => {
  assert.equal(fyersSymbol("M&M"), "NSE:M&M-EQ");
  assert.equal(orderTag("2026-10-30", "BAJAJ-AUTO"), "TA261030BAJAJAUTO");
  assert.ok(orderTag("2026-10-30", "A_VERY_LONG_SYMBOL_NAME_HERE").length <= 20);
  assert.match(orderTag("2026-10-30", "M&M"), /^[A-Za-z0-9]+$/);
});

test("the fingerprint changes when anything about the orders changes", () => {
  const base = planFingerprint("2026-10-30", [o("AAA"), o("BBB")]);
  assert.equal(base, planFingerprint("2026-10-30", [o("AAA"), o("BBB")]));
  assert.notEqual(base, planFingerprint("2026-10-30", [o("AAA", 11), o("BBB")]));
  assert.notEqual(base, planFingerprint("2026-10-30", [o("AAA", 10, 106), o("BBB")]));
  assert.notEqual(base, planFingerprint("2026-10-31", [o("AAA"), o("BBB")]));
  assert.notEqual(base, planFingerprint("2026-10-30", [o("AAA")]));
});

test("good orders have no blocks", () => {
  assert.deepEqual(sendBlocks({ orders: [o("AAA"), o("BBB")], ...ok }), []);
});

test("the kill switch, a missing account size and a stale plan each block", () => {
  assert.match(sendBlocks({ orders: [o("AAA")], ...ok, killed: true }).join(" "), /kill switch/);
  assert.match(sendBlocks({ orders: [o("AAA")], ...ok, accountSize: null }).join(" "), /account size/);
  assert.match(sendBlocks({ orders: [o("AAA")], ...ok, dataDay: "2026-10-31" }).join(" "), /not from the latest close/);
  assert.match(sendBlocks({ orders: [o("AAA")], ...ok, planDay: null }).join(" "), /not from the latest close/);
});

test("nothing to send, too many buys, duplicates and bad numbers block", () => {
  assert.match(sendBlocks({ orders: [], ...ok }).join(" "), /nothing to send/);
  assert.match(sendBlocks({ orders: [o("A"), o("B"), o("C"), o("D")], ...ok }).join(" "), /More than 3/);
  assert.match(sendBlocks({ orders: [o("A"), o("A")], ...ok }).join(" "), /appears twice/);
  assert.match(sendBlocks({ orders: [o("A", 0)], ...ok }).join(" "), /share count/);
  assert.match(sendBlocks({ orders: [o("A", 1.5)], ...ok }).join(" "), /share count/);
  assert.match(sendBlocks({ orders: [o("A", 10, 0)], ...ok }).join(" "), /price limit/);
});

test("an order larger than the position cap (plus a little) is blocked as a sizing bug", () => {
  assert.match(sendBlocks({ orders: [o("A", 10, 105, 30_000)], ...ok }).join(" "), /larger than 21%/);
  assert.deepEqual(sendBlocks({ orders: [o("A", 10, 105, 20_000)], ...ok }), []);
});
