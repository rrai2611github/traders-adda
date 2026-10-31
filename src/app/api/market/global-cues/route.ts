import { getMarketCues } from "@/lib/market/globalCues";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";

export const dynamic = "force-dynamic";

/**
 * Overnight cues and previous-session index ranges for the morning brief.
 * The brief itself is assembled on the client so it can mix in the live scan.
 */
export async function GET() {
  try {
    return Response.json(await getMarketCues(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marketProviderErrorResponse(error);
  }
}
