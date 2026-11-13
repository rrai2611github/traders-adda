import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getMarketStatus } from "@/lib/market/marketHours";
import { getStage2BasesResults } from "@/lib/screen/stage2BasesResults";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // While the market is open the scan runs on today's forming candle so a live breakout shows up.
    const state = getStage2BasesResults(getMarketStatus().isLive ? "live" : "completed");
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    return Response.json(state.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[stage-2-bases] Analysis failed:", error);
    return marketProviderErrorResponse(error);
  }
}
