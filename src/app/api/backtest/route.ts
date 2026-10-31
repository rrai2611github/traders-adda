import { getBacktest, startBacktest } from "@/lib/backtest/jobs";
import { parseSettings } from "@/lib/backtest/validate";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** POST settings: starts (or returns the saved result of) a backtest. */
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const job = startBacktest(parseSettings(body));
  return Response.json(job, { headers });
}

/** GET ?id=…: progress or result of a started backtest. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const job = /^[0-9a-f]{16}$/.test(id) ? getBacktest(id) : null;
  if (!job) return Response.json({ status: "unknown" }, { status: 404, headers });
  return Response.json(job, { headers });
}
