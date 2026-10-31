import { getDataSource, getIntradaySeries } from "@/lib/market/engine";
import { isKnownSymbol } from "@/lib/market/universe";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";
import { settlePerSymbol } from "@/lib/market/fetchUniverse";

export const dynamic = "force-dynamic";

/** Intraday points for sparklines. Accepts one or more comma-separated symbols. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s && isKnownSymbol(s))
    .slice(0, 60);

  try {
    const { entries, unavailable } = await settlePerSymbol(symbols, (symbol) =>
      getIntradaySeries(symbol, 48),
    );

    return Response.json(
      { series: Object.fromEntries(entries), unavailable, dataSource: getDataSource() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return marketProviderErrorResponse(error);
  }
}
