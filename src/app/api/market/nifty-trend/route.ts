import { readNiftyTrend } from "@/lib/market/niftyTrendServer";

export const dynamic = "force-dynamic";

/** The Nifty 50 against its 200-day average: the extra market check the backtest favoured. */
export async function GET() {
  const trend = await readNiftyTrend();
  if (!trend) return Response.json({ error: "Nifty history is not available right now." }, { status: 503 });
  return Response.json(trend, { headers: { "Cache-Control": "no-store" } });
}
