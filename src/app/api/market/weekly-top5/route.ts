import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getMarketStatus } from "@/lib/market/marketHours";
import { getWeeklyTop5 } from "@/lib/screen/weeklyTop5Results";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // `?limit=100` lists more than the five, to see where a stock ranks.
    const asked = Number(new URL(request.url).searchParams.get("limit"));
    const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, 200) : undefined;
    const state = getWeeklyTop5(getMarketStatus().isLive ? "live" : "completed", limit);
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    return Response.json(state.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[weekly-top5] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
