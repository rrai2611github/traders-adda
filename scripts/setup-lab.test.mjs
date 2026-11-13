import test from "node:test";
import assert from "node:assert/strict";
import { buildLabTable, runLabQuery, labSentence, LAB_FEATURES, LAB_RULES } from "../src/lib/screen/setupLab.ts";

const DAY = 86400e3;
const START = Date.UTC(2023, 0, 2);
/** Deterministic pseudo-random walk, so the tests do not depend on Math.random. */
function walk(seed, length, drift, vol = 0.012) {
  let x = seed, price = 100;
  const rand = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296 - 0.5; };
  const out = [];
  for (let i = 0; i < length; i++) {
    const open = price;
    price = Math.max(5, price * (1 + drift + vol * rand() * 2));
    out.push({ t: START + i * DAY, open, high: Math.max(open, price) * 1.004, low: Math.min(open, price) * 0.996, close: price, volume: 200_000 + Math.round(60_000 * rand()) });
  }
  return out;
}
const stocks = (length = 420, tweak = (c) => c) => [
  ...[0.0022, 0.0018, 0.0012].map((d, k) => ({ symbol: `UP${k}`, sector: "Alpha", candles: tweak(walk(11 + k, length, d), `UP${k}`) })),
  ...[-0.0016, -0.0012, -0.0008].map((d, k) => ({ symbol: `DN${k}`, sector: "Beta", candles: tweak(walk(31 + k, length, d), `DN${k}`) })),
  { symbol: "FLAT", sector: null, candles: tweak(walk(51, length, 0), "FLAT") },
];

test("a table has one observation per judged stock-day, and a filter on a level that does not exist matches nothing", async () => {
  const s = stocks();
  const table = await buildLabTable(s);
  const judged = s.reduce((a, x) => a + (x.candles.length - LAB_RULES.warmup), 0);
  assert.ok(table.n > 0 && table.n <= judged);
  assert.equal(table.lastSlot, 419);
  assert.deepEqual(Object.keys(table.levels).sort(), LAB_FEATURES.map((f) => f.key).sort());
  const all = runLabQuery(table, {}, 20);
  assert.equal(all.matched, table.n);
  // Excluding every real level of a feature leaves nothing.
  assert.equal(runLabQuery(table, { stage2: [] }, 20).matched, table.n); // an empty list means "no filter"
  assert.equal(runLabQuery(table, { stage2: [5] }, 20).matched, 0);
});

test("rising stocks are in Stage 2 far more often than falling ones", async () => {
  const s = stocks();
  const table = await buildLabTable(s);
  const rate = (prefix) => {
    const idx = s.map((x, i) => [x.symbol, i]).filter(([sym]) => sym.startsWith(prefix)).map(([, i]) => i);
    let yes = 0, n = 0;
    for (let i = 0; i < table.n; i++) if (idx.includes(table.stock[i])) { n++; yes += table.levels.stage2[i]; }
    return yes / n;
  };
  assert.ok(rate("UP") > 0.5, `up stocks ${rate("UP")}`);
  assert.ok(rate("DN") < 0.05, `down stocks ${rate("DN")}`);
});

test("NO LOOKAHEAD: changing the future leaves every condition on past days untouched", async () => {
  const cut = 380;
  const a = await buildLabTable(stocks(420));
  const b = await buildLabTable(stocks(420, (c) => c.map((k, i) => (i >= cut ? { ...k, close: k.close * 3, high: k.high * 3, low: k.low * 0.5, volume: k.volume * 9 } : k))));
  assert.equal(a.n, b.n);
  let compared = 0;
  for (let i = 0; i < a.n; i++) {
    if (a.slot[i] >= cut) continue;
    for (const key of Object.keys(a.levels)) assert.equal(a.levels[key][i], b.levels[key][i], `${key} at obs ${i}`);
    assert.equal(a.rank[i], b.rank[i]);
    compared++;
  }
  assert.ok(compared > 500);
});

test("excess returns are measured against the median stock of the same session, so about half win", async () => {
  const table = await buildLabTable(stocks());
  const r = runLabQuery(table, {}, 20);
  assert.ok(r.universe.winRate > 40 && r.universe.winRate <= 55, `win rate ${r.universe.winRate}`);
  assert.ok(Math.abs(r.universe.median) < 1, `median ${r.universe.median}`);
  // The last sessions have no 20-session outcome yet.
  const last = table.excess[20];
  let lastSlotWithOutcome = -1;
  for (let i = 0; i < table.n; i++) if (!Number.isNaN(last[i])) lastSlotWithOutcome = Math.max(lastSlotWithOutcome, table.slot[i]);
  assert.equal(lastSlotWithOutcome, table.lastSlot - 20);
});

test("a filter narrows the set, drop-one reports each active filter, and histograms are shares", async () => {
  const table = await buildLabTable(stocks());
  const all = runLabQuery(table, {}, 20);
  const r = runLabQuery(table, { stage2: [1], trend: [3] }, 20);
  assert.ok(r.matched < all.matched && r.matched > 0);
  assert.deepEqual(r.dropOne.map((d) => d.key).sort(), ["stage2", "trend"]);
  assert.equal(all.dropOne.length, 0);
  for (const h of [r.histogram.combo, r.histogram.universe]) {
    const sum = h.reduce((a, b) => a + b, 0);
    assert.ok(sum > 98 && sum < 102, `histogram sums to ${sum}`);
  }
  assert.equal(r.regimes.length, 2);
  assert.ok(r.months.length >= 1 && r.months.every((m) => /^\d{4}-\d{2}$/.test(m.month)));
  assert.ok(r.matchingNow.total >= r.matchingNow.rows.length);
  assert.ok(r.matchingNow.rows.every((m, i, a) => i === 0 || a[i - 1].rank >= m.rank));
});

test("too few observations withhold the statistics and the sentence says so", async () => {
  const table = await buildLabTable(stocks());
  const r = runLabQuery(table, { base: [3], stage2: [0] }, 60);
  assert.ok(r.combo.n < LAB_RULES.minObservations);
  assert.equal(r.combo.winRate, null);
  assert.match(labSentence(r), /too few to read, so no statistic is shown/);
  const ok = runLabQuery(table, { stage2: [1] }, 5);
  assert.match(labSentence(ok), /past stock-days met these conditions\. \d+\.\d% went on to beat the median stock over 5 sessions/);
});

test("building reports progress and does not block: it yields to the event loop", async () => {
  const many = Array.from({ length: 45 }, (_, k) => ({ symbol: `S${k}`, sector: "Alpha", candles: walk(100 + k, 300, 0.001) }));
  const calls = [];
  let yielded = false;
  const t = setImmediate(() => { yielded = true; });
  await buildLabTable(many, (done, total) => calls.push([done, total]));
  clearImmediate(t);
  assert.ok(calls.length >= 2 && calls.at(-1)[0] === 45 && calls.at(-1)[1] === 45);
  assert.equal(yielded, true);
});
