import { NextResponse } from "next/server";
import { FyersAuthError, fyersConnected } from "@/lib/fyers/fyersClient";
import { paperStraddleReport, refreshPaperStraddle } from "@/lib/scalp/paperStraddleRun";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Paper straddle record. Refreshes from Fyers when connected; always returns what is stored. */
export async function GET() {
  const status = fyersConnected();
  let refreshError: string | null = null;
  if (status.configured && status.connected) {
    try {
      await refreshPaperStraddle();
    } catch (error) {
      refreshError = error instanceof FyersAuthError ? error.message : (error as Error).message || "Refresh failed.";
    }
  }
  return NextResponse.json({ ...paperStraddleReport(), fyers: fyersConnected(), refreshError }, { headers: noStore });
}
