import { getDataSource } from "@/lib/market/engine";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getScannerResults } from "@/lib/screen/scannerResults";
import type { ScannerMode } from "@/lib/screen/chartinkScans";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("mode");
  const mode: ScannerMode = requested === "live" ? "live" : "completed";
  const state = getScannerResults(mode);
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  return Response.json({ ...state.payload, source: getDataSource() }, { headers: { "Cache-Control": "no-store" } });
}
