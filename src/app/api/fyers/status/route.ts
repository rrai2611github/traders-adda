import { NextResponse } from "next/server";
import { clearFyersToken, fyersConnected } from "@/lib/fyers/fyersClient";
import { fyersFeedStats } from "@/lib/market/providers/fyers";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...fyersConnected(), feed: fyersFeedStats(), provider: process.env.MARKET_PROVIDER ?? "yahoo" }, { headers: { "Cache-Control": "no-store" } });
}

/** Disconnect: forget today's token. */
export function DELETE() {
  clearFyersToken();
  return NextResponse.json(fyersConnected(), { headers: { "Cache-Control": "no-store" } });
}
