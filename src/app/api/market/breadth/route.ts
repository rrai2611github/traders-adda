import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getDataSource } from "@/lib/market/engine";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { breadthSeries, marketMode, type BreadthDay } from "@/lib/screen/breadthHistory";
import { istDayNumber, scanUniverse } from "@/lib/screen/scan";

export const dynamic = "force-dynamic";

let cache: { snapshotId: number; providerId: string; history: BreadthDay[]; covered: number } | null = null;

/** Breadth across the liquid universe: share above the 10/20/50/200-day averages today and for the last ~6 months. */
export async function GET() {
  try {
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    const { snapshot } = state;
    if (!cache || cache.snapshotId !== snapshot.id || cache.providerId !== snapshot.providerId) {
      const scan = scanUniverse(snapshot);
      const liquid = scan.metrics.filter((row) => row.passesFloor);
      const bars = liquid.map((row) => (scan.candlesBySymbol.get(row.symbol) ?? []).map((c) => ({ day: istDayNumber(c.t), close: c.close })));
      cache = { snapshotId: snapshot.id, providerId: snapshot.providerId, history: breadthSeries(bars), covered: liquid.length };
    }
    const latest = cache.history.at(-1) ?? null;
    return Response.json({
      updatedAt: snapshot.completedAt,
      source: getDataSource(),
      covered: cache.covered,
      latest,
      mode: latest ? marketMode(latest.above[50], latest.above[200]) : null,
      history: cache.history,
      refreshFailure: state.refreshFailure,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[breadth] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
