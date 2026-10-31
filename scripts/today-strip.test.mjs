import test from "node:test";
import assert from "node:assert/strict";
import { healthTile, liveTile, positionsTile } from "../src/lib/screen/todayStrip.ts";

const pos = (...statuses) => ({ open: statuses.map((status) => ({ assessment: { status } })) });

test("positions: none, all fine, near a stop, and needing a decision", () => {
  assert.equal(positionsTile(pos()).big, "None open");
  assert.equal(positionsTile(pos()).href, "/positions");
  const fine = positionsTile(pos("hold", "hold"));
  assert.deepEqual([fine.big, fine.tone], ["2 open", "good"]);
  const near = positionsTile(pos("hold", "close-to-stop"));
  assert.equal(near.tone, "warn");
  assert.match(near.sub, /1 is close to the stop/);
  const due = positionsTile(pos("hold", "exit-signal", "stop-hit"));
  assert.deepEqual([due.big, due.tone], ["2 need a decision", "bad"]);
  assert.equal(positionsTile(pos("stop-hit")).big, "1 needs a decision");
  assert.equal(positionsTile(null).big, "Checking…");
});

const done = (open, closed, ret) => ({
  config: { startDate: "2026-10-31" },
  job: { status: "done", result: { stats: { totalReturnPercent: ret }, openPositions: Array(open).fill({}), trades: [...Array(closed).fill({ exitReason: "trail" }), ...Array(open).fill({ exitReason: "end" })] } },
});

test("live check: not started, waiting, no trades, and results with the right colour", () => {
  assert.equal(liveTile({ config: null, job: { status: "none" } }).big, "Not started");
  const waiting = liveTile({ config: { startDate: "2026-10-31" }, job: { status: "waiting" } });
  assert.equal(waiting.big, "Waiting");
  assert.match(waiting.sub, /Following since 2026-10-31/);
  assert.equal(liveTile(done(0, 0, 0)).big, "No trades yet");
  const few = liveTile(done(2, 3, 4.2));
  assert.equal(few.big, "2 open · 3 closed");
  assert.match(few.sub, /\+4\.2% since 2026-10-31/);
  assert.equal(few.tone, "neutral");
  assert.equal(liveTile(done(1, 20, 12)).tone, "good");
  const down = liveTile(done(1, 20, -6.04));
  assert.equal(down.tone, "warn");
  assert.match(down.sub, /−6\.0% since/);
  assert.equal(liveTile({ config: { startDate: "2026-10-31" }, job: { status: "failed" } }).tone, "warn");
  assert.equal(liveTile(null).big, "Checking…");
});

test("strategy health: each verdict in words and colour; running and failed are quiet", () => {
  const h = (verdict, headline = "h") => healthTile({ status: "done", report: { verdict, headline } });
  assert.deepEqual([h("on-track").big, h("on-track").tone], ["On track", "good"]);
  assert.deepEqual([h("early").big, h("early").tone], ["Too early", "neutral"]);
  assert.deepEqual([h("watch", "Watch: average trade.").big, h("watch").tone], ["Watch", "warn"]);
  assert.equal(h("watch", "Watch: average trade.").sub, "Watch: average trade.");
  assert.deepEqual([h("review").big, h("review").tone], ["Review", "bad"]);
  assert.equal(healthTile({ status: "running" }).big, "Checking…");
  assert.equal(healthTile({ status: "failed" }).big, "Unavailable");
  assert.equal(healthTile(null).big, "Checking…");
});
