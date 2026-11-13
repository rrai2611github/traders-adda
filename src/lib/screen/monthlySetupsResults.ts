import { getDataSource } from "@/lib/market/engine";
import { EQUITIES } from "@/lib/market/universe";
import type { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { scanUniverse } from "@/lib/screen/scan";
import { latestCompletedMonth, measureMonthlySetups, type MonthlySetupsPayload } from "@/lib/screen/monthlySetups";

type ReadySnapshot = Extract<ReturnType<typeof getUniverseSnapshot>, { status: "ready" }>;

let cache: { key: string; payload: MonthlySetupsPayload } | null = null;

/**
 * Monthly breakouts and compressions for the liquid universe. The analysis walks every eligible stock's
 * history, so the result is kept until the universe snapshot refreshes (its completedAt changes) or the
 * signal month rolls over; the Monthly Setups page and the sidebar count share it.
 */
export function getMonthlySetupsPayload(state: ReadySnapshot, now = Date.now()): MonthlySetupsPayload {
  const signalMonth = latestCompletedMonth(now);
  const key = `${state.snapshot.completedAt}|${signalMonth}|${state.refreshFailure ? "f" : "ok"}`;
  if (cache?.key === key) return cache.payload;

  const scan = scanUniverse(state.snapshot);
  const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock.name]));
  const eligible = scan.metrics.filter((row) => row.passesFloor);
  const payload: MonthlySetupsPayload = {
    updatedAt: state.snapshot.completedAt, signalMonth,
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
  cache = { key, payload };
  return payload;
}
