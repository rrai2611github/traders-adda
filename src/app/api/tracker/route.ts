import { accountTracker, clearAccountTracker, saveAccountTracker } from "@/lib/account-data";
import { refreshHistory } from "@/lib/backtest/historyRefresh";
import { LIVE_RULES, createTrackerConfig, trackerStateFor, writeLegacyTracker } from "@/lib/backtest/tracker";
import { getMarketStatus } from "@/lib/market/marketHours";
import { trackerAlertStatus } from "@/lib/backtest/trackerAlertServer";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function syncAdminTracker(config: Awaited<ReturnType<typeof accountTracker>>, isAdmin: boolean): string | undefined {
  if (!isAdmin) return undefined;
  try {
    writeLegacyTracker(config);
    return undefined;
  } catch (error) {
    console.error("[tracker] admin legacy mirror failed:", error);
    return "Your database save succeeded, but admin background alerts may be delayed.";
  }
}

function response(config: Awaited<ReturnType<typeof accountTracker>>, isAdmin: boolean, warning?: string) {
  return {
    ...trackerStateFor(config),
    rules: LIVE_RULES,
    isAdmin,
    alertStatus: isAdmin ? trackerAlertStatus() : "Practice email alerts are only enabled for the admin account.",
    ...(warning ? { warning } : {}),
  };
}

/** The signed-in user's strategy configuration and result. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });
  const isAdmin = session.user.role === "admin";
  try {
    const config = await accountTracker(session.user.id, isAdmin);
    const warning = syncAdminTracker(config, isAdmin);
    return Response.json(response(config, isAdmin, warning), { headers });
  } catch (error) {
    console.error("[tracker] account load failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the strategy test." }, { status: 500, headers });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** Start or stop the signed-in user's paper test; only admins can trigger a shared price-history refresh. */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let body: { action?: string; capital?: number; niftyGate?: boolean; stopPercent?: number } = {};
  try { body = await request.json(); } catch { /* an empty body reads the current state */ }

  const isAdmin = session.user.role === "admin";
  try {
    if (body.action === "start") {
      const config = createTrackerConfig({ capital: Number(body.capital) || undefined, niftyGate: body.niftyGate === true, stopPercent: Number(body.stopPercent) });
      await saveAccountTracker(session.user.id, config);
      const warning = syncAdminTracker(config, isAdmin);
      return Response.json(response(config, isAdmin, warning), { headers });
    }
    if (body.action === "stop") {
      await clearAccountTracker(session.user.id);
      const warning = syncAdminTracker(null, isAdmin);
      return Response.json(response(null, isAdmin, warning), { headers });
    }
    if (body.action === "refresh") {
      if (!isAdmin) return Response.json({ error: "Only administrators can refresh shared price history." }, { status: 403, headers });
      if (getMarketStatus().isLive) return Response.json({ error: "The market is open: today's candle is still forming. Update after about 4:30 pm IST." }, { status: 409, headers });
      void refreshHistory();
    } else if (body.action != null) {
      return Response.json({ error: "Unknown action." }, { status: 400, headers });
    }
    const config = await accountTracker(session.user.id, isAdmin);
    const warning = syncAdminTracker(config, isAdmin);
    return Response.json(response(config, isAdmin, warning), { headers });
  } catch (error) {
    console.error("[tracker] account update failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the strategy test." }, { status: 500, headers });
  }
}
