import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireAuthDb } from "./auth-db.ts";
import { parseStoredHoldings, type Holding, type HoldingsChange } from "./positions/positions.ts";
import { legacyTrackerForImport, parseTrackerConfig, type TrackerConfig } from "./backtest/tracker.ts";

const LEGACY_POSITIONS_FILE = join(process.cwd(), ".cache", "positions.json");

function legacyHoldingsForImport(): Holding[] {
  if (!existsSync(LEGACY_POSITIONS_FILE)) return [];
  const parsed = JSON.parse(readFileSync(LEGACY_POSITIONS_FILE, "utf8")) as { holdings?: unknown };
  return parseStoredHoldings(parsed.holdings);
}

export async function accountHoldings(userId: string, isAdmin: boolean): Promise<Holding[]> {
  const pool = requireAuthDb();
  let result = await pool.query<{ holdings: unknown }>(
    "SELECT holdings FROM user_positions WHERE user_id = $1",
    [userId],
  );
  if (!result.rows[0]) {
    const initial = isAdmin ? legacyHoldingsForImport() : [];
    await pool.query(
      `INSERT INTO user_positions (user_id, holdings, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, JSON.stringify(initial)],
    );
    result = await pool.query<{ holdings: unknown }>(
      "SELECT holdings FROM user_positions WHERE user_id = $1",
      [userId],
    );
  }
  const saved = result.rows[0];
  if (!saved) throw new Error("Could not load the account positions row.");
  return parseStoredHoldings(saved.holdings);
}

export async function updateAccountHoldings(
  userId: string,
  isAdmin: boolean,
  update: (holdings: Holding[]) => HoldingsChange,
): Promise<HoldingsChange> {
  const client = await requireAuthDb().connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    let result = await client.query<{ holdings: unknown }>(
      "SELECT holdings FROM user_positions WHERE user_id = $1 FOR UPDATE",
      [userId],
    );
    if (!result.rows[0]) {
      const initial = isAdmin ? legacyHoldingsForImport() : [];
      await client.query(
        `INSERT INTO user_positions (user_id, holdings, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, JSON.stringify(initial)],
      );
      result = await client.query<{ holdings: unknown }>(
        "SELECT holdings FROM user_positions WHERE user_id = $1 FOR UPDATE",
        [userId],
      );
    }
    const saved = result.rows[0];
    if (!saved) throw new Error("Could not load the account positions row.");
    const changed = update(parseStoredHoldings(saved.holdings));
    if (!changed.ok) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return changed;
    }
    await client.query(
      "UPDATE user_positions SET holdings = $2::jsonb, updated_at = now() WHERE user_id = $1",
      [userId, JSON.stringify(changed.holdings)],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return changed;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[account-data] positions rollback failed:", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function accountTracker(userId: string, isAdmin: boolean): Promise<TrackerConfig | null> {
  const pool = requireAuthDb();
  let result = await pool.query<{ config: unknown }>(
    "SELECT config FROM user_strategy_trackers WHERE user_id = $1",
    [userId],
  );
  if (!result.rows[0]) {
    const initial = isAdmin ? legacyTrackerForImport() : null;
    await pool.query(
      `INSERT INTO user_strategy_trackers (user_id, config, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, initial ? JSON.stringify(initial) : null],
    );
    result = await pool.query<{ config: unknown }>(
      "SELECT config FROM user_strategy_trackers WHERE user_id = $1",
      [userId],
    );
  }
  const saved = result.rows[0];
  if (!saved) throw new Error("Could not load the account strategy row.");
  if (saved.config == null) return null;
  const config = parseTrackerConfig(saved.config);
  if (!config) throw new Error("The saved account strategy configuration is invalid.");
  return config;
}

export async function saveAccountTracker(userId: string, config: TrackerConfig): Promise<void> {
  await requireAuthDb().query(
    `INSERT INTO user_strategy_trackers (user_id, config, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [userId, JSON.stringify(config)],
  );
}

export async function clearAccountTracker(userId: string): Promise<void> {
  await requireAuthDb().query(
    `INSERT INTO user_strategy_trackers (user_id, config, updated_at)
     VALUES ($1, NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET config = NULL, updated_at = now()`,
    [userId],
  );
}
