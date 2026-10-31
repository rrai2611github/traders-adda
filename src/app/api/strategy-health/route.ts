import { currentHealth } from "@/lib/backtest/healthServer";

export const dynamic = "force-dynamic";

/** Is the edge still there? The rules' recent backtest against their history, and the live check against the backtest. */
export async function GET() {
  return Response.json(currentHealth(), { headers: { "Cache-Control": "no-store" } });
}
