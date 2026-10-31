import test from "node:test";
import assert from "node:assert/strict";
import { ENOUGH, recordMentions, scoreEntry, summarise, groupLabel } from "../src/lib/radar/radar.ts";

const mention = (symbol, over = {}) => ({ symbol, name: `${symbol} Ltd`, sector: null, list: "top-picks", tag: "ready", price: 100, rs: 90, buy: 100, stop: 88, target1: 116, target2: 124, rank: 1, ...over });
const ctx = (day, over = {}) => ({ day, at: Date.parse(`${day}T04:00:00Z`), email: "pre-open", breadth50: 40, ...over });

test("a stock is saved with the email's own numbers, and a repeat within ten days only counts a mention", () => {
  const first = recordMentions([], [mention("AAA")], ctx("2026-11-02"));
  assert.equal(first.added, 1);
  assert.deepEqual([first.entries[0].price, first.entries[0].stop, first.entries[0].firstDay, first.entries[0].breadth50, first.entries[0].mentions], [100, 88, "2026-11-02", 40, 1]);
  const again = recordMentions(first.entries, [mention("AAA", { price: 105 })], ctx("2026-11-05", { email: "hourly" }));
  assert.equal(again.added, 0);
  assert.equal(again.entries.length, 1);
  assert.deepEqual([again.entries[0].mentions, again.entries[0].lastDay, again.entries[0].price, again.entries[0].email], [2, "2026-11-05", 100, "pre-open"]);
});

test("a stock that comes back after more than ten days, or with a new tag, is a new entry", () => {
  const a = recordMentions([], [mention("AAA")], ctx("2026-11-02")).entries;
  assert.equal(recordMentions(a, [mention("AAA")], ctx("2026-11-12")).added, 0);
  assert.equal(recordMentions(a, [mention("AAA")], ctx("2026-11-13")).added, 1);
  const upgraded = recordMentions(recordMentions([], [mention("AAA", { tag: "watch" })], ctx("2026-11-02")).entries, [mention("AAA", { tag: "ready" })], ctx("2026-11-03"));
  assert.equal(upgraded.added, 1);
  assert.deepEqual(upgraded.entries.map((e) => e.tag), ["watch", "ready"]);
});

test("the same stock on two different lists is two entries; repeats inside one email and unusable rows are skipped", () => {
  const out = recordMentions([], [mention("AAA"), mention("AAA", { rank: 2 }), mention("AAA", { list: "buy-list", tag: null }), mention("BAD", { price: 0 }), mention("NAN", { price: NaN })], ctx("2026-11-02"));
  assert.deepEqual(out.entries.map((e) => `${e.symbol}:${e.list}`), ["AAA:top-picks", "AAA:buy-list"]);
});

test("a bad stop or target in an email is saved as missing, never as a wrong number", () => {
  const e = recordMentions([], [mention("AAA", { stop: NaN, target1: -3, target2: null })], ctx("2026-11-02")).entries[0];
  assert.deepEqual([e.stop, e.target1, e.target2], [null, null, null]);
});

