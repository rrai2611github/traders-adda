import test from "node:test";
import assert from "node:assert/strict";
import { parseAnnouncements } from "../src/lib/market/announcements.ts";
import { buildNewsPrompt, parseNewsReply, getNews, costUsd, emptyCache, NEWS_PRICE } from "../src/lib/ai/newsCheck.ts";
import { analysePick } from "../src/lib/screen/pickAnalysis.ts";
import { buildTopPicks } from "../src/lib/screen/topPicks.ts";
import { topPicksBlock } from "../src/lib/alerts/topPicksEmail.ts";

const rows = [
  { an_dt: "27-Oct-2026 22:27:40", desc: "Analysts/Institutional Investor Meet/Con. Call Updates", attchmntText: "Intimation Regarding Rescheduling of Earnings Call" },
  { an_dt: "30-Oct-2026 13:45:51", desc: "Outcome of Board Meeting", attchmntText: "Submitted the financial results for the period ended September 30, 2026." },
  { an_dt: "28-Oct-2026 10:00:00", desc: "Trading Window", attchmntText: "Closure of trading window" },
  { an_dt: "30-Oct-2026 13:45:51", desc: "Outcome of Board Meeting", attchmntText: "Submitted the financial results for the period ended September 30, 2026." },
  { an_dt: "29-Oct-2026 09:00:00", desc: "Press Release", attchmntText: "x ".repeat(400) },
  { desc: "No date", attchmntText: "ignored" },
];

test("announcements: newest first, duplicates and routine notices dropped, long text trimmed", () => {
  const list = parseAnnouncements(rows);
  assert.deepEqual(list.map((a) => a.subject), ["Outcome of Board Meeting", "Press Release", "Analysts/Institutional Investor Meet/Con. Call Updates"]);
  assert.ok(list[1].text.length <= 261 && list[1].text.endsWith("…"));
});

test("the prompt lists each stock with its filings, and says so when there are none", () => {
  const p = buildNewsPrompt([{ symbol: "AAA", announcements: parseAnnouncements(rows) }, { symbol: "BBB", announcements: [] }]);
  assert.match(p, /STOCK AAA\n- 30-Oct-2026 13:45:51 · Outcome of Board Meeting/);
  assert.match(p, /STOCK BBB\n\(no announcements in the last 14 days\)/);
});

test("the reply is read defensively: stray text, unknown symbols, bad flags and long notes", () => {
  const reply = `Here you go:\n[{"symbol":"AAA","flag":"watch","note":"Results out on 30 Oct."},{"symbol":"ZZZ","flag":"clear","note":"not asked"},{"symbol":"BBB","flag":"weird","note":"${"y".repeat(300)}"},{"symbol":"AAA","flag":"clear","note":"duplicate"},{"symbol":"CCC","flag":"clear","note":""}]\nThanks`;
  const notes = parseNewsReply(reply, ["AAA", "BBB", "CCC"]);
  assert.deepEqual(notes.map((n) => n.symbol), ["AAA", "BBB"]);
  assert.equal(notes[0].flag, "watch");
  assert.equal(notes[1].flag, "watch");
  assert.ok(notes[1].note.length <= 170);
  assert.deepEqual(parseNewsReply("no json here", ["AAA"]), []);
  assert.deepEqual(parseNewsReply("[not json]", ["AAA"]), []);
});

const deps = (over = {}) => {
  const calls = { ask: 0, fetched: [], written: null };
  return {
    calls,
    deps: {
      apiKey: "test-key", today: "2026-10-30", readCache: () => null, writeCache: (c) => { calls.written = c; },
      announcementsFor: async (s) => { calls.fetched.push(s); return parseAnnouncements(rows); },
      ask: async (text) => { calls.ask += 1; return { text: '[{"symbol":"AAA","flag":"watch","note":"Results out."},{"symbol":"BBB","flag":"clear","note":"Routine filings only."}]', usage: { inputTokens: 5000, outputTokens: 400 } }; },
      ...over,
    },
  };
};

