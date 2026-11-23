import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";

const { authDbPool } = await import("../src/lib/auth-db.ts");
const { accountHoldings, accountTracker, saveAccountTracker, updateAccountHoldings } = await import("../src/lib/account-data.ts");
const { parseNewHolding } = await import("../src/lib/positions/positions.ts");
const { createTrackerConfig } = await import("../src/lib/backtest/tracker.ts");

test("positions and strategy settings are isolated per account", async () => {
  const positions = new Map();
  const trackers = new Map();
  const query = async (statement, values = []) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    const userId = values[0];
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.startsWith("SELECT holdings FROM user_positions")) {
      return { rows: positions.has(userId) ? [{ holdings: positions.get(userId) }] : [] };
    }
    if (sql.startsWith("INSERT INTO user_positions")) {
      if (!positions.has(userId)) positions.set(userId, JSON.parse(values[1]));
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE user_positions SET holdings")) {
      positions.set(userId, JSON.parse(values[1]));
      return { rows: [] };
    }
    if (sql.startsWith("SELECT config FROM user_strategy_trackers")) {
      return { rows: trackers.has(userId) ? [{ config: trackers.get(userId) }] : [] };
    }
    if (sql.startsWith("INSERT INTO user_strategy_trackers") && sql.includes("DO NOTHING")) {
      if (!trackers.has(userId)) trackers.set(userId, values[1] == null ? null : JSON.parse(values[1]));
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO user_strategy_trackers")) {
      trackers.set(userId, values[1] == null ? null : JSON.parse(values[1]));
      return { rows: [] };
    }
    throw new Error(`Unexpected account-data query: ${sql}`);
  };
  const originalQuery = authDbPool.query;
  const originalConnect = authDbPool.connect;
  authDbPool.query = query;
  authDbPool.connect = async () => ({ query, release() {} });
  try {
    const when = Date.parse("2026-11-23T10:00:00+05:30");
    const input = { symbol: "RELIANCE", qty: 10, buyPrice: 1000, buyDate: "2026-11-23", stop: 880 };
    const addPosition = (current, payload) => {
      const parsed = parseNewHolding(payload, when);
      return parsed.ok ? { ok: true, holdings: [...current, { id: randomUUID(), ...parsed.value }] } : { ok: false, error: parsed.error, status: 400 };
    };
    const added = await updateAccountHoldings("member-a", false, (current) => addPosition(current, input));
    assert.equal(added.ok, true);
    assert.deepEqual((await accountHoldings("member-b", false)), []);

    const memberB = await updateAccountHoldings("member-b", false, (current) => addPosition(current, { ...input, symbol: "TCS" }));
    assert.equal(memberB.ok, true);
    assert.deepEqual((await accountHoldings("member-a", false)).map((holding) => holding.symbol), ["RELIANCE"]);
    assert.deepEqual((await accountHoldings("member-b", false)).map((holding) => holding.symbol), ["TCS"]);

    const aConfig = createTrackerConfig({ capital: 250_000, stopPercent: 12, now: when });
    const bConfig = createTrackerConfig({ capital: 500_000, stopPercent: 8, now: when });
    await saveAccountTracker("member-a", aConfig);
    await saveAccountTracker("member-b", bConfig);
    assert.deepEqual(await accountTracker("member-a", false), aConfig);
    assert.deepEqual(await accountTracker("member-b", false), bConfig);
  } finally {
    authDbPool.query = originalQuery;
    authDbPool.connect = originalConnect;
  }
});
