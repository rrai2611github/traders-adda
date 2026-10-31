import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import {
  createIndexOutlookRecord, evaluateIndexOutlookRecord, summarizeIndexOutlookJournal,
  readIndexOutlookJournal, listIndexOutlookJournal, getIndexOutlookJournalSummary,
  updateIndexOutlookJournal,
  shouldUpdateIndexOutlookJournal,
} from "../src/lib/market/indexOutlookJournal.ts";

const ist = (time) => Date.parse(`${time}+05:30`);
const morning = ist("2026-10-05T09:00:00");
const afterClose = ist("2026-10-05T16:00:00");
const analysis = (overrides = {}) => ({
  asOf: ist("2026-10-01T09:15:00"), provisional: false,
  close: 100, dailyTrend: "Mixed", weeklyTrend: "Mixed", weeklyAsOf: null,
  nearbySupport: { label: "Previous low", price: 95 },
  nearbyResistance: { label: "Previous high", price: 105 },
  structuralLevels: [
    { label: "Deep support", price: 90 }, { label: "Far resistance", price: 110 },
    { label: "Previous low", price: 95 }, { label: "Previous high", price: 105 },
  ],
  summary: "Original conditional outlook",
  rankedLevels: [],
  scenarios: { bullish: "Hold above 105", bearish: "Lose 95", range: "Wait between references" },
  sma20: null, sma50: null, sma200: null, rsi14: null, atr14Percent: null,
  return5d: null, return20d: null, support: 90, resistance: 110,
  high52w: null, low52w: null, from52wHighPercent: null, observations: [],
  ...overrides,
});
const context = (overrides = {}) => ({
  generatedAt: morning, mode: "completed", source: "yahoo",
  analysis: { NIFTY50: analysis() }, niftyBreadth: null, breadthAsOf: null,
  membershipAsOf: "2026-10-01", leadership: "", volatility: "", unavailable: [],
  breadthByIndex: {}, historyCoverage: {},
  ...overrides,
});
const daily = (overrides = {}) => ({
  t: ist("2026-10-05T09:15:00"), open: 100, high: 107, low: 94, close: 106,
  volume: 0, interval: "1d", completed: true, source: "yahoo", ...overrides,
});
const captured = () => createIndexOutlookRecord(context(), "NIFTY50", morning).value;
const rejected = (result, pattern) => {
  assert.equal(result.status, "unavailable");
  if (pattern) assert.match(result.reason, pattern);
};

test("captures actual preopen with prior completed session across a holiday/weekend; detached snapshot", () => {
  const input = context();
  input.analysis.NIFTY50.rankedLevels = [{
    price: 105, score: 75, strength: "Strong", labels: ["Prior high", "Swing high"],
    range: { low: 104, high: 106 },
  }];
  const result = createIndexOutlookRecord(input, "NIFTY50", morning);
  assert.equal(result.status, "available");
  assert.equal(result.value.tradingDate, "2026-10-05");
  assert.equal(result.value.signalSession, ist("2026-10-01T09:15:00"));
  assert.equal(result.value.createdAt, morning);
  assert.equal(result.value.phase, "PREOPEN");
  assert.deepEqual(result.value.levels.rankedSupports.map((level) => level.price), [95, 90]);
  assert.deepEqual(result.value.levels.rankedResistances.map((level) => level.price), [105, 110]);
  input.analysis.NIFTY50.scenarios.bullish = "Revised";
  input.analysis.NIFTY50.nearbySupport.price = 80;
  input.analysis.NIFTY50.rankedLevels[0].labels.push("Revised");
  assert.equal(result.value.analysis.scenarios.bullish, "Hold above 105");
  assert.equal(result.value.levels.nearbySupport.price, 95);
  assert.deepEqual(result.value.analysis.rankedLevels[0].labels, ["Prior high", "Swing high"]);
});

test("window is [08:45,09:15), excludes holidays/weekends and retrospective contexts", () => {
  for (const time of ["2026-10-05T08:44:59", "2026-10-05T09:15:00",
    "2026-10-05T16:00:00", "2026-10-03T09:00:00", "2026-10-02T09:00:00"]) {
    rejected(createIndexOutlookRecord(context({ generatedAt: ist(time) }), "NIFTY50", ist(time)), /window/);
  }
  for (const time of ["2026-10-05T08:45:00", "2026-10-05T09:14:59"]) {
    assert.equal(createIndexOutlookRecord(context({ generatedAt: ist(time) }), "NIFTY50", ist(time)).status, "available");
  }
  rejected(createIndexOutlookRecord(context(), "NIFTY50", ist("2026-10-06T09:00:00")), /stale/);
});

