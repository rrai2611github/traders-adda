import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { emailActivityStore, EMAIL_ACTIVITY_LIMIT, emailFailureDetail } from "../src/lib/alerts/emailActivity.ts";
import { emailScheduleStatus, readEmailCheckpoint } from "../src/lib/alerts/emailActivityStatus.ts";
import { scheduledEmailBlockReason } from "../src/lib/alerts/emailScheduleActivity.ts";

function withStore(check) {
  const directory = mkdtempSync(join(tmpdir(), "traders-email-activity-"));
  const file = join(directory, "email-activity.json");
  try { check(emailActivityStore(file), file, directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
const input = (overrides = {}) => ({ source: "hourly", status: "accepted", subject: "Hourly update", detail: "Provider accepted; inbox unconfirmed.", ...overrides });
const at = (value) => Date.parse(`${value}+05:30`);
const checkpoint = { lastSentSlotKey: null, lastAttemptAt: null, lastError: null };

test("activity persists across store instances, newest first, with all outcome shapes", () => {
  withStore((store, file, directory) => {
    assert.deepEqual(store.read(), []);
    for (const status of ["accepted", "partial", "failed", "skipped"]) store.append(input({ status, test: true }));
    const entries = emailActivityStore(file).read();
    assert.deepEqual(entries.map((entry) => entry.status), ["skipped", "failed", "partial", "accepted"]);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 4);
    assert.ok(entries.every((entry) => entry.test && Number.isFinite(entry.at)));
    assert.deepEqual(readdirSync(directory), ["email-activity.json"], "atomic saves leave no temporary files");
  });
});

test("repeated holiday skips are deduplicated but a new day/reason is recorded", () => {
  withStore((store) => {
    const skip = input({ status: "skipped", dedupeKey: "hourly:2026-11-10:holiday" });
    store.append(skip);
    store.append(skip);
    store.append({ ...skip, dedupeKey: "hourly:2026-11-11:disabled" });
    assert.equal(store.read().length, 2);
  });
});

test("history is bounded at exactly 200 events and text fields are bounded", () => {
  withStore((store) => {
    for (let i = 0; i < EMAIL_ACTIVITY_LIMIT + 5; i += 1) store.append(input({ at: i }));
    assert.equal(store.read().length, 200);
    assert.equal(store.read()[0].at, 204);
    assert.equal(store.read().at(-1).at, 5);
    store.append(input({ subject: "x".repeat(300), detail: "x".repeat(600) }));
    assert.equal(store.read()[0].subject.length, 250);
    assert.equal(store.read()[0].detail.length, 500);
  });
});

test("invalid saved history is surfaced and never overwritten", () => {
  withStore((store, file) => {
    for (const raw of ["broken json", "{}", '[{"id":42}]']) {
      writeFileSync(file, raw);
      assert.throws(() => store.read());
      assert.throws(() => store.append(input()));
      assert.equal(readFileSync(file, "utf8"), raw);
    }
  });
});

test("filesystem failures are not interpreted as empty history", () => {
  withStore((_store, file) => {
    mkdirSync(file);
    assert.throws(() => emailActivityStore(file).read());
  });
});

test("public failure details contain error codes, never credentials or addresses", () => {
  assert.match(emailFailureDetail({ code: "EAUTH", message: "user password secret@example.com" }), /EAUTH/);
  assert.doesNotMatch(emailFailureDetail({ code: "EAUTH", message: "user password secret@example.com" }), /password|secret@/);
  assert.doesNotMatch(emailFailureDetail({ code: "secret@example.com" }), /secret@/);
});

test("checkpoints surface corruption rather than showing a successful or reset scheduler", () => {
  withStore((_store, file) => {
    assert.deepEqual(readEmailCheckpoint(file), checkpoint);
    writeFileSync(file, JSON.stringify(checkpoint));
    assert.deepEqual(readEmailCheckpoint(file), checkpoint);
    writeFileSync(file, "{}");
    assert.throws(() => readEmailCheckpoint(file), /invalid/);
  });
});

test("schedule monitor reflects holiday/disabled states and real retry eligibility", () => {
  const previous = { MARKET_HOLIDAYS: process.env.MARKET_HOLIDAYS, MARKET_FORCE_LIVE: process.env.MARKET_FORCE_LIVE };
  process.env.MARKET_HOLIDAYS = "";
  process.env.MARKET_FORCE_LIVE = "0";
  try {
    const holiday = at("2026-11-10T10:15:00");
    assert.match(scheduledEmailBlockReason(true, true, holiday), /holiday/);
    assert.equal(emailScheduleStatus("hourly", true, true, null, checkpoint, holiday).status, "paused");
    const trading = at("2026-11-11T10:16:00");
    assert.match(scheduledEmailBlockReason(false, true, trading), /turned off/);
    assert.match(scheduledEmailBlockReason(true, false, trading), /incomplete/);
    assert.equal(emailScheduleStatus("hourly", true, true, null, checkpoint, trading).status, "waiting");
    const slot = "2026-11-11:1";
    assert.equal(emailScheduleStatus("hourly", true, true, slot, checkpoint, trading).status, "eligible");
    assert.equal(emailScheduleStatus("hourly", true, true, slot, { ...checkpoint, lastSentSlotKey: slot }, trading).status, "accepted");
    const failed = { ...checkpoint, lastAttemptAt: trading, lastError: "Provider failure" };
    const retry = emailScheduleStatus("hourly", true, true, slot, failed, trading);
    assert.equal(retry.status, "retry-pending");
    assert.match(retry.detail, /10:26/);
    assert.match(emailScheduleStatus("pre-open", true, true, "pre-open", failed, trading).detail, /10:21/);
    assert.equal(emailScheduleStatus("hourly", true, true, null, failed, trading).status, "waiting", "no false pending retry outside the send window");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("the email API transport records outcomes and test tags without making network calls", () => {
  withStore((_store, _file, directory) => {
    const smtp = new URL("../src/lib/alerts/smtp.ts", import.meta.url).href;
    const activity = new URL("../src/lib/alerts/emailActivity.ts", import.meta.url).href;
    const skips = new URL("../src/lib/alerts/emailScheduleActivity.ts", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      import { writeFileSync } from "node:fs";
      let outcome = "accepted";
      Object.assign(process.env, {RESEND_API_KEY:"unused", EMAIL_FROM:"sender@example.com", EMAIL_TO:"unused@example.com"});
      globalThis.fetch = async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer unused");
        if (outcome === "failed") throw Object.assign(new Error("private provider details"), {code:"ECONNECTION"});
        if (outcome === "none") return new Response("{}", {status:422});
        return new Response(JSON.stringify({id:"mock-id"}), {status:200});
      };
      const {sendEmail} = await import(${JSON.stringify(smtp)});
      const {readEmailActivity} = await import(${JSON.stringify(activity)});
      const {recordScheduledEmailSkip} = await import(${JSON.stringify(skips)});
      await sendEmail("Hourly", "<p>private body</p>", "private body", [], undefined, "hourly");
      outcome = "accepted";
      await sendEmail("[TEST] Pre-open", "", "", [], undefined, "pre-open");
      outcome = "failed";
      await assert.rejects(sendEmail("Owner", "", "", [], undefined, "owner"));
      outcome = "none";
      await assert.rejects(sendEmail("No recipients", "", ""));
      recordScheduledEmailSkip("hourly", "Market holiday", 1794280000000);
      recordScheduledEmailSkip("hourly", "Market holiday", 1794280000000);
      const entries = readEmailActivity();
      assert.deepEqual(entries.map(e=>e.status), ["skipped","failed","failed","accepted","accepted"]);
      assert.equal(entries[3].test,true);
      assert.equal(entries[4].source,"hourly");
      assert.doesNotMatch(JSON.stringify(entries), /private@example|private body|private provider/);
      writeFileSync(".cache/email-activity.json", "corrupt");
      outcome = "accepted";
      assert.equal(await sendEmail("Must not duplicate after logging failure", "", ""), "mock-id");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory, encoding: "utf8", timeout: 20_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});
