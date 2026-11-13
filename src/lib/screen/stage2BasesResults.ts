import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { scanUniverse } from "./scan";
import { measureStage2Base, rankStage2Bases, type Stage2BasePick, type Stage2BasesPayload } from "./stage2Bases";

type SnapshotState = ReturnType<typeof getUniverseSnapshot>;

export type Stage2BasesState =
  | { status: "ready"; payload: Stage2BasesPayload }
  | Exclude<SnapshotState, { status: "ready" }>;

/**
 * Stage 2 bases on liquid stocks. `completed` (default) uses finished sessions only; `live` also uses today's forming
 * candle, so a stock that is breaking out right now shows up, but it can fall back under its base before the close.
 */
export function getStage2BasesResults(mode: "completed" | "live" = "completed"): Stage2BasesState {
  const state = getUniverseSnapshot();
  if (state.status !== "ready") return state as Exclude<SnapshotState, { status: "ready" }>;
  const session = getActiveSession();
  const scan = scanUniverse(state.snapshot);
  const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock.name]));
  const eligible = scan.metrics.filter((row) => row.passesFloor);
  let latest = 0;
  const found: { pick: Stage2BasePick; at: number }[] = [];
  for (const row of eligible) {
    const done = (scan.candlesBySymbol.get(row.symbol) ?? []).filter((c) => {
      const day = istDateKey(c.t);
      return day < session.dateKey || (day === session.dateKey && (mode === "live" || session.progress === 1));
    });
    if (!done.length) continue;
    const at = done[done.length - 1].t;
    latest = Math.max(latest, at);
    const core = measureStage2Base(done);
    if (core) found.push({ at, pick: { ...core, symbol: row.symbol, name: names.get(row.symbol) ?? row.symbol, rs: row.rs, turnoverCr: row.turnoverCr } });
  }
  // A stock whose last candle is older than the latest session did not trade then; drop its stale hit.
  const rows = found.filter(({ at }) => at >= latest - 12 * 3600e3).map(({ pick }) => pick).sort(rankStage2Bases);
  return {
    status: "ready",
    payload: {
      provisional: mode === "live",
      updatedAt: state.snapshot.completedAt,
      source: getDataSource(),
      eligible: eligible.length,
      unavailable: state.snapshot.unavailable,
      rows,
      dataQuality: state.snapshot.dataQuality,
      refreshFailure: state.refreshFailure,
    },
  };
}
