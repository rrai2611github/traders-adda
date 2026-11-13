import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getDataSource } from "@/lib/market/engine";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import nseEquities from "@/lib/market/data/nse-equities.json";
import { scanUniverse } from "@/lib/screen/scan";
import { stage2SectorOf } from "@/lib/screen/sectorStage2";
import { LAB_FEATURES, LAB_HORIZONS, buildLabTable, runLabQuery, type LabFilters, type LabHorizon, type LabTable } from "@/lib/screen/setupLab";

export const dynamic = "force-dynamic";

const NSE_SECTORS: ReadonlySet<string> = new Set((nseEquities.equities as { industry?: string | null }[]).map((e) => e.industry).filter((s): s is string => !!s));

interface Build { key: string; table: LabTable | null; promise: Promise<void> | null; done: number; total: number; failure: string | null; stocks: number }
let build: Build | null = null;

/**
 * The Lab's observation table is built once per price snapshot, in the background, in chunks that yield to the event
 * loop so other requests are not held up. Until it is ready the route answers 503 with progress; the page polls.
 */
function ensureBuild(key: string): Build {
  if (build && build.key === key && !build.failure) return build;
  const next: Build = { key, table: null, promise: null, done: 0, total: 0, failure: null, stocks: 0 };
  build = next;
  const state = getUniverseSnapshot();
  if (state.status !== "ready") { next.failure = "Price history is not ready."; return next; }
  const session = getActiveSession();
  const scan = scanUniverse(state.snapshot);
  const sectors = new Map(EQUITIES.map((stock) => [stock.symbol, stock.sector]));
  const stocks = scan.metrics.filter((row) => row.passesFloor).map((row) => ({
    symbol: row.symbol,
    sector: stage2SectorOf(sectors.get(row.symbol), NSE_SECTORS),
    candles: (scan.candlesBySymbol.get(row.symbol) ?? []).filter((c) => {
      const day = istDateKey(c.t);
      return day < session.dateKey || (day === session.dateKey && session.progress === 1);
    }),
  }));
  next.stocks = stocks.length;
  next.total = stocks.length;
  next.promise = buildLabTable(stocks, (done, total) => { next.done = done; next.total = total; })
    .then((table) => { next.table = table; })
    .catch((error) => { console.error("[setup-lab] Build failed:", error); next.failure = error instanceof Error ? error.message : "Build failed."; });
  return next;
}

/** `?stage2=1&base=2,3&h=20`: each feature is a comma-separated list of allowed level numbers. */
function parseQuery(params: URLSearchParams): { filters: LabFilters; horizon: LabHorizon } {
  const filters: LabFilters = {};
  for (const feature of LAB_FEATURES) {
    const raw = params.get(feature.key);
    if (!raw) continue;
    const levels = [...new Set(raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < feature.levels.length))];
    if (levels.length) filters[feature.key] = levels;
  }
  const h = Number(params.get("h"));
  return { filters, horizon: (LAB_HORIZONS as readonly number[]).includes(h) ? (h as LabHorizon) : 20 };
}

export async function GET(request: Request) {
  try {
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    const session = getActiveSession();
    const key = `${state.snapshot.id}:${state.snapshot.providerId}:${session.dateKey}:${session.progress === 1 ? "closed" : "open"}`;
    const current = ensureBuild(key);
    if (current.failure) return marketProviderErrorResponse(new Error(current.failure));
    if (!current.table) {
      const percent = current.total ? Math.round((current.done / current.total) * 100) : 0;
      return Response.json({ warming: true, error: `Building the Setup Lab from ${current.stocks.toLocaleString("en-IN")} stocks: ${percent}%.` }, { status: 503, headers: { "Retry-After": "3" } });
    }
    const { filters, horizon } = parseQuery(new URL(request.url).searchParams);
    const result = runLabQuery(current.table, filters, horizon);
    const names = new Map(EQUITIES.map((stock) => [stock.symbol, stock.name]));
    return Response.json({
      updatedAt: state.snapshot.completedAt,
      source: getDataSource(),
      stocks: current.stocks,
      ...result,
      matchingNow: { total: result.matchingNow.total, rows: result.matchingNow.rows.map((row) => ({ ...row, name: names.get(row.symbol) ?? row.symbol })) },
      dataQuality: state.snapshot.dataQuality,
      refreshFailure: state.refreshFailure,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[setup-lab] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
