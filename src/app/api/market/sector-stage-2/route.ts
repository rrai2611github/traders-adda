import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { istDayNumber, scanUniverse } from "@/lib/screen/scan";
import nseEquities from "@/lib/market/data/nse-equities.json";
import { sectorStage2Series, stage2SectorOf, type SectorStage2Result } from "@/lib/screen/sectorStage2";

export const dynamic = "force-dynamic";

/** NSE's own sector names, as published on the equity master. */
const NSE_SECTORS: ReadonlySet<string> = new Set((nseEquities.equities as { industry?: string | null }[]).map((e) => e.industry).filter((s): s is string => !!s));

let cache: { key: string; result: SectorStage2Result; covered: number } | null = null;

/**
 * Share of each sector's liquid stocks in a Stage 2 uptrend, per session, against the whole market. Finished sessions
 * only: a forming candle would move a stock in and out of Stage 2 within the day.
 */
export async function GET() {
  try {
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    const { snapshot } = state;
    const session = getActiveSession();
    const key = `${snapshot.id}:${snapshot.providerId}:${session.dateKey}:${session.progress === 1 ? "closed" : "open"}`;
    if (!cache || cache.key !== key) {
      const scan = scanUniverse(snapshot);
      const sectors = new Map(EQUITIES.map((stock) => [stock.symbol, stock.sector ?? null]));
      const liquid = scan.metrics.filter((row) => row.passesFloor);
      const stocks = liquid.map((row) => ({
        sector: stage2SectorOf(sectors.get(row.symbol), NSE_SECTORS),
        bars: (scan.candlesBySymbol.get(row.symbol) ?? [])
          .filter((c) => { const day = istDateKey(c.t); return day < session.dateKey || (day === session.dateKey && session.progress === 1); })
          .map((c) => ({ day: istDayNumber(c.t), close: c.close })),
      }));
      cache = { key, result: sectorStage2Series(stocks), covered: liquid.length };
    }
    return Response.json({
      updatedAt: snapshot.completedAt,
      source: getDataSource(),
      covered: cache.covered,
      ...cache.result,
      dataQuality: snapshot.dataQuality,
      refreshFailure: state.refreshFailure,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[sector-stage-2] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
