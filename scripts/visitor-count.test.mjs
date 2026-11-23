import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";

const { authDbPool } = await import("../src/lib/auth-db.ts");
const { recordAccountVisit, visitorCounts } = await import("../src/lib/visitor-count.ts");

test("counts unique signed-in accounts once per IST day", async () => {
  const visits = new Map();
  const query = async (statement, values = []) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    if (sql.startsWith("INSERT INTO account_visits")) {
      visits.set(`${values[0]}:${values[1]}`, { userId: values[0], date: values[1] });
      return { rows: [] };
    }
    if (sql.startsWith("SELECT")) {
      const today = values[0];
      return {
        rows: [{
          all_time_unique_accounts: new Set([...visits.values()].map(({ userId }) => userId)).size,
          today_unique_accounts: [...visits.values()].filter(({ date }) => date === today).length,
        }],
      };
    }
    throw new Error(`Unexpected visitor-count query: ${sql}`);
  };
  const originalQuery = authDbPool.query;
  authDbPool.query = query;
  try {
    await recordAccountVisit("member-a", Date.parse("2026-11-23T18:25:00Z"));
    await recordAccountVisit("member-a", Date.parse("2026-11-23T18:29:00Z"));
    await recordAccountVisit("member-a", Date.parse("2026-11-23T18:31:00Z"));
    await recordAccountVisit("member-b", Date.parse("2026-11-23T18:31:00Z"));

    assert.deepEqual(await visitorCounts(Date.parse("2026-11-23T18:31:00Z")), {
      allTimeUniqueAccounts: 2,
      todayUniqueAccounts: 2,
    });
    assert.deepEqual(await visitorCounts(Date.parse("2026-11-23T18:29:00Z")), {
      allTimeUniqueAccounts: 2,
      todayUniqueAccounts: 1,
    });
  } finally {
    authDbPool.query = originalQuery;
  }
});
