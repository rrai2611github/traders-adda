import test from "node:test";
import assert from "node:assert/strict";
import { REMINDER_MINUTES, reminderDue } from "../src/lib/fyers/reminderRules.ts";

const m = (h, min) => h * 60 + min;

test("the first reminder is due from 08:45 and not before", () => {
  assert.equal(reminderDue(m(8, 44), 0), false);
  assert.equal(reminderDue(m(8, 45), 0), true);
  assert.equal(reminderDue(m(8, 50), 0), true);
});

test("later reminders wait for their own time: 09:00 then 09:10", () => {
  assert.equal(reminderDue(m(8, 59), 1), false);
  assert.equal(reminderDue(m(9, 0), 1), true);
  assert.equal(reminderDue(m(9, 5), 2), false);
  assert.equal(reminderDue(m(9, 10), 2), true);
});

test("never more than three, and none after the cutoff", () => {
  assert.equal(REMINDER_MINUTES.length, 3);
  assert.equal(reminderDue(m(9, 12), 3), false);
  assert.equal(reminderDue(m(9, 25), 0), false, "a late restart does not nag right at the open");
  assert.equal(reminderDue(m(14, 0), 0), false);
});
