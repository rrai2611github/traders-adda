import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getDataSource } from "@/lib/market/engine";
import { EQUITIES } from "@/lib/market/universe";
import { scanUniverse } from "@/lib/screen/scan";
import { latestCompletedMonth, measureMonthlySetups, type MonthlySetupsPayload } from "@/lib/screen/monthlySetups";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getUniverseSnapshot();
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  try {
    const now = Date.now();
    const scan = scanUniverse(state.snapshot);
    const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock.name]));
    const eligible = scan.metrics.filter((row) => row.passesFloor);
    const payload: MonthlySetupsPayload = {
      updatedAt: state.snapshot.completedAt, signalMonth: latestCompletedMonth(now),
      source: getDataSource(), eligible: eligible.length, analyzed: 0,
      unavailable: state.snapshot.unavailable, issues: [], rows: [],
      dataQuality: state.snapshot.dataQuality, refreshFailure: state.refreshFailure,
    };
    for (const row of eligible) {
      const result = measureMonthlySetups(scan.candlesBySymbol.get(row.symbol) ?? [], now, state.snapshot.quotes.get(row.symbol)?.timestamp);
      if (!result.setup) {
        payload.issues.push({ symbol: row.symbol, reason: result.issue ?? "Monthly analysis unavailable." });
        continue;
      }
      payload.analyzed++;
      if (!result.setup.breakout && !result.setup.compression) continue;
      payload.rows.push({ symbol: row.symbol, name: names.get(row.symbol) ?? row.symbol, turnoverCr: row.turnoverCr!, rs: row.rs, setup: result.setup });
    }
    payload.rows.sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol));
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[monthly-setups] Analysis failed:", error);
    return marketProviderErrorResponse(error);
  }
}
