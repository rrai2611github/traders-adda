import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import nseEquities from "@/lib/market/data/nse-equities.json";
import { scanUniverse } from "@/lib/screen/scan";
import { DAILY_CHANGE_RULES, measureDailyChange, type ChangeKind, type ChangeRow } from "@/lib/screen/dailyChanges";
import { stage2SectorOf } from "@/lib/screen/sectorStage2";

export const dynamic = "force-dynamic";

const NSE_SECTORS: ReadonlySet<string> = new Set((nseEquities.equities as { industry?: string | null }[]).map((e) => e.industry).filter((s): s is string => !!s));

/** What changed on the latest finished session across the liquid universe. Finished sessions only, so a forming candle never counts. */
export async function GET() {
  try {
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    const { snapshot } = state;
    const session = getActiveSession();
    const scan = scanUniverse(snapshot);
    const names = new Map(EQUITIES.map((stock) => [stock.symbol, { name: stock.name, sector: stock.sector }]));
    const liquid = scan.metrics.filter((row) => row.passesFloor);

    let latest = 0;
    const measured: { row: (typeof liquid)[number]; kinds: ChangeKind[]; close: number; prev: number; at: number }[] = [];
    for (const row of liquid) {
      const done = (scan.candlesBySymbol.get(row.symbol) ?? []).filter((c) => {
        const day = istDateKey(c.t);
        return day < session.dateKey || (day === session.dateKey && session.progress === 1);
      });
      if (done.length < DAILY_CHANGE_RULES.minCandles) continue;
      const at = done[done.length - 1].t;
      latest = Math.max(latest, at);
      measured.push({ row, kinds: measureDailyChange(done), close: done[done.length - 1].close, prev: done[done.length - 2].close, at });
    }

    // A stock whose last candle is older than the latest session did not trade then; its "change" would be stale.
    const rows: ChangeRow[] = [];
    let scored = 0;
    for (const m of measured) {
      if (m.at < latest - 12 * 3600e3) continue;
      scored += 1;
      if (!m.kinds.length) continue;
      const info = names.get(m.row.symbol);
      rows.push({
        symbol: m.row.symbol,
        name: info?.name ?? m.row.symbol,
        sector: stage2SectorOf(info?.sector, NSE_SECTORS),
        close: m.close,
        dayChangePercent: m.prev ? Math.round((m.close / m.prev - 1) * 10000) / 100 : null,
        rs: m.row.rs,
        turnoverCr: m.row.turnoverCr,
        kinds: m.kinds,
      });
    }
    return Response.json({
      updatedAt: snapshot.completedAt,
      source: getDataSource(),
      eligible: liquid.length,
      scored,
      sessionAt: latest || null,
      rows,
      dataQuality: snapshot.dataQuality,
      refreshFailure: state.refreshFailure,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[daily-changes] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
