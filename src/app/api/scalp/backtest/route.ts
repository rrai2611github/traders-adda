import { NextResponse, type NextRequest } from "next/server";
import { FyersAuthError, fyersConnected } from "@/lib/fyers/fyersClient";
import { getScalpBacktest } from "@/lib/scalp/backtestRun";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const days = Math.max(30, Math.min(730, Math.trunc(Number(request.nextUrl.searchParams.get("days") ?? 365)) || 365));
  const status = fyersConnected();
  if (!status.configured || !status.connected) {
    return NextResponse.json({ ...status, error: status.configured ? "Fyers login required for today." : "Fyers is not configured." }, { status: 401, headers: noStore });
  }
  try {
    return NextResponse.json(await getScalpBacktest(days), { headers: noStore });
  } catch (error) {
    if (error instanceof FyersAuthError) {
      return NextResponse.json({ ...fyersConnected(), error: error.message }, { status: 401, headers: noStore });
    }
    return NextResponse.json({ error: (error as Error).message || "Backtest failed." }, { status: 502, headers: noStore });
  }
}
