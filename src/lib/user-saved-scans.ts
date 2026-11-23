import type { Pool } from "pg";
import { requireAuthDb } from "./auth-db.ts";
import { validateSavedScans, type SavedScan } from "./screen/stockScreener.ts";

type SavedScanDatabase = Pick<Pool, "query">;

export async function getUserSavedScans(userId: string, db: SavedScanDatabase = requireAuthDb()): Promise<{ exists: boolean; scans: SavedScan[] }> {
  const result = await db.query<{ scans: unknown }>(
    "SELECT scans FROM user_saved_scans WHERE user_id = $1",
    [userId],
  );
  const saved = result.rows[0]?.scans;
  if (saved === undefined) return { exists: false, scans: [] };
  const parsed = validateSavedScans(saved);
  if (!parsed.ok) throw new Error(`Saved scans in the database are invalid: ${parsed.error}`);
  return { exists: true, scans: parsed.scans };
}

export async function saveUserScans(userId: string, scans: SavedScan[], db: SavedScanDatabase = requireAuthDb()): Promise<void> {
  await db.query(
    `INSERT INTO user_saved_scans (user_id, scans, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET scans = EXCLUDED.scans, updated_at = now()`,
    [userId, JSON.stringify(scans)],
  );
}
