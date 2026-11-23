import { accountTracker } from "@/lib/account-data";
import { currentHealthFor } from "@/lib/backtest/healthServer";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

/** Is the edge still there? The rules' recent backtest against their history, and the live check against the backtest. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const config = await accountTracker(session.user.id, session.user.role === "admin");
    return Response.json(currentHealthFor(config), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[strategy-health] account check failed:", error);
    return Response.json({ status: "failed", message: error instanceof Error ? error.message : "Could not check strategy health." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