// ---- scoring ----
const bar = (date, open, high, low, close) => ({ date, open, high, low, close });
/** `n` quiet sessions starting from a day, each closing at `close`. */
function flat(startDay, n, close = 100) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.parse(`${startDay}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    out.push(bar(d, close, close + 1, close - 1, close));
  }
  return out;
}
const entry = (over = {}) => recordMentions([], [mention("AAA", over.mention)], ctx(over.day ?? "2026-11-02", { email: over.email ?? "pre-open" })).entries[0];
const nifty = flat("2026-01-01", 400, 20000);
const history = flat("2026-01-01", 60, 100); // quiet history so the 50-day average is 100

test("no finished session yet is 'too new'; no price file is 'no data'", () => {
  assert.equal(scoreEntry(entry(), history, nifty).state, "too-new");
  assert.equal(scoreEntry(entry(), [], nifty).state, "no-data");
});

test("a rising stock stays open, with its move, best, worst and R", () => {
  const bars = [...history, bar("2026-03-02", 101, 112, 100, 110), bar("2026-03-03", 110, 118, 108, 115)];
  const e = entry({ day: "2026-03-02" });
  const s = scoreEntry(e, bars, nifty);
  assert.equal(s.state, "open");
  assert.equal(s.sessions, 2);
  assert.equal(s.returnPercent, 15);
  assert.equal(s.best, 18);
  assert.equal(s.worst, 0);
  assert.equal(s.hitTarget1, true); // high 118 >= 116
  assert.equal(s.r, 1.25); // 15 gain on 12 at risk
  assert.equal(s.stop, 88);
});

test("hitting the stop ends it at the stop; a gap under the stop ends it at the open", () => {
  const e = entry({ day: "2026-03-02" });
  const hit = scoreEntry(e, [...history, bar("2026-03-02", 99, 100, 87, 90)], nifty);
  assert.deepEqual([hit.state, hit.exitPrice, hit.r, hit.returnPercent], ["stopped", 88, -1, -12]);
  const gap = scoreEntry(e, [...history, bar("2026-03-02", 80, 85, 78, 82)], nifty);
  assert.deepEqual([gap.state, gap.exitPrice], ["stopped", 80]);
  assert.ok(gap.r < -1);
});

test("stop and target on the same day: the stop is assumed first", () => {
  const e = entry({ day: "2026-03-02" });
  const s = scoreEntry(e, [...history, bar("2026-03-02", 100, 120, 85, 100)], nifty);
  assert.equal(s.state, "stopped");
  assert.equal(s.hitTarget1, false);
});

test("a close under the 50-day average ends it at that close", () => {
  const e = entry({ day: "2026-03-02", mention: { stop: 70 } });
  const s = scoreEntry(e, [...history, bar("2026-03-02", 100, 101, 95, 96)], nifty);
  assert.deepEqual([s.state, s.exitPrice, s.exitDay], ["exited", 96, "2026-03-02"]);
  assert.equal(s.returnPercent, -4);
});

test("a stock listed while under its 50-day average is not exited on day one; the rule starts once it has been above the line", () => {
  const under = [...flat("2026-01-01", 59, 100), bar("2026-03-01", 95, 95, 89, 90)];
  const e = entry({ day: "2026-03-02", mention: { price: 90, stop: 70 } });
  const stays = scoreEntry(e, [...under, bar("2026-03-02", 90, 91, 88, 89)], nifty);
  assert.equal(stays.state, "open");
  const later = scoreEntry(e, [...under, bar("2026-03-02", 90, 103, 89, 102), bar("2026-03-03", 102, 102, 88, 90)], nifty);
  assert.deepEqual([later.state, later.exitDay, later.exitPrice], ["exited", "2026-03-03", 90]);
});

test("an hourly email starts counting from the next session; a pre-open email counts its own day", () => {
  const bars = [...history, bar("2026-03-02", 100, 101, 60, 100), bar("2026-03-03", 100, 103, 99, 102)];
  assert.equal(scoreEntry(entry({ day: "2026-03-02", email: "hourly" }), bars, nifty).state, "open");
  assert.equal(scoreEntry(entry({ day: "2026-03-02", email: "pre-open" }), bars, nifty).state, "stopped");
});

test("5- and 20-session moves are the plain price move, even after a stop; they stay empty until enough sessions pass", () => {
  const bars = [...history, bar("2026-03-02", 100, 100, 80, 85), ...flat("2026-03-03", 6, 110)];
  const s = scoreEntry(entry({ day: "2026-03-02" }), bars, nifty);
  assert.equal(s.state, "stopped");
  assert.equal(s.ret5, 10);
  assert.equal(s.ret20, null);
});

test("with no stop in the email, 12% under the price is used", () => {
  const s = scoreEntry(entry({ day: "2026-03-02", mention: { stop: null } }), [...history, bar("2026-03-02", 100, 101, 99, 100)], nifty);
  assert.equal(s.stop, 88);
});

test("the Nifty move over the same days is taken off", () => {
  const index = [...flat("2026-01-01", 60, 20000), bar("2026-03-02", 20000, 20000, 20000, 21000)];
  const s = scoreEntry(entry({ day: "2026-03-02" }), [...history, bar("2026-03-02", 100, 111, 100, 110)], index);
  assert.equal(s.vsNifty, 5); // +10% stock, +5% Nifty
});

// ---- summary ----
test("the summary counts finished trades for win rate and R, and says when there are too few to judge", () => {
  const score = (state, r, over = {}) => ({ state, sessions: 3, stop: 88, returnPercent: r * 12, ret5: null, ret20: null, best: 0, worst: 0, hitTarget1: false, r, exitDay: null, exitPrice: null, vsNifty: 1, ...over });
  const e = (symbol, over) => recordMentions([], [mention(symbol, over)], ctx("2026-03-02")).entries[0];
  const items = [
    { entry: e("A"), score: score("exited", 2, { hitTarget1: true }) },
    { entry: e("B"), score: score("stopped", -1) },
    { entry: e("C"), score: score("open", 0.5) },
    { entry: e("D"), score: { ...score("too-new", null), returnPercent: null } },
  ];
  const [g] = summarise(items, (x) => ({ key: x.list, label: groupLabel(x) }));
  assert.deepEqual([g.count, g.scored, g.open, g.stopped, g.exited], [4, 3, 1, 1, 1]);
  assert.equal(g.winRate, 50);
  assert.equal(g.avgR, 0.5);
  assert.equal(g.stopRate, 33.3);
  assert.equal(g.hitTarget1, 33.3);
  assert.equal(g.enough, false);
  assert.ok(ENOUGH >= 20);
  assert.equal(g.label, "Top picks · Ready");
});
