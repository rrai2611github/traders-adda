import { NextResponse, type NextRequest } from "next/server";
import { FyersAuthError, fyersConnected } from "@/lib/fyers/fyersClient";
import { getScalpDesk } from "@/lib/scalp/desk";
import { SCALP_INDEXES, type ScalpIndex } from "@/lib/scalp/scalpLogic";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const index = (params.get("index") ?? "NIFTY").toUpperCase();
  if (!(index in SCALP_INDEXES)) {
    return NextResponse.json({ error: "index must be NIFTY or BANKNIFTY" }, { status: 400, headers: noStore });
  }
  const offset = Math.max(-3, Math.min(3, Math.trunc(Number(params.get("offset") ?? 0)) || 0));
  const status = fyersConnected();
  if (!status.configured || !status.connected) {
    return NextResponse.json({ ...status, error: status.configured ? "Fyers login required for today." : "Fyers is not configured." }, { status: 401, headers: noStore });
  }
  try {
    const desk = await getScalpDesk(index as ScalpIndex, offset);
    return NextResponse.json(desk, { headers: noStore });
  } catch (error) {
    if (error instanceof FyersAuthError) {
      return NextResponse.json({ ...fyersConnected(), error: error.message }, { status: 401, headers: noStore });
    }
    return NextResponse.json({ error: (error as Error).message || "Scalp desk failed." }, { status: 502, headers: noStore });
  }
}
