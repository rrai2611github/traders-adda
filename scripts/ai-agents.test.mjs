import test from "node:test";
import assert from "node:assert/strict";
import { briefingFallback, getBriefing, parseBriefing, buildBriefingPrompt } from "../src/lib/ai/briefing.ts";
import { buildBriefingFacts } from "../src/lib/ai/briefingFacts.ts";
import { buildReviewFacts, getAnalystRead, isLastSessionOfWeek, reviewLines, weekStartOf } from "../src/lib/ai/weeklyReview.ts";
import { addUsage, totalCost } from "../src/lib/ai/usage.ts";
import { costOf, parseStringArray } from "../src/lib/ai/claude.ts";
import { buildPreOpenEmail } from "../src/lib/alerts/preOpenEmailFormat.ts";

const pick = (symbol, tag, over = {}) => ({ symbol, tag, ext: -2.5, resultsInDays: null, news: null, analysis: { status: tag === "broke" ? "Buy now" : "Buy on breakout" }, ...over });
const facts = (over = {}) => buildBriefingFacts({
  date: "2026-10-30",
  outlook: { label: "Bearish", score: -3, conviction: "Medium", gift: { gapPercent: -0.224 } },
  topPicks: { breadth50: 28, nifty: { above: false, percent: -4.9 }, picks: [pick("AAA", "broke", { ext: 1.2, analysis: { status: "Paper trade" } }), pick("BBB", "ready", { resultsInDays: 3, analysis: { status: "Wait" } }), pick("CCC", "extended")] },
  ...over,
});

test("the briefing facts carry the setup check, the outlook and the stocks on the tested setup", () => {
  const f = facts();
  assert.equal(f.setupAllowed, false);
  assert.match(f.setupReason, /28% of stocks are above their 50-day average/);
  assert.equal(f.giftGapPercent, -0.22);
  assert.deepEqual(f.candidates.map((c) => `${c.symbol}:${c.status}`), ["AAA:Paper trade", "BBB:Wait"]);
  assert.deepEqual(f.waiting, ["CCC"]);
  assert.equal(f.breadth50, 28);
});

test("the plain-code briefing is always available and says what to do", () => {
  const lines = briefingFallback(facts());
  assert.ok(lines.length >= 4 && lines.length <= 5);
  assert.match(lines[0], /Outlook: bearish, medium conviction; GIFT Nifty is −0\.22%/);
  assert.ok(lines.some((l) => /Setup check not passed/.test(l)));
  assert.ok(lines.some((l) => /AAA \(Paper trade\), BBB \(Wait\)/.test(l)));
  assert.ok(lines.some((l) => /Results within 5 days: BBB \(3d\)/.test(l)));
  assert.match(lines.at(-1), /Paper trade only today/);
  const none = briefingFallback(facts({ topPicks: { breadth50: 60, nifty: { above: true, percent: 2 }, picks: [] } }));
  assert.ok(none.some((l) => /No stock is under its breakout level/.test(l)));
  assert.match(none.at(-1), /Real buys are allowed/);
});

const deps = (over = {}) => {
  const calls = { ask: 0, written: null, usage: [] };
  return { calls, deps: { apiKey: "k", today: "2026-10-30", readCache: () => null, writeCache: (c) => { calls.written = c; }, recordUsage: (u) => calls.usage.push(u),
    ask: async () => { calls.ask += 1; return { text: 'Sure:\n["Setup check not passed: breadth 28%.","Outlook is bearish.","AAA and BBB are on the setup.","BBB reports in 3 days.","Paper trade only today."]', usage: { inputTokens: 900, outputTokens: 120 } }; }, ...over } };
};

test("with no key the briefing is the plain-code one and nothing is called", async () => {
  const { deps: d, calls } = deps({ apiKey: undefined });
  const r = await getBriefing(facts(), d);
  assert.equal(r.ai, false);
  assert.equal(calls.ask, 0);
  assert.ok(r.lines.length >= 4);
});

test("with a key one call writes the lines; the same facts reuse them; changed facts ask again, up to six times a day", async () => {
  const f = facts();
  const first = deps();
  const r = await getBriefing(f, first.deps);
  assert.equal(r.ai, true);
  assert.equal(r.lines.length, 5);
  assert.equal(first.calls.ask, 1);
  assert.deepEqual(first.calls.usage, [{ inputTokens: 900, outputTokens: 120 }]);
  const cached = deps({ readCache: () => first.calls.written });
  assert.equal((await getBriefing(f, cached.deps)).lines.length, 5);
  assert.equal(cached.calls.ask, 0);
  const changed = deps({ readCache: () => first.calls.written });
  await getBriefing({ ...f, giftGapPercent: 0.5 }, changed.deps);
  assert.equal(changed.calls.ask, 1);
  const capped = deps({ readCache: () => ({ ...first.calls.written, key: "other", calls: 6 }) });
  const r6 = await getBriefing({ ...f, giftGapPercent: 0.9 }, capped.deps);
  assert.equal(capped.calls.ask, 0);
  assert.equal(r6.lines.length, 5);
});

