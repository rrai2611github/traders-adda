import { DEFAULT_INDEX_SYMBOLS } from "@/lib/market/universe";
import {
  getDataSource,
  getQuotes,
  getStatus,
  parseSymbols,
} from "@/lib/market/engine";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";

export const dynamic = "force-dynamic";

/**
 * Snapshot endpoint. Doubles as the polling fallback when a client cannot hold
 * an SSE connection open (restrictive proxies, backgrounded mobile tabs).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = parseSymbols(url.searchParams.get("symbols"));
  const symbols = requested.length ? requested : DEFAULT_INDEX_SYMBOLS;

  try {
    return Response.json(
      {
        quotes: await getQuotes(symbols),
        status: getStatus(),
        dataSource: getDataSource(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return marketProviderErrorResponse(error);
  }
}
