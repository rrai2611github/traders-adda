import { istToday } from "@/lib/positions/positions";
import { positionsCsvFor } from "@/lib/positions/positionsServer";
import { accountHoldings } from "@/lib/account-data";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

/** Every position, open and closed, as a CSV file the user can keep or open in a spreadsheet. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const holdings = await accountHoldings(session.user.id, session.user.role === "admin");
    return new Response(`﻿${positionsCsvFor(holdings)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="my-positions-${istToday()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[positions] account export failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not export positions." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
