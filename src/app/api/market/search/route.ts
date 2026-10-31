import { searchInstruments } from "@/lib/market/universe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const results = searchInstruments(query).map((i) => ({
    symbol: i.symbol,
    name: i.name,
    exchange: i.exchange,
    kind: i.kind,
    sector: i.sector,
  }));

  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
