import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getMonthlySetupsPayload } from "@/lib/screen/monthlySetupsResults";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getUniverseSnapshot();
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  try {
    // Cached until the universe snapshot refreshes; the sidebar count shares the same result.
    return Response.json(getMonthlySetupsPayload(state), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[monthly-setups] Analysis failed:", error);
    return marketProviderErrorResponse(error);
  }
}
