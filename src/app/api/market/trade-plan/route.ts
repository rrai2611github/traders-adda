import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getMarketStatus, getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { scanUniverse } from "@/lib/screen/scan";
import { buildTradePlan, measurePlanInputs } from "@/lib/screen/tradePlan";
import { readNiftyTrend } from "@/lib/market/niftyTrendServer";
import { setupSize } from "@/lib/screen/setupGate";

export const dynamic = "force-dynamic";

/** Buy, stop and target levels for one stock from its daily candles, plus today's market size note. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase().replace(/^NSE:/, "");
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });
  try {
    const state = getUniverseSnapshot();
    if (state.status === "warming") return universeWarmingResponse(state.progress);
    if (state.status === "failed") return marketProviderErrorResponse(state.error);
    const scan = scanUniverse(state.snapshot);
    const candles = scan.candlesBySymbol.get(symbol);
    if (!candles?.length) return Response.json({ error: `No price history for ${symbol}.` }, { status: 404 });

    // While the market is open the plan sits on today's forming candle, so it matches the latest price.
    const live = getMarketStatus().isLive;
    const session = getActiveSession();
    const used = candles.filter((c) => {
      const day = istDateKey(c.t);
      return day < session.dateKey || (day === session.dateKey && (live || session.progress === 1));
    });
    const inputs = measurePlanInputs(used);
    if (!inputs) return Response.json({ error: `${symbol} has too little price history for a plan.` }, { status: 422 });

    const eligible = scan.metrics.filter((row) => row.passesFloor);
    const breadth50 = movingAverageBreadth(eligible, "vs50").percent;
    return Response.json({
      symbol,
      asOf: used[used.length - 1].t,
      provisional: live,
      inputs,
      plan: buildTradePlan(inputs),
      breadth50,
      size: setupSize(breadth50, await readNiftyTrend()),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[trade-plan] Failed:", error);
    return marketProviderErrorResponse(error);
  }
}
