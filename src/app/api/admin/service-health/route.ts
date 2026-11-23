import { adminSessionFromRequest } from "@/lib/auth-session";
import { requireAuthDb } from "@/lib/auth-db";
import { historyLastDay, refreshState, historyReady } from "@/lib/backtest/historyRefresh";
import { dataFreshness } from "@/lib/market/freshness";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!await adminSessionFromRequest(request)) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers });
  }

  const now = Date.now();
  const history = refreshState();
  const latestSession = historyLastDay();
  const freshness = dataFreshness({ lastCandleDay: latestSession, refreshedDay: history.lastDay, now });
  let database: { status: "ok" | "failed"; message: string };
  try {
    const result = await requireAuthDb().query("SELECT 1 AS connected");
    if (result.rows[0]?.connected !== 1) throw new Error("The database health check returned no result.");
    database = { status: "ok", message: "Database connection is healthy." };
  } catch (error) {
    console.error("[admin-service-health] database check failed:", error);
    database = { status: "failed", message: "Database connection failed. Check the server logs and database configuration." };
  }

  return Response.json({
    checkedAt: new Date(now).toISOString(),
    database,
    priceData: {
      status: freshness.state,
      latestSession,
      expectedSession: freshness.expected,
      message: history.status === "failed" ? history.message : freshness.message,
      refreshStatus: history.status,
      refreshMessage: history.message,
      lastRefreshAt: history.lastRunAt === null ? null : new Date(history.lastRunAt).toISOString(),
      initialized: historyReady(),
    },
  }, { headers });
}
