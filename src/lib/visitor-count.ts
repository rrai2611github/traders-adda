import { requireAuthDb } from "./auth-db.ts";
import { istDateKey } from "./market/marketHours.ts";

export interface VisitorCounts {
  allTimeUniqueAccounts: number;
  todayUniqueAccounts: number;
}

export async function recordAccountVisit(userId: string, now = Date.now()): Promise<void> {
  await requireAuthDb().query(
    `INSERT INTO account_visits (user_id, visit_date, first_seen_at, last_seen_at)
     VALUES ($1, $2::date, now(), now())
     ON CONFLICT (user_id, visit_date)
     DO UPDATE SET last_seen_at = now()`,
    [userId, istDateKey(now)],
  );
}

export async function visitorCounts(now = Date.now()): Promise<VisitorCounts> {
  const result = await requireAuthDb().query<{
    all_time_unique_accounts: number | string;
    today_unique_accounts: number | string;
  }>(
    `SELECT
       (SELECT count(DISTINCT user_id)::int FROM account_visits) AS all_time_unique_accounts,
       (SELECT count(*)::int FROM account_visits WHERE visit_date = $1::date) AS today_unique_accounts`,
    [istDateKey(now)],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Visitor counts were not returned.");
  const allTimeUniqueAccounts = Number(row.all_time_unique_accounts);
  const todayUniqueAccounts = Number(row.today_unique_accounts);
  if (!Number.isInteger(allTimeUniqueAccounts) || allTimeUniqueAccounts < 0 || !Number.isInteger(todayUniqueAccounts) || todayUniqueAccounts < 0) {
    throw new Error("Visitor counts contain invalid values.");
  }
  return { allTimeUniqueAccounts, todayUniqueAccounts };
}