test("rejects live, mock, future, stale, provisional and unavailable inputs", () => {
  for (const source of ["mock", "MOCK-provider", "simulated", "demo", "synthetic", ""]) {
    rejected(createIndexOutlookRecord(context({ source }), "NIFTY50", morning), /source/);
  }
  rejected(createIndexOutlookRecord(context({ mode: "live" }), "NIFTY50", morning), /Completed-mode/);
  for (const generatedAt of [NaN, morning + 1, morning - 300_001]) {
    rejected(createIndexOutlookRecord(context({ generatedAt }), "NIFTY50", morning), /timestamp/);
  }
  for (const asOf of [NaN, morning, ist("2026-09-30T09:15:00"), ist("2026-10-02T09:15:00")]) {
    rejected(createIndexOutlookRecord(context({ analysis: { NIFTY50: analysis({ asOf }) } }), "NIFTY50", morning), /latest completed/);
  }
  rejected(createIndexOutlookRecord(context({ analysis: { NIFTY50: analysis({ provisional: true }) } }), "NIFTY50", morning), /Provisional/);
  rejected(createIndexOutlookRecord(null, "NIFTY50", morning), /missing/);
  rejected(createIndexOutlookRecord(context(), "BANKNIFTY", morning), /missing/);
  rejected(createIndexOutlookRecord(context({ analysis: { NIFTY50: analysis({ close: NaN }) } }), "NIFTY50", morning), /invalid/);
  rejected(createIndexOutlookRecord(context({
    historyCoverage: { NIFTY50: { stale: true } },
  }), "NIFTY50", morning), /stale/);
});

test("scheduler guard accepts actual capture/postclose windows only", () => {
  assert.equal(shouldUpdateIndexOutlookJournal(morning), true);
  assert.equal(shouldUpdateIndexOutlookJournal(afterClose), true);
  for (const time of ["2026-10-05T08:44:59", "2026-10-05T09:15:00",
    "2026-10-05T15:29:59", "2026-10-03T16:00:00", "2026-10-02T09:00:00"]) {
    assert.equal(shouldUpdateIndexOutlookJournal(ist(time)), false);
  }
});

test("evaluation rejects wrong-date/partial/intraday/mock/invalid bars and unfinished targets", () => {
  const record = captured();
  rejected(evaluateIndexOutlookRecord(record, daily(), ist("2026-10-05T15:29:59")), /not completed/);
  for (const override of [
    { t: ist("2026-10-01T09:15:00") }, { t: ist("2026-10-06T09:15:00") },
    { completed: false }, { provisional: true }, { interval: "5m" }, { source: "mock" },
    { high: 99 }, { low: 108 }, { volume: -1 }, { close: NaN },
  ]) rejected(evaluateIndexOutlookRecord(record, daily(override), afterClose));
  rejected(evaluateIndexOutlookRecord(record, null, afterClose), /missing/);
});

test("two-sided breaks are ambiguous with no assumed sequence or trading performance", () => {
  const result = evaluateIndexOutlookRecord(captured(), daily(), afterClose);
  assert.equal(result.status, "available");
  const evaluation = result.value;
  assert.equal(evaluation.path, "ambiguous-intraday-sequence-unknown");
  assert.equal(evaluation.resistance.touched, true);
  assert.equal(evaluation.resistance.broken, true);
  assert.equal(evaluation.resistance.closeStatus, "held");
  assert.equal(evaluation.support.broken, true);
  assert.equal(evaluation.support.closeStatus, "held");
  assert.equal(evaluation.bar.high, 107);
  assert.equal(evaluation.rankedSupports.length, 2);
  assert.doesNotMatch(JSON.stringify(evaluation), /profit|winRate|fill|entry|exit/i);
});

