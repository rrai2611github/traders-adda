import { NextResponse, type NextRequest } from "next/server";
import { isIntradayTimeframe } from "@/lib/chart/intraday";
import { FyersAuthError, fyersConnected } from "@/lib/fyers/fyersClient";
import { getFyersDailyCandles, getFyersIntradayCandles } from "@/lib/fyers/fyersCandles";
import { isKnownSymbol } from "@/lib/market/universe";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Stock chart candles from Fyers: `resolution=D` (default, `sessions` bars) or
 * intraday `1|5|15|60`. 401 when not logged in so the UI falls back to Yahoo.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9&.-]+$/.test(symbol) || !isKnownSymbol(symbol)) {
    return NextResponse.json({ error: "Unknown NSE symbol" }, { status: 404, headers: noStore });
  }
  const resolution = params.get("resolution") ?? "D";
  if (resolution !== "D" && !isIntradayTimeframe(resolution)) {
    return NextResponse.json({ error: "resolution must be D, 1, 5, 15 or 60" }, { status: 400, headers: noStore });
  }
  const sessions = Math.min(1000, Math.max(20, Number(params.get("sessions")) || 750));
  if (!fyersConnected().connected) {
    return NextResponse.json({ error: "Fyers not connected" }, { status: 401, headers: noStore });
  }
  try {
    const data = resolution === "D" ? await getFyersDailyCandles(symbol, sessions) : await getFyersIntradayCandles(symbol, resolution);
    return NextResponse.json({ ...data, source: "fyers" }, { headers: noStore });
  } catch (error) {
    const status = error instanceof FyersAuthError ? 401 : 502;
    return NextResponse.json({ error: (error as Error).message }, { status, headers: noStore });
  }
}
