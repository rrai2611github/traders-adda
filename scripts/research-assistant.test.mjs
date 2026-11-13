import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, researchAnswer, researchIntent, resolveResearchIntent, stockResearch } from "../src/lib/assistant/research.ts";

const now = Date.parse("2026-11-01T16:00:00Z");
const input = {
  symbol: "SBIN", name: "State Bank of India", lastDay: "2026-10-30", breadth: 40, now,
  warnings: [], picksAvailable: true, pick: null,
  quote: { ltp: 810, timestamp: now - 1000, fetchedAt: now, source: "fyers", tradeTimestamp: null, timestampBasis: "session" },
  metrics: { price: 810, rs: 82, vs50: 5, vs200: 10, turnoverCr: 120, passesFloor: true, pivotPrice: 815 },
};

test("all suggested questions resolve to supported bounded intents", () => {
  for (const q of QUESTIONS) assert.ok(researchIntent(q), q);
  assert.equal(researchIntent("Compare SBIN vs ICICIBANK"), "compare");
  assert.equal(researchIntent("Why is this in Top Picks?"), "setup");
  assert.equal(researchIntent("What invalidates this setup?"), "levels");
});

test("unsupported predictions, private portfolios and actions are explicit nonanswers", () => {
  for (const q of ["Predict SBIN tomorrow", "Give guaranteed returns", "Place an order", "Analyse my portfolio", "Show fundamentals", "Show news", "Hello"]) {
    assert.equal(researchIntent(q), null, q);
  }
});

test("facts preserve values and uncertainty without inventing a setup", () => {
  const s = stockResearch(input);
  assert.equal(s.metrics[1].value, "82");
  assert.match(s.source, /unverified/);
  assert.equal(s.fetchedAt, now);
  assert.match(s.status, /No current Top Picks/);
  assert.match(s.levels[0], /No verified/);
  assert.ok(s.risks.some((r) => /freshness unverified/.test(r)));
  assert.ok(s.missing.some((m) => /fundamentals/.test(m)));
});

test("stale or failed source suppresses setup-specific levels, not facts", () => {
  const pick = { tag: "broke", screens: ["Blue sky"], analysis: { plan: { buy: 810, stop: 712.8, stopPercent: 12, exit: "Close below SMA50", targets: { t1: 939.6, t2: 1004.4 } } } };
  const fresh = stockResearch({...input,pick});
  assert.match(fresh.levels[0], /712.8/);
  assert.match(fresh.levels[2], /not price forecasts/);
  const stale = stockResearch({...input,pick,lastDay:"2026-10-20"});
  assert.match(stale.status,/Data limited/);
  assert.match(stale.levels[0],/No verified/);
  const failed = stockResearch({...input,pick,warnings:["Snapshot refresh failed"]});
  assert.match(failed.levels[0],/No verified/);
  assert.equal(failed.metrics[1].value,"82");
});

test("missing data and weak breadth cannot become buy approval", () => {
  const s=stockResearch({...input,metrics:null,quote:null,lastDay:null,picksAvailable:false});
  assert.match(s.status,/Data limited/);
  assert.equal(s.metrics[0].value,"Not available");
  assert.ok(s.missing.some((m)=>/Top Picks source/.test(m)));
  assert.match(stockResearch({...input,breadth:20}).status,/Market gate blocked/);
});

test("comparison retains separate stock facts and carries source links and focus", () => {
  const stocks=[stockResearch(input),stockResearch({...input,symbol:"ICICIBANK",name:"ICICI Bank"})];
  const answer=researchAnswer("compare",stocks,40,now);
  assert.deepEqual(answer.symbols,["SBIN","ICICIBANK"]);
  assert.equal(answer.focus,"compare");
  assert.equal(answer.stocks.length,2);
  assert.equal(answer.readAt,now);
  assert.ok(answer.sources.some((s)=>s.href==="/performance"));
  assert.match(researchAnswer("education",[],null,now).summary,/not a probability/);
});

test("direct stock questions are routed before generic application keywords", () => {
  for (const [question, intent] of [
    ["Is SBIN bullish or bearish?", "sentiment"], ["What is its sentiment?", "sentiment"],
    ["Can I buy Infosys?", "decision"], ["Should I sell SBIN?", "decision"],
    ["How is SBIN doing compared to the market?", "analysis"],
    ["What is the current price of SBIN?", "price"],
    ["Explain SBIN volume", "volume"], ["Show support and resistance", "levels"],
    ["What are its risks?", "risks"],
  ]) assert.equal(researchIntent(question, true), intent, question);
  assert.equal(resolveResearchIntent("Why?", "sentiment", true), "sentiment");
  assert.equal(resolveResearchIntent("Tell me more", "risks", true), "risks");
  assert.equal(resolveResearchIntent("Predict tomorrow", "sentiment", true), null);
});

test("daily outlook reuses drawer trend and never confuses weak breadth with bearish stock", () => {
  assert.equal(stockResearch(input).outlook.label, "Bullish");
  const weakMarket = stockResearch({...input,breadth:20});
  assert.equal(weakMarket.outlook.label,"Bullish");
  assert.match(weakMarket.status,/watch only/);
  const bearish = stockResearch({...input,metrics:{...input.metrics,vs50:-4,vs200:-10}});
  assert.equal(bearish.outlook.label,"Bearish");
  for (const [vs50,vs200] of [[4,-10],[-4,10]]) {
    assert.equal(stockResearch({...input,metrics:{...input.metrics,vs50,vs200}}).outlook.label,"Mixed / neutral");
  }
  for (const values of [
    {lastDay:"2026-10-20"}, {warnings:["Refresh failed"]},
    {metrics:{...input.metrics,vs200:null}}, {metrics:{...input.metrics,vs50:NaN}},
    {quote:{...input.quote,source:"mock"}}, {metrics:null},
  ]) assert.equal(stockResearch({...input,...values}).outlook.label,"Insufficient data");
});

test("answers start with the requested conclusion, not the same generic response", () => {
  const stocks=[stockResearch(input)];
  assert.match(researchAnswer("sentiment",stocks,40,now).summary,/SBIN: Bullish/);
  assert.match(researchAnswer("decision",stocks,40,now).summary,/does not by itself mean buy/);
  assert.match(researchAnswer("risks",stocks,40,now).summary,/freshness unverified/);
  assert.match(researchAnswer("levels",stocks,40,now).summary,/not confirmed support\/resistance/);
  assert.match(researchAnswer("price",stocks,40,now).summary,/snapshot price INR 810/);
  assert.match(researchAnswer("volume",stocks,40,now).summary,/median turnover/);
});
