import { currentHealth } from "@/lib/backtest/healthServer";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

/** Is the edge still there? The rules' recent backtest against their history, and the live check against the backtest. */
export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return Response.json(currentHealth(), { headers: { "Cache-Control": "no-store" } });
}
