import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { scanUniverse } from "./scan";
import { measureBottomedOut, rankBottomedOut, type BottomedOutPayload, type BottomedOutPick } from "./bottomedOut";

type SnapshotState = ReturnType<typeof getUniverseSnapshot>;

export type BottomedOutState =
  | { status: "ready"; payload: BottomedOutPayload }
  | Exclude<SnapshotState, { status: "ready" }>;

/**
 * The bottomed-out screen on liquid stocks. `completed` (default) uses finished sessions only; `live` also uses today's
 * forming candle, built from the latest quote, so the base, the EMA reclaim and the stop and target sit on today's price.
 * A live result is provisional: a stock can pass at 11:00 and fail by the close.
 */
export function getBottomedOutResults(mode: "completed" | "live" = "completed"): BottomedOutState {
  const state = getUniverseSnapshot();
  if (state.status !== "ready") return state as Exclude<SnapshotState, { status: "ready" }>;
  const session = getActiveSession();
  const scan = scanUniverse(state.snapshot);
  const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock.name]));
  const eligible = scan.metrics.filter((row) => row.passesFloor);
  let latest = 0;
  const found: { pick: BottomedOutPick; at: number }[] = [];
  for (const row of eligible) {
    // Completed sessions only: today's candle counts once the session has closed.
    const done = (scan.candlesBySymbol.get(row.symbol) ?? []).filter((c) => {
      const day = istDateKey(c.t);
      return day < session.dateKey || (day === session.dateKey && (mode === "live" || session.progress === 1));
    });
    if (!done.length) continue;
    const at = done[done.length - 1].t;
    latest = Math.max(latest, at);
    const core = measureBottomedOut(done);
    if (core) found.push({ at, pick: { ...core, symbol: row.symbol, name: names.get(row.symbol) ?? row.symbol, rs: row.rs, turnoverCr: row.turnoverCr } });
  }
  // A stock whose last candle is older than the latest session did not trade then; drop its stale hit.
  const rows = found.filter(({ at }) => at >= latest - 12 * 3600e3).map(({ pick }) => pick).sort(rankBottomedOut);
  return {
    status: "ready",
    payload: {
      provisional: mode === "live",
      updatedAt: state.snapshot.completedAt,
      source: getDataSource(),
      eligible: eligible.length,
      drawdowns: eligible.filter((row) => (row.fromHigh ?? 0) >= 35).length,
      unavailable: state.snapshot.unavailable,
      rows,
      dataQuality: state.snapshot.dataQuality,
      refreshFailure: state.refreshFailure,
    },
  };
}
