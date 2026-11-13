import test from "node:test";
import assert from "node:assert/strict";
import { measureDailyChange, summarizeChanges, changeSentence, groupRows, sectorTally } from "../src/lib/screen/dailyChanges.ts";

const DAY = 86400e3;
const bar = (i, close, { high = close + 1, low = close - 1, volume = 200_000 } = {}) => ({ t: i * DAY, open: close, high, low, close, volume });
const fromCloses = (closes) => closes.map((c, i) => bar(i, c));
/** A steady climb of 300 sessions (100 -> 249.5) with the last `tail.length` closes replaced. */
const climb = (tail = []) => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.5);
  tail.forEach((c, k) => { closes[300 - tail.length + k] = c; });
  return fromCloses(closes);
};

test("too little history gives no events", () => {
  assert.deepEqual(measureDailyChange(fromCloses(Array.from({ length: 150 }, (_, i) => 100 + i))), []);
});

test("a dip below the 50- and 200-day averages and a jump back is a cross above both, and re-entering Stage 2", () => {
  const kinds = measureDailyChange(climb([150, 150, 150, 150, 240]));
  assert.ok(kinds.includes("above50"));
  assert.ok(kinds.includes("above200"));
  assert.ok(kinds.includes("enteredStage2"));
  assert.ok(!kinds.includes("below50"));
  assert.ok(!kinds.includes("leftStage2"));
});

test("the reverse: a drop through both averages is a cross below and leaving Stage 2", () => {
  const kinds = measureDailyChange(climb([240, 240, 240, 240, 150]));
  assert.ok(kinds.includes("below50"));
  assert.ok(kinds.includes("below200"));
  assert.ok(kinds.includes("leftStage2"));
  assert.ok(!kinds.includes("above50"));
});

test("a stock that stays above both averages and in Stage 2 has no cross or Stage 2 event", () => {
  const kinds = measureDailyChange(climb());
  assert.deepEqual(kinds.filter((k) => k !== "newHigh"), []);
});

test("a close above the prior year's high is a new 52-week closing high; an ordinary day is not", () => {
  assert.ok(measureDailyChange(climb([260])).includes("newHigh")); // a jump through the prior high
  assert.ok(!measureDailyChange(climb()).includes("newHigh")); // creeping up, but not above yesterday's intraday high
  const flat = climb().map((c, i) => (i === 299 ? bar(i, 200) : c));
  assert.ok(!measureDailyChange(flat).includes("newHigh"));
});

/** The Bases test's shape: uptrend, a 230 peak 40 sessions ago, a pullback, then `last` closes. */
function baseSeries(closes299 = 224, closes298 = 205) {
  const c = [];
  for (let i = 0; i < 259; i++) c.push(bar(i, 100 + i * 0.45));
  c.push(bar(259, 228, { high: 230 }));
  for (let i = 260; i < 299; i++) c.push(bar(i, 205 + ((i * 7) % 11), { low: i === 275 ? 190 : undefined }));
  c[298] = bar(298, closes298);
  c.push(bar(299, closes299));
  return c;
}

test("closing above a base high today is a new breakout; a breakout that falls back is a failed one", () => {
  assert.ok(measureDailyChange(baseSeries(235, 205)).includes("baseBreakout"));
  assert.ok(!measureDailyChange(baseSeries(224, 205)).includes("baseBreakout"));
  const failed = measureDailyChange(baseSeries(224, 235));
  assert.ok(failed.includes("baseFailed"));
  assert.ok(!failed.includes("baseBreakout"));
  // Breakout yesterday, higher again today: follow-through, neither a new breakout nor a failure.
  const kept = measureDailyChange(baseSeries(240, 235));
  assert.ok(!kept.includes("baseBreakout") && !kept.includes("baseFailed"));
  // Dipped from yesterday's close but still above the 230 base high it cleared: not failed.
  assert.ok(!measureDailyChange(baseSeries(232, 235)).includes("baseFailed"));
  // Back at the base high exactly: failed.
  assert.ok(measureDailyChange(baseSeries(230, 235)).includes("baseFailed"));
});

test("summary, sentence, grouping and sector tally", () => {
  const rows = [
    { symbol: "A", name: "A", sector: "Healthcare", rs: 90, kinds: ["enteredStage2", "above50"] },
    { symbol: "B", name: "B", sector: "Healthcare", rs: 70, kinds: ["enteredStage2"] },
    { symbol: "C", name: "C", sector: null, rs: null, kinds: ["enteredStage2", "baseBreakout"] },
    { symbol: "D", name: "D", sector: "Energy", rs: 50, kinds: ["leftStage2", "below50"] },
  ];
  const s = summarizeChanges(rows);
  assert.equal(s.counts.enteredStage2, 3);
  assert.equal(s.counts.leftStage2, 1);
  assert.equal(s.netStage2, 2);
  assert.equal(s.counts.newHigh, 0);
  assert.match(changeSentence(s, 1000), /^3 stocks entered Stage 2 and 1 left it \(\+2 net\); 1 new base breakout and 0 failed; 1 crossed above the 50-day and 1 below, of 1,000 scored\.$/);
  assert.match(changeSentence(summarizeChanges([]), 5), /^No stock entered or left Stage 2/);
  assert.deepEqual(groupRows(rows, "enteredStage2").map((r) => r.symbol), ["A", "B", "C"]); // RS high to low, blanks last
  assert.deepEqual(sectorTally(rows, "enteredStage2"), [{ sector: "Healthcare", count: 2 }]); // the unsectored stock is not tallied
});
