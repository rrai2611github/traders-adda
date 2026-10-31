import { getMovers } from "@/lib/market/engine";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 20) : 5;

  try {
    return Response.json(await getMovers(limit), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return marketProviderErrorResponse(error);
  }
}
