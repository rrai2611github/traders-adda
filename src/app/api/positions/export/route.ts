import { istToday } from "@/lib/positions/positions";
import { positionsCsv } from "@/lib/positions/positionsServer";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

/** Every position, open and closed, as a CSV file the user can keep or open in a spreadsheet. */
export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return new Response(`﻿${positionsCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-positions-${istToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