test("a failing or useless reply falls back to the plain-code lines and never throws", async () => {
  const boom = deps({ ask: async () => { throw new Error("Claude API HTTP 529"); } });
  assert.equal((await getBriefing(facts(), boom.deps)).ai, false);
  const junk = deps({ ask: async () => ({ text: "I cannot help", usage: { inputTokens: 10, outputTokens: 5 } }) });
  const r = await getBriefing(facts(), junk.deps);
  assert.equal(r.ai, false);
  assert.ok(r.lines.length >= 4);
  assert.deepEqual(parseBriefing('["one"]'), ["one"]);
  assert.ok(buildBriefingPrompt(facts()).includes("\"setupAllowed\":false"));
});

test("the pre-open email shows the briefing first, and says when AI wrote it", () => {
  const brief = { cues: [], levels: [], unavailable: [], bias: { label: "Neutral", score: 0, summary: "" }, sessionLabel: "Fri, 30 Oct", ideas: [], sessions: [] };
  const table = { brand: "Traders Adda", day: "x", scanned: 1, breadth: 28, healthy: false, summary: "", rows: [], watch: [], empty: [], footer: [] };
  const ai = buildPreOpenEmail(brief, table, "", Date.parse("2026-10-30T09:00:00+05:30"), null, null, null, null, { lines: ["Setup check not passed.", "Paper trade only."], ai: true });
  assert.match(ai.html, /Today at a glance/);
  assert.match(ai.html, /written by AI from the facts below/);
  assert.match(ai.html, /• Setup check not passed\.<br>• Paper trade only\./);
  assert.match(ai.text, /TODAY AT A GLANCE \(written by AI from the facts in this email\)\n- Setup check not passed\./);
  assert.ok(ai.html.indexOf("Today at a glance") < ai.html.indexOf("Market outlook"));
  const plain = buildPreOpenEmail(brief, table, "", Date.parse("2026-10-30T09:00:00+05:30"), null, null, null, null, { lines: ["Paper trade only."], ai: false });
  assert.doesNotMatch(plain.html, /written by AI/);
  assert.match(plain.html, /Today at a glance/);
  assert.doesNotMatch(buildPreOpenEmail(brief, table, "", 0).html, /Today at a glance/);
});

// ---- weekly review ----
const trade = (over) => ({ symbol: "X", entryDay: "2026-10-26", entryPrice: 100, exitDay: "2026-10-29", exitPrice: 92, quantity: 100, pnl: -800, r: -1.06, pnlPercent: -8, holdDays: 3, exitReason: "stop", rs: 90, ...over });
const result = () => ({
  data: { symbols: 2500, firstDay: "2016-10-17", lastDay: "2026-10-30", sessions: 12 },
  markedValue: 1_020_000,
  equity: { days: [], account: [], benchmark: [1_000_000, 970_000], drawdown: [] },
  trades: [
    trade({ symbol: "STOPPED" }),
    trade({ symbol: "GAPPED", exitPrice: 80, r: -1.9, pnl: -2000 }),
    trade({ symbol: "TRAIL", entryDay: "2026-10-01", exitDay: "2026-10-28", exitPrice: 130, exitReason: "trail", r: 3, pnl: 3000, holdDays: 19 }),
    trade({ symbol: "OLD", entryDay: "2026-09-01", exitDay: "2026-09-20", exitPrice: 95, pnl: -500, r: -0.6 }),
    trade({ symbol: "OPEN", exitDay: "2026-10-30", exitReason: "end", exitPrice: 105 }),
  ],
  openPositions: [{ symbol: "OPEN", entryDay: "2026-10-26", entryPrice: 100, quantity: 100, spent: 10000, last: 105, lastDay: "2026-10-30", stop: 92, exitLevel: 103, added: false, addPending: false, addAt: null, rs: 90 }],
  pending: { signals: [], breadth50: 40, breadthOk: true, niftyOk: null, slotsFree: 9 },
});
const cfg = { capital: 1_000_000, stopPercent: 8 };

test("week helpers: Monday of the week, and the last session of the week", () => {
  assert.equal(weekStartOf("2026-10-30"), "2026-10-26");
  assert.equal(weekStartOf("2026-10-26"), "2026-10-26");
  assert.equal(weekStartOf("2026-11-01"), "2026-10-26");
  const open = (days) => (d) => days.includes(d);
  assert.equal(isLastSessionOfWeek("2026-10-30", open([])), true);
  assert.equal(isLastSessionOfWeek("2026-10-29", open(["2026-10-30"])), false);
  assert.equal(isLastSessionOfWeek("2026-10-29", open([])), true);
  assert.equal(isLastSessionOfWeek("2026-10-27", open(["2026-10-28"])), false);
});

