import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { movingAverageBreadth } from "./breadth";
import { marketMode, type MarketMode } from "./breadthHistory";
import { SCANNER_KEYS } from "./chartinkScans";
import { getScannerResults } from "./scannerResults";
import { scanUniverse } from "./scan";
import { measureTop5, rankTop5, top5Size, TOP5_RULES, type Top5Pick, type Top5Size } from "./weeklyTop5";

type SnapshotState = ReturnType<typeof getUniverseSnapshot>;

export interface WeeklyTop5Payload {
  provisional: boolean;
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  /** Share of liquid stocks above their 50-day average, 0-100. */
  breadth50: number | null;
  mode: MarketMode | null;
  size: Top5Size;
  /** Stocks that pass every rule before the top 5 are chosen. */
  qualifying: number;
  picks: Top5Pick[];
}

export type WeeklyTop5State =
  | { status: "ready"; payload: WeeklyTop5Payload }
  | Exclude<SnapshotState, { status: "ready" }>;

/** The Weekly Top 5 from the same scan the other screens use. `live` also uses today's forming candle. */
export function getWeeklyTop5(mode: "completed" | "live" = "completed", limit: number = TOP5_RULES.limit): WeeklyTop5State {
  const state = getUniverseSnapshot();
  if (state.status !== "ready") return state as Exclude<SnapshotState, { status: "ready" }>;
  const session = getActiveSession();
  const scan = scanUniverse(state.snapshot);
  const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock]));
  const eligible = scan.metrics.filter((row) => row.passesFloor);

  const scanners = new Map<string, number>();
  const scannerState = getScannerResults("completed");
  if (scannerState.status === "ready") {
    for (const key of SCANNER_KEYS) {
      for (const row of scannerState.payload.results[key] ?? []) scanners.set(row.symbol, (scanners.get(row.symbol) ?? 0) + 1);
    }
  }

  const found: Top5Pick[] = [];
  for (const row of eligible) {
    if (row.rs == null || row.rs < TOP5_RULES.minRs) continue;
    const done = (scan.candlesBySymbol.get(row.symbol) ?? []).filter((c) => {
      const day = istDateKey(c.t);
      return day < session.dateKey || (day === session.dateKey && (mode === "live" || session.progress === 1));
    });
    const core = measureTop5(done);
    if (!core) continue;
    const stock = names.get(row.symbol);
    found.push({
      ...core,
      spark: done.slice(-40).map((c) => c.close),
      symbol: row.symbol,
      name: stock?.name ?? row.symbol,
      sector: stock?.sector ?? null,
      rs: row.rs,
      scanners: scannerState.status === "ready" ? scanners.get(row.symbol) ?? 0 : null,
      turnoverCr: row.turnoverCr,
    });
  }
  found.sort(rankTop5);

  const breadth50 = movingAverageBreadth(eligible, "vs50").percent;
  const breadth200 = movingAverageBreadth(eligible, "vs200").percent;
  return {
    status: "ready",
    payload: {
      provisional: mode === "live",
      updatedAt: state.snapshot.completedAt,
      source: getDataSource(),
      breadth50,
      mode: breadth50 == null ? null : marketMode(breadth50, breadth200),
      size: top5Size(breadth50),
      qualifying: found.length,
      picks: found.slice(0, limit),
    },
  };
}
