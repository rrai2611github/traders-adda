import { DEFAULT_WATCHLIST } from "@/lib/market/defaults";
import { normalizeWatchlistSymbols } from "@/lib/market/watchlistSymbols";
import { sessionFromRequest } from "@/lib/auth-session";
import { requireAuthDb } from "@/lib/auth-db";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });

  try {
    const result = await requireAuthDb().query<{ symbols: unknown }>(
      "SELECT symbols FROM user_watchlists WHERE user_id = $1",
      [session.user.id],
    );
    const saved = result.rows[0]?.symbols;
    const symbols = saved === undefined ? DEFAULT_WATCHLIST : normalizeWatchlistSymbols(saved);
    return Response.json({ symbols }, { headers: noStore });
  } catch (error) {
    console.error("[watchlist] load failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load watchlist." }, { status: 500, headers: noStore });
  }
}

export async function PUT(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });

  try {
    const body = await request.json() as { symbols?: unknown };
    const symbols = normalizeWatchlistSymbols(body.symbols);
    await requireAuthDb().query(
      `INSERT INTO user_watchlists (user_id, symbols, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET symbols = EXCLUDED.symbols, updated_at = now()`,
      [session.user.id, JSON.stringify(symbols)],
    );
    return Response.json({ symbols }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save watchlist.";
    const invalid = message.includes("must be") || message.startsWith("Invalid watchlist") || message.includes("at most");
    if (!invalid) console.error("[watchlist] save failed:", error);
    return Response.json({ error: message }, { status: invalid ? 400 : 500, headers: noStore });
  }
}
