import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getMarketStatus } from "@/lib/market/marketHours";
import { getBottomedOutResults } from "@/lib/screen/bottomedOutResults";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // While the market is open the screen runs on today's forming candle so it matches the latest price.
    const state = getBottomedOutResults(getMarketStatus().isLive ? "live" : "completed");
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    return Response.json(state.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bottomed-out] Analysis failed:", error);
    return marketProviderErrorResponse(error);
  }
}