test("equality is touch not break; close failures, gap breaks, and missing levels are explicit", () => {
  const record = captured();
  const equal = evaluateIndexOutlookRecord(record, daily({ high: 105, low: 95, close: 95 }), afterClose).value;
  assert.equal(equal.resistance.touched, true);
  assert.equal(equal.resistance.broken, false);
  assert.equal(equal.resistance.closeStatus, "failed");
  assert.equal(equal.support.broken, false);
  assert.equal(equal.support.closeStatus, "held");
  const lower = evaluateIndexOutlookRecord(record, daily({ high: 100, low: 90, close: 92 }), afterClose).value;
  assert.equal(lower.support.closeStatus, "failed");
  const gap = evaluateIndexOutlookRecord(record, daily({ open: 108, low: 107, high: 111, close: 109 }), afterClose).value;
  assert.equal(gap.resistance.broken, true);
  assert.equal(gap.resistance.touched, false);
  record.levels.nearbySupport = null;
  record.levels.nearbyResistance = null;
  const absent = evaluateIndexOutlookRecord(record, daily(), afterClose).value;
  assert.equal(absent.support, null);
  assert.equal(absent.resistance, null);
  assert.equal(absent.unavailable.length, 2);
});

async function workspaceDirectory(run) {
  // A temporary test directory UNDER THE PROJECT, never the OS temp directory.
  await mkdir(resolve(".cache"), { recursive: true });
  const directory = await mkdtemp(resolve(".cache", "index-journal-test-"));
  try { await run(join(directory, "journal.json"), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("serialized concurrent writes freeze first successful snapshot, append other symbols, persist atomically", async () => {
  await workspaceDirectory(async (filePath, directory) => {
    rejected(await readIndexOutlookJournal(filePath), /missing/);
    rejected(await listIndexOutlookJournal({ filePath }), /missing/);
    rejected(await getIndexOutlookJournalSummary(filePath), /missing/);
    const first = context();
    const second = context({ analysis: { NIFTY50: analysis({ summary: "Revised" }), BANKNIFTY: analysis() } });
    const results = await Promise.all([
      updateIndexOutlookJournal(first, { filePath, now: morning }),
      updateIndexOutlookJournal(second, { filePath, now: morning + 1000 }),
    ]);
    assert.deepEqual(results.map((result) => result.captured), [1, 1]);
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(saved.records.length, 2);
    assert.equal(saved.records.find((record) => record.symbol === "NIFTY50").analysis.summary, "Original conditional outlook");
    assert.equal(saved.records[0].createdAt, morning);
    assert.deepEqual(await readdir(directory), ["journal.json"]);
    assert.equal((await listIndexOutlookJournal({ filePath, symbol: "BANKNIFTY" })).value.length, 1);
    const noBackfill = await updateIndexOutlookJournal(context({
      analysis: { NIFTYMIDCAP: analysis() },
    }), { filePath, now: afterClose });
    assert.equal(noBackfill.captured, 0);
    assert.equal(noBackfill.journal.records.length, 2);
  });
});

test("missing/failed captures are retryable; simulations/weekends never write a file", async () => {
  await workspaceDirectory(async (filePath) => {
    const failed = await updateIndexOutlookJournal(context({ mode: "live" }), { filePath, now: morning });
    assert.equal(failed.captured, 0);
    rejected(await readIndexOutlookJournal(filePath));
    const weekend = await updateIndexOutlookJournal(context(), { filePath, now: ist("2026-10-03T09:00:00") });
    assert.equal(weekend.captured, 0);
    const previous = process.env.MARKET_FORCE_LIVE;
    try {
      process.env.MARKET_FORCE_LIVE = "1";
      assert.equal(shouldUpdateIndexOutlookJournal(morning), true);
      assert.equal(shouldUpdateIndexOutlookJournal(ist("2026-10-03T09:00:00")), false);
      const simulated = await updateIndexOutlookJournal(context(), { filePath, now: morning });
      assert.equal(simulated.captured, 0);
      rejected(await readIndexOutlookJournal(filePath));
    } finally {
      if (previous === undefined) delete process.env.MARKET_FORCE_LIVE;
      else process.env.MARKET_FORCE_LIVE = previous;
    }
    assert.equal((await updateIndexOutlookJournal(context(), { filePath, now: morning })).captured, 1);
  });
});

test("history evaluation selects only the captured date, skips partial duplicates, freezes evaluation", async () => {
  await workspaceDirectory(async (filePath) => {
    await updateIndexOutlookJournal(context(), { filePath, now: morning });
    const partial = await updateIndexOutlookJournal(null, {
      filePath, now: afterClose, bars: { NIFTY50: daily({ completed: false }) },
    });

    assert.equal(partial.evaluated, 0);
    const evaluated = await updateIndexOutlookJournal(null, {
      filePath, now: ist("2026-10-06T16:00:00"),
      histories: new Map([["NIFTY50", [
        daily({ t: ist("2026-10-06T09:15:00") }), daily({ completed: false }), daily(),
      ]]]),
    });
    assert.equal(evaluated.captured, 0);
    assert.equal(evaluated.evaluated, 1);
    assert.equal(evaluated.journal.records[0].evaluation.bar.t, daily().t);
    const revised = await updateIndexOutlookJournal(null, {
      filePath, now: afterClose, bars: { NIFTY50: daily({ close: 100 }) },
    });
    assert.equal(revised.evaluated, 0);
    assert.equal(revised.journal.records[0].evaluation.bar.close, 106);
    assert.deepEqual((await getIndexOutlookJournalSummary(filePath)).value,
      summarizeIndexOutlookJournal(revised.journal.records));
    assert.equal((await getIndexOutlookJournalSummary(filePath)).value.ambiguous, 1);
  });
});

test("parent completed-context API accepts raw provider daily histories without overriding partial markers", async () => {
  await workspaceDirectory(async (filePath) => {
    await updateIndexOutlookJournal(context(), { filePath, now: morning });
    const raw = { ...daily() };
    delete raw.interval;
    delete raw.completed;
    delete raw.source;
    const rawHistories = new Map([["NIFTY50", [raw]]]);
    for (const inputContext of [null, context({ mode: "live" }), context({ source: "mock" })]) {
      assert.equal((await updateIndexOutlookJournal(inputContext, {
        filePath, now: afterClose, histories: rawHistories,
      })).evaluated, 0);
    }
    assert.equal((await updateIndexOutlookJournal(context(), {
      filePath, now: afterClose, histories: new Map([["NIFTY50", [{ ...raw, provisional: true }]]]),
    })).evaluated, 0);
    const result = await updateIndexOutlookJournal(context(), {
      filePath, now: afterClose, histories: rawHistories,
    });
    assert.equal(result.evaluated, 1);
    assert.equal(result.journal.records[0].evaluation.source, "yahoo");
  });
});

test("corrupt/read/write errors reject without overwriting existing data; queue recovers", async () => {
  await workspaceDirectory(async (filePath, directory) => {
    for (const text of ["invalid JSON", JSON.stringify({ version: 2, records: [] }),
      JSON.stringify({ version: 1, records: [captured(), captured()] })]) {
      await writeFile(filePath, text);
      await assert.rejects(readIndexOutlookJournal(filePath), /parse\/validation failed/);
      await assert.rejects(updateIndexOutlookJournal(context(), { filePath, now: morning }), /parse\/validation failed/);
      assert.equal(await readFile(filePath, "utf8"), text);
    }
    await assert.rejects(readIndexOutlookJournal(directory), /read failed/);
    const blocker = join(directory, "blocker");
    await writeFile(blocker, "not a directory");
    await assert.rejects(updateIndexOutlookJournal(context(), {
      filePath: join(blocker, "journal.json"), now: morning,
    }), /read failed|write failed/);
    await rm(filePath);
    assert.equal((await updateIndexOutlookJournal(context(), { filePath, now: morning })).captured, 1);
  });
});

test("atomic rename failure reports a write error, preserves original snapshot and cleans the sibling temp", async () => {
  await workspaceDirectory(async (filePath, directory) => {
    await updateIndexOutlookJournal(context(), { filePath, now: morning });
    const original = await readFile(filePath, "utf8");
    const rename = fs.rename;
    try {
      fs.rename = async () => { throw Object.assign(new Error("Injected rename failure"), { code: "EACCES" }); };
      syncBuiltinESMExports();
      await assert.rejects(updateIndexOutlookJournal(null, {
        filePath, now: afterClose, bars: { NIFTY50: daily() },
      }), /write failed/);
      assert.equal(await readFile(filePath, "utf8"), original);
      assert.deepEqual(await readdir(directory), ["journal.json"]);
    } finally {
      fs.rename = rename;
      syncBuiltinESMExports();
    }
    assert.equal((await updateIndexOutlookJournal(null, {
      filePath, now: afterClose, bars: { NIFTY50: daily() },
    })).evaluated, 1);
  });
});
