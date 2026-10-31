import { getDailyCandles, getDataSource } from "@/lib/market/engine";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";
import { settlePerSymbol } from "@/lib/market/fetchUniverse";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import type { Candle } from "@/lib/market/types";
import { isKnownSymbol } from "@/lib/market/universe";

export const dynamic = "force-dynamic";

const MAX_HISTORY_SYMBOLS = 100;
// The stock drawer's chart asks for the full ~3-year snapshot history.
const MAX_HISTORY_CANDLES = 750;

function parseHistorySymbols(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (/^[A-Z0-9&.-]+$/.test(symbol)) seen.add(symbol);
    if (seen.size >= MAX_HISTORY_SYMBOLS) break;
  }
  return [...seen];
}

/**
 * Daily OHLCV candles for the setup cards. Universe names come from the same
 * snapshot the scan used, so a card's chart matches its row; anything else
 * falls back to the provider.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = parseHistorySymbols(url.searchParams.get("symbols"));
  const symbols = requested.filter(isKnownSymbol);
  const unknown = requested.filter((symbol) => !isKnownSymbol(symbol));
  if (!symbols.length) {
    return Response.json(
      { error: requested.length ? `Unknown NSE symbol: ${unknown.join(", ")}` : "Provide one or more NSE symbols." },
      { status: requested.length ? 404 : 400 },
    );
  }
  const limit = Math.min(MAX_HISTORY_CANDLES, Math.max(20, Number(url.searchParams.get("limit")) || 80));

  const state = getUniverseSnapshot();
  const snapshotHistories = state.status === "ready" ? state.snapshot.histories : null;
  const fromSnapshot: [string, Candle[]][] = [];
  const remaining: string[] = [];
  for (const symbol of symbols) {
    const candles = snapshotHistories?.get(symbol);
    if (candles?.length) fromSnapshot.push([symbol, candles.slice(-limit)]);
    else remaining.push(symbol);
  }

  try {
    const { entries, unavailable } = remaining.length
      ? await settlePerSymbol(remaining, (symbol) => getDailyCandles(symbol, limit))
      : { entries: [], unavailable: [] };

    return Response.json(
      { candles: Object.fromEntries([...fromSnapshot, ...entries]), unavailable: [...unavailable, ...unknown], dataSource: getDataSource() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (fromSnapshot.length) {
      return Response.json(
        { candles: Object.fromEntries(fromSnapshot), unavailable: [...remaining, ...unknown], dataSource: getDataSource() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return marketProviderErrorResponse(error);
  }
}