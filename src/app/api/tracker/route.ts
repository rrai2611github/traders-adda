import { refreshHistory } from "@/lib/backtest/historyRefresh";
import { LIVE_RULES, startTracker, stopTracker, trackerState } from "@/lib/backtest/tracker";
import { getMarketStatus } from "@/lib/market/marketHours";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** The live strategy check: its configuration, the price-file status and the result so far. */
export async function GET() {
  return Response.json({ ...trackerState(), rules: LIVE_RULES }, { headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** `{action: "start", capital?, niftyGate?}` begins following the rules from today; `stop` ends it; `refresh` downloads the latest finished session. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let body: { action?: string; capital?: number; niftyGate?: boolean; stopPercent?: number } = {};
  try { body = await request.json(); } catch { /* an empty body is a refresh of the view */ }
  if (body.action === "start") startTracker({ capital: Number(body.capital) || undefined, niftyGate: body.niftyGate === true, stopPercent: Number(body.stopPercent) });
  else if (body.action === "stop") stopTracker();
  else if (body.action === "refresh") {
    if (getMarketStatus().isLive) return Response.json({ error: "The market is open: today's candle is still forming. Update after about 4:30 pm IST." }, { status: 409, headers });
    void refreshHistory();
  }
  return Response.json({ ...trackerState(), rules: LIVE_RULES }, { headers });
}
