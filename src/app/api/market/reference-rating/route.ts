import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { scanUniverse } from "@/lib/screen/scan";
import { referenceRating } from "@/lib/screen/referenceRating";

export const dynamic = "force-dynamic";

/** Display-only RS/PA for a stock below the liquidity floor (see referenceRating.ts). */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return Response.json({ error: "Invalid symbol." }, { status: 400 });
  const state = getUniverseSnapshot();
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  const scan = scanUniverse(state.snapshot);
  const metric = scan.metrics.find((m) => m.symbol === symbol);
  if (!metric) return Response.json({ error: "Not measured." }, { status: 404 });
  if (metric.passesFloor) return Response.json({ error: "Rated by the main scan." }, { status: 409 });
  const liquidScores = scan.metrics
    .filter((m) => m.passesFloor)
    .map((m) => scan.returns.get(m.symbol))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const rating = referenceRating(symbol, scan.candlesBySymbol.get(symbol) ?? [], metric.turnoverCr, scan.returns.get(symbol) ?? null, liquidScores);
  if (!rating) return Response.json({ error: "Under ₹1 Cr a day: too illiquid to rate." }, { status: 404 });
  return Response.json(rating, { headers: { "Cache-Control": "no-store" } });
}