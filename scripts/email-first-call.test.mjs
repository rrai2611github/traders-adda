import test from "node:test";
import assert from "node:assert/strict";
import { firstCallParts, topPicksBlock } from "../src/lib/alerts/topPicksEmail.ts";
import { attachFirstCalls } from "../src/lib/radar/pickCalls.ts";
import { pickTerm } from "../src/lib/screen/pickTerm.ts";

const plan = { buy: 377.8, stop: 332.46, stopPercent: 12, targets: { t1: 438.25, t2: 467.5, t1Percent: 16, t2Percent: 24 } };
const pick = (over = {}) => ({ symbol: "CUPID", name: "Cupid", sector: null, tag: "broke", rs: 99, price: 377.8, ext: 3.2, analysis: { verdict: "buy", status: "Buy now", headline: "x", chips: [], flags: [], plan }, ...over });
const saved = (over = {}) => ({
  symbol: "CUPID", onListSince: "2026-11-02", firstTag: "extended", state: "open", sessions: 1, returnPercent: -0.9, endedCalls: 0,
  call: { day: "2026-11-12", tag: "broke", buy: 381.25, stop: 335.5, target1: 442.25, target2: 472.75, price: 381.25, rs: 99, email: "hourly", mentions: 14, breadth50: 50 }, ...over,
});
const block = (picks) => topPicksBlock({ breadth50: 50, size: { key: "full", label: "", detail: "" }, nifty: null, picks });

test("a saved call keeps its own levels, to the paisa, and says how it is doing against today's price", () => {
  const { lines, hasCall } = firstCallParts(pick({ firstCall: saved() }));
  assert.equal(hasCall, true);
  assert.equal(lines[0], "First call 12 Nov (Just broke out): buy ₹381.25 · stop ₹335.50 · T1 ₹442.25 · T2 ₹472.75");
  assert.equal(lines[1], "Now −0.9% against the call · session 1 · on the list since 2 Nov");
});

test("running more than 5% past the call warns not to chase; a reached stop or target is stated", () => {
  assert.match(firstCallParts(pick({ price: 412, firstCall: saved() })).lines[1], /\+8\.1% against the call \(more than 5% above the call: don't chase\)/);
  assert.match(firstCallParts(pick({ price: 445, firstCall: saved() })).lines[1], /target 1 reached/);
  assert.match(firstCallParts(pick({ price: 330, firstCall: saved() })).lines[1], /at or under the call's stop/);
});

test("on the list but with no buy call yet, or brand new: today's levels are the first call", () => {
  const waiting = firstCallParts(pick({ firstCall: saved({ call: null, state: null }) }));
  assert.equal(waiting.hasCall, false);
  assert.equal(waiting.lines[0], "On the list since 2 Nov (first as Extended). The levels above are the first call.");
  const fresh = firstCallParts(pick());
  assert.equal(fresh.hasCall, false);
  assert.equal(fresh.lines[0], "New today. The levels above are the first call.");
  // No "first as" noise when the first listing was the same tag.
  assert.equal(firstCallParts(pick({ firstCall: saved({ call: null, firstTag: "broke" }) })).lines[0], "On the list since 2 Nov. The levels above are the first call.");
});

test("the card shows the term and the first call, and relabels the moving levels only when a call exists", () => {
  const withCall = block([pick({ firstCall: saved() })]);
  assert.match(withCall.html, new RegExp(pickTerm().label));
  assert.match(withCall.html, /First call 12 Nov/);
  assert.match(withCall.html, /Buy today/);
  assert.match(withCall.html, /Stop today/);
  const fresh = block([pick()]);
  assert.doesNotMatch(fresh.html, /Buy today/);
  assert.match(fresh.html, /New today\. The levels above are the first call\./);
  assert.match(fresh.html, />Buy</);
});

test("the plain-text version carries the term, today's levels and the first call, and a footnote explains both", () => {
  const text = block([pick({ firstCall: saved() })]).text;
  assert.match(text[0], /^1\. CUPID · BUY NOW · RS 99 · today's levels: buy ₹377\.8 · stop ₹332\.5 \(−12%\)/);
  assert.match(text[0].split("\n")[0], /· 3\.2% past its level · MID TERM/);
  assert.match(text[0], /\n {3}First call 12 Nov \(Just broke out\): buy ₹381\.25 · stop ₹335\.50/);
  assert.ok(text.some((line) => /^First call: the first Ready or Just-broke-out listing/.test(line) && /Mid term: usually held about \d+ weeks in the 10-year test, not a time limit/.test(line)));
  // Without the call, the line is plain and still there.
  assert.doesNotMatch(block([pick()]).text[0], /today's levels/);
});

test("stocks only to wait on get no first-call line, and nothing breaks when the track record is absent", () => {
  const waiting = block([pick({ tag: "extended", analysis: { verdict: "skip", status: "Do not chase", headline: "x", chips: [], flags: ["Extended"], plan: null } })]);
  assert.doesNotMatch(waiting.html, /First call/);
  assert.doesNotMatch(waiting.text.join("\n"), /First call/);
  assert.doesNotMatch(waiting.text.join("\n"), /listing, its levels kept fixed/); // no footnote when no card is shown
});

test("attachFirstCalls adds each stock's call, or null, without changing the picks", () => {
  const picks = [{ symbol: "AAA", rs: 1 }, { symbol: "BBB", rs: 2 }];
  const out = attachFirstCalls(picks, { AAA: saved({ symbol: "AAA" }) });
  assert.equal(out[0].firstCall.symbol, "AAA");
  assert.equal(out[1].firstCall, null);
  assert.deepEqual(picks, [{ symbol: "AAA", rs: 1 }, { symbol: "BBB", rs: 2 }]);
});