test("review facts: this week's closed and bought trades, holdings, since-start totals, and the rule checks", () => {
  const f = buildReviewFacts(result(), cfg, { GAPPED: [{ at: "28-Oct-2026 10:00:00", subject: "Outcome of Board Meeting", text: "" }] });
  assert.equal(f.weekStart, "2026-10-26");
  assert.deepEqual(f.closed.map((t) => t.symbol).sort(), ["GAPPED", "STOPPED", "TRAIL"]);
  assert.deepEqual(f.opened.map((t) => t.symbol).sort(), ["GAPPED", "OPEN", "STOPPED"]);
  assert.equal(f.held[0].symbol, "OPEN");
  assert.ok(Math.abs(f.held[0].distanceToExitPercent - ((105 / 103 - 1) * 100)) < 1e-9);
  assert.equal(f.sinceStart.closed, 4);
  assert.equal(f.sinceStart.wins, 1);
  assert.ok(f.checks.some((c) => /GAPPED gapped through its stop: sold at ₹80\.00/.test(c)));
  assert.ok(!f.checks.some((c) => /STOPPED/.test(c)));
  assert.deepEqual(f.announcements.GAPPED, ["28-Oct-2026 Outcome of Board Meeting"]);
  assert.equal(f.account.profit, 20_000);
  assert.ok(Math.abs(f.account.niftyPercent + 3) < 1e-9);
});

test("review lines are plain facts; with every stop clean the checks say so; too few trades is stated", () => {
  const clean = result();
  clean.trades = clean.trades.filter((t) => t.symbol !== "GAPPED");
  const lines = reviewLines(buildReviewFacts(clean, cfg));
  const text = lines.join("\n");
  assert.match(text, /account ₹10,20,000 \(\+₹20,000, \+2\.0% since the start; Nifty 50 −3\.0%\)/);
  assert.match(text, /Closed this week: STOPPED hit its stop \(−1\.06R, −₹800, 3 sessions\); TRAIL closed under its 50-day average/);
  assert.match(text, /OPEN \+5\.0%, 1\.9% above its exit level ⚠/);
  assert.match(text, /Too few trades to judge the rules/);
  assert.match(text, /Rule checks clear/);
});

test("the analyst read needs a key and something to discuss, uses the reply's lines, and never throws", async () => {
  const f = buildReviewFacts(result(), cfg);
  const make = (over = {}) => { const used = []; return { used, d: { apiKey: "k", recordUsage: (u) => used.push(u), ask: async () => ({ text: '["GAPPED gapped through its stop after a board meeting outcome.","Nothing else stands out.","One week proves nothing."]', usage: { inputTokens: 1500, outputTokens: 200 } }), ...over } }; };
  const ok = make();
  assert.equal((await getAnalystRead(f, ok.d)).length, 3);
  assert.equal(ok.used.length, 1);
  assert.equal(await getAnalystRead(f, make({ apiKey: undefined }).d), null);
  assert.equal(await getAnalystRead({ ...f, closed: [], held: [] }, make().d), null);
  assert.equal(await getAnalystRead(f, make({ ask: async () => { throw new Error("HTTP 500"); } }).d), null);
  assert.equal(await getAnalystRead(f, make({ ask: async () => ({ text: "nope", usage: { inputTokens: 1, outputTokens: 1 } }) }).d), null);
});

test("usage is added per job and per month, costed at list prices", () => {
  const a = addUsage(null, "briefing", "haiku", { inputTokens: 1000, outputTokens: 200 }, "2026-10");
  const b = addUsage(a, "briefing", "haiku", { inputTokens: 1000, outputTokens: 200 }, "2026-10");
  const c = addUsage(b, "review", "sonnet", { inputTokens: 2000, outputTokens: 500 }, "2026-10");
  assert.equal(c.jobs.briefing.calls, 2);
  assert.equal(c.jobs.briefing.inputTokens, 2000);
  assert.ok(Math.abs(costOf("sonnet", { inputTokens: 2000, outputTokens: 500 }) - 0.009) < 1e-9);
  assert.ok(Math.abs(totalCost(c) - (2 * costOf("haiku", { inputTokens: 1000, outputTokens: 200 }) + 0.009)) < 1e-9);
  assert.equal(addUsage(c, "briefing", "haiku", { inputTokens: 1, outputTokens: 1 }, "2026-11").jobs.review, undefined);
  assert.deepEqual(parseStringArray('x ["a", 2, " b  c "] y', 5, 10), ["a", "b c"]);
});
