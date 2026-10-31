import test from "node:test";
import assert from "node:assert/strict";
import { weeklyTop5Block, isFirstTradingDayOfWeek } from "../src/lib/alerts/weeklyTop5Email.ts";
import { buildPreOpenEmail } from "../src/lib/alerts/preOpenEmailFormat.ts";

const at = (iso) => Date.parse(`${iso}+05:30`);
const top5 = (key = "paper") => ({
  breadth50: 30, qualifying: 79,
  size: { key, label: key === "full" ? "Normal size" : key === "quarter" ? "Quarter size or paper only" : "Paper trade only", detail: "Risk little." },
  picks: [
    { symbol: "AAA", rs: 98, sector: "Healthcare", scanners: 2, close: 342.9, stop: 309.4, target: 443.3, riskPercent: 9.8 },
    { symbol: "BBB", rs: 95, sector: null, scanners: null, close: 2060, stop: 2000, target: 2240, riskPercent: 2.9 },
  ],
});

test("the block leads with the size note and lists each pick with stop and target", () => {
  const { html, text } = weeklyTop5Block(top5());
  assert.match(html, /Paper trade only/);
  assert.match(html, /AAA/);
  assert.match(html, /Part profit \(3R\)/);
  assert.match(text[0], /^PAPER TRADE ONLY/);
  assert.match(text.join("\n"), /1\. AAA · RS 98 · Healthcare · 2 scanners · last close ₹342\.9 · stop ₹309\.4 \(−9\.8%\) · target ₹443\.3/);
  assert.match(text.join("\n"), /2\. BBB · RS 95 · last close/);
});

test("no picks says so instead of an empty section", () => {
  const { html, text } = weeklyTop5Block({ ...top5(), picks: [] });
  assert.match(html, /Not picking is a valid answer/);
  assert.match(text.join("\n"), /No stock passes every rule/);
});

test("first trading day of the week: Monday yes, Wednesday no, weekend no", () => {
  assert.equal(isFirstTradingDayOfWeek(at("2026-10-12T09:00:00")), true);
  assert.equal(isFirstTradingDayOfWeek(at("2026-10-14T09:00:00")), false);
  assert.equal(isFirstTradingDayOfWeek(at("2026-10-17T09:00:00")), false);
});

const brief = () => ({ generatedAt: 0, sessionLabel: "Fri, 16 Oct", bias: { key: "flat", label: "Flat", score: 0, summary: "", components: [] }, cues: [], levels: [], ideas: [], unavailable: [] });
const table = () => ({ brand: "Traders Adda", day: "16 Oct 2026", scanned: 2300, breadth: 30, healthy: false, summary: "", rows: [], watch: [], empty: [], footer: ["Not advice."] });

test("the pre-open email carries the Top 5 section only when given one", () => {
  const withTop5 = buildPreOpenEmail(brief(), table(), "", at("2026-10-12T09:00:30"), null, null, top5());
  assert.match(withTop5.html, /Weekly Top 5/);
  assert.match(withTop5.text, /WEEKLY TOP 5/);
  assert.match(withTop5.text, /1\. AAA/);
  const without = buildPreOpenEmail(brief(), table(), "", at("2026-10-12T09:00:30"));
  assert.doesNotMatch(without.html, /Weekly Top 5/);
  assert.doesNotMatch(without.text, /WEEKLY TOP 5/);
});
