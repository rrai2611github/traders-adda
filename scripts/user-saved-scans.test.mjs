import test from "node:test";
import assert from "node:assert/strict";
import { getUserSavedScans, saveUserScans } from "../src/lib/user-saved-scans.ts";

function fakeDatabase() {
  const records = new Map();
  return {
    async query(statement, values) {
      const [userId, value] = values;
      if (statement.startsWith("SELECT scans")) {
        return { rows: records.has(userId) ? [{ scans: records.get(userId) }] : [] };
      }
      if (statement.startsWith("INSERT INTO user_saved_scans")) {
        records.set(userId, JSON.parse(value));
        return { rows: [] };
      }
      throw new Error(`Unexpected saved-scan query: ${statement}`);
    },
  };
}

const scan = (name, search) => ({
  name,
  filter: {
    search, sector: null, stage: null, minRs: null, maxFromHigh: null,
    minTurnoverCr: null, minMcapCr: null, liquidOnly: true,
  },
});

test("saved scans are selected and upserted by the authenticated account id", async () => {
  const db = fakeDatabase();
  const alice = [scan("Alpha", "AAA")];
  const bob = [scan("Beta", "BBB")];

  assert.deepEqual(await getUserSavedScans("alice", db), { exists: false, scans: [] });
  await saveUserScans("alice", alice, db);
  await saveUserScans("bob", bob, db);

  assert.deepEqual(await getUserSavedScans("alice", db), { exists: true, scans: alice });
  assert.deepEqual(await getUserSavedScans("bob", db), { exists: true, scans: bob });
  await saveUserScans("alice", [scan("Alpha", "CCC")], db);
  assert.deepEqual(await getUserSavedScans("alice", db), { exists: true, scans: [scan("Alpha", "CCC")] });
  assert.deepEqual(await getUserSavedScans("bob", db), { exists: true, scans: bob });
});
