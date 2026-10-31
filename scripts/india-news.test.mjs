import test from "node:test";
import assert from "node:assert/strict";
import { parseRss, relevance, topHeadlines } from "../src/lib/market/indiaNews.ts";

const NOW = Date.parse("2026-10-31T18:00:00Z");
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel><title>Feed</title>${items
    .map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.l ?? "https://example.com/" + encodeURIComponent(i.t)}</link><pubDate>${i.d ?? "Sat, 31 Oct 2026 12:00:00 GMT"}</pubDate></item>`)
    .join("")}</channel></rss>`;

test("RSS items are read, and items without a link or a date are dropped", () => {
  const xml = rss([{ t: "RBI holds repo rate &amp; stance" }, { t: "No date", d: "not a date" }, { t: "No link", l: "nope" }]);
  const out = parseRss(xml, "ET");
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "RBI holds repo rate & stance");
  assert.equal(out[0].source, "ET");
});

test("market-wide words score; company-only and promotional headlines do not make the list", () => {
  assert.ok(relevance("RBI keeps repo rate unchanged, rupee gains") >= 6);
  assert.equal(relevance("Muthoot Finance shares jump after strong show"), 0);
  const items = parseRss(
    rss([
      { t: "RBI keeps repo rate unchanged, rupee gains" },
      { t: "Stocks to buy today: 5 picks for Monday, says analyst" },
      { t: "Muthoot Finance Q2 cons profit jumps 36% YoY" },
      { t: "Sebi tightens F&O rules as FII selling continues" },
    ]),
    "ET",
  );
  const top = topHeadlines(items, NOW, 5);
  assert.deepEqual(top.map((h) => h.title), ["RBI keeps repo rate unchanged, rupee gains", "Sebi tightens F&O rules as FII selling continues"]);
});

test("old headlines and near-duplicates are left out, and the count is capped", () => {
  const items = [
    ...parseRss(rss([{ t: "Fed signals pause as crude falls", d: "Thu, 29 Oct 2026 12:00:00 GMT" }]), "Mint"),
    ...parseRss(rss([{ t: "Sensex, Nifty fall as FII selling hits market" }]), "Moneycontrol"),
    ...parseRss(rss([{ t: "Sensex, Nifty fall as FII selling hits market" }]), "Mint"),
    ...parseRss(rss(Array.from({ length: 10 }, (_, i) => ({ t: `Crude oil price shock number ${i} rattles Sensex` }))), "ET"),
  ];
  const top = topHeadlines(items, NOW, 3);
  assert.equal(top.length, 3);
  assert.ok(!top.some((h) => /Fed signals/.test(h.title)), "older than 24 hours");
  assert.ok(top.filter((h) => /FII selling/.test(h.title)).length <= 1, "the same story from two feeds counts once");
});

test("no feed data means no headlines, not an error", () => {
  assert.deepEqual(topHeadlines([], NOW), []);
  assert.deepEqual(parseRss("not xml at all", "ET"), []);
});