test("one call writes the notes for every missing stock, and the cache keeps the running totals", async () => {
  const { deps: d, calls } = deps();
  const r = await getNews(["AAA", "BBB"], d);
  assert.equal(r.status, "ok");
  assert.equal(calls.ask, 1);
  assert.deepEqual(calls.fetched.sort(), ["AAA", "BBB"]);
  assert.equal(r.notes.AAA.note, "Results out.");
  assert.equal(calls.written.calls, 1);
  assert.equal(calls.written.inputTokens, 5000);
  assert.equal(calls.written.month, "2026-10");
});

test("notes already written today are reused with no call; only the missing stock is asked about", async () => {
  const cache = { ...emptyCache("2026-10-30", "2026-10"), notes: { AAA: { symbol: "AAA", flag: "clear", note: "cached" } } };
  const { deps: d, calls } = deps({ readCache: () => cache });
  const none = await getNews(["AAA"], d);
  assert.equal(calls.ask, 0);
  assert.equal(none.notes.AAA.note, "cached");
  const some = await getNews(["AAA", "BBB"], d);
  assert.equal(calls.ask, 1);
  assert.deepEqual(calls.fetched, ["BBB"]);
  assert.equal(some.notes.AAA.note, "cached");
});

test("with no API key the check is off, and cache-only mode never fetches or pays", async () => {
  const { deps: d, calls } = deps({ apiKey: undefined });
  const off = await getNews(["AAA"], d);
  assert.equal(off.status, "off");
  assert.equal(calls.ask, 0);
  const keyed = deps();
  const only = await getNews(["AAA"], { ...keyed.deps, cacheOnly: true });
  assert.equal(only.status, "ok");
  assert.deepEqual(only.notes, {});
  assert.equal(keyed.calls.ask, 0);
  assert.deepEqual(keyed.calls.fetched, []);
});

test("a failing API call returns a failed result instead of throwing, and writes nothing", async () => {
  const { deps: d, calls } = deps({ ask: async () => { throw new Error("Claude API HTTP 529"); } });
  const r = await getNews(["AAA"], d);
  assert.equal(r.status, "failed");
  assert.match(r.message, /529/);
  assert.equal(calls.written, null);
});

test("yesterday's notes are not reused, but the month's running totals carry over", async () => {
  const old = { ...emptyCache("2026-10-29", "2026-10"), notes: { AAA: { symbol: "AAA", flag: "clear", note: "old" } }, calls: 4, inputTokens: 20000, outputTokens: 1600 };
  const { deps: d, calls } = deps({ readCache: () => old });
  await getNews(["AAA", "BBB"], d);
  assert.equal(calls.ask, 1);
  assert.equal(calls.written.calls, 5);
  assert.equal(calls.written.inputTokens, 25000);
  assert.notEqual(calls.written.notes.AAA.note, "old");
});

test("cost at Haiku 5.5 list prices", () => {
  assert.equal(NEWS_PRICE.inputPerMTok, 0.1);
  assert.ok(Math.abs(costUsd({ inputTokens: 7000, outputTokens: 1000 }) - 0.0012) < 1e-9);
});

test("the email shows each stock's news note with its colour, plus one disclaimer", () => {
  const row = { symbol: "AAA", stage: "forming", liquid: true, series: "EQ", rs: 92, ext: -3, vs50: 5, vs200: 30, fromHigh: 4, dry: 0.7, turnoverCr: 20, price: 100, pivotPrice: 103, aboveLow: 80, coil: 0.5, baseWk: 10, baseDepth: 20, listedWk: 300, level: 1, mcap: 5000 };
  const [p] = buildTopPicks([row], []);
  const picks = [{ ...p, news: { symbol: "AAA", flag: "caution", note: "Board approved a preferential issue to promoters." }, analysis: analysePick(p, { breadth50: 62, resultsInDays: null }) }];
  const { html, text } = topPicksBlock({ breadth50: 62, size: { key: "full", label: "x", detail: "y" }, picks });
  assert.match(html, /News check:<\/b> Board approved a preferential issue to promoters\./);
  assert.match(html, /#b42318;padding-top:4px/);
  assert.match(html, /AI-written one-line summary of each stock/);
  assert.ok(text.some((l) => /NEWS CHECK \(caution\): Board approved/.test(l)));
  const bare = topPicksBlock({ breadth50: 62, size: { key: "full", label: "x", detail: "y" }, picks: [{ ...picks[0], news: null }] });
  assert.doesNotMatch(bare.html, /News check/);
});
