import test from "node:test";
import assert from "node:assert/strict";
import { emailDecision, decisionBarHtml, topPicksBlock } from "../src/lib/alerts/topPicksEmail.ts";

const pick = (symbol, tag = "ready") => ({
  symbol, name: symbol, sector: null, tag, rs: 95, price: 100, ext: -2,
  analysis: { verdict: "paper", status: "Paper trade", headline: "x", chips: [], flags: [], plan: null },
});
const input = (picks, breadth50) => ({ breadth50, size: { key: "paper", label: "", detail: "" }, nifty: null, picks });

test("weak market with candidates: do not buy, watch only", () => {
  const d = emailDecision(input([pick("AAA"), pick("BBB")], 18));
  assert.equal(d.kind, "paper");
  assert.match(d.headline, /^Do not buy today\./);
  assert.match(d.headline, /Watch only: AAA, BBB/);
  assert.equal(d.subjectBit, "No new buys (market weak)");
});

test("healthy market with candidates: buy candidates, named", () => {
  const d = emailDecision(input([pick("AAA"), pick("BBB"), pick("CCC"), pick("DDD")], 60));
  assert.equal(d.kind, "buy");
  assert.match(d.headline, /^Buy candidates today: AAA, BBB, CCC, DDD\./);
  assert.equal(d.subjectBit, "Buy candidates: AAA, BBB, CCC");
});

test("no stock at a breakout level: no new buys, whatever the market", () => {
  for (const breadth of [18, 60]) {
    const d = emailDecision(input([pick("AAA", "watch")], breadth));
    assert.equal(d.kind, "none");
    assert.equal(d.subjectBit, "No new buys today");
  }
});

test("the action bar shows the label and the sentence", () => {
  const html = decisionBarHtml(emailDecision(input([pick("AAA")], 18)));
  assert.match(html, /Today&#39;s action|Today's action/);
  assert.match(html, /Do not buy today/);
});

test("on a blocked-buys day only 3 cards show and the rest are named", () => {
  const picks = ["A", "B", "C", "D", "E"].map((s) => pick(s));
  const { html, text } = topPicksBlock(input(picks, 18));
  assert.equal((html.match(/Paper trade<\/span>/g) ?? []).length, 3);
  assert.match(html, /Also on the list \(paper only\): D \(RS 95\), E \(RS 95\)\./);
  assert.ok(text.some((line) => line.startsWith("Also on the list (paper only): D")));
  assert.equal(text.filter((line) => /^\d\. /.test(line)).length, 3);
});

test("when buys are allowed every candidate keeps its card", () => {
  const picks = ["A", "B", "C", "D", "E"].map((s) => pick(s));
  const { html } = topPicksBlock(input(picks, 60));
  assert.equal((html.match(/Paper trade<\/span>/g) ?? []).length, 5);
  assert.doesNotMatch(html, /Also on the list/);
});
