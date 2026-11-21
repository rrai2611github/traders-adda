import { NextResponse } from "next/server";
import { clearFyersToken, fyersConnected } from "@/lib/fyers/fyersClient";
import { fyersFeedStats } from "@/lib/market/providers/fyers";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return NextResponse.json({ ...fyersConnected(), feed: fyersFeedStats(), provider: process.env.MARKET_PROVIDER ?? "yahoo" }, { headers: { "Cache-Control": "no-store" } });
}

/** Disconnect: forget today's token. */
export async function DELETE(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  clearFyersToken();
  return NextResponse.json(fyersConnected(), { headers: { "Cache-Control": "no-store" } });
}
