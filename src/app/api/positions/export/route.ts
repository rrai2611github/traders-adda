import { istToday } from "@/lib/positions/positions";
import { positionsCsv } from "@/lib/positions/positionsServer";

export const dynamic = "force-dynamic";

/** Every position, open and closed, as a CSV file the user can keep or open in a spreadsheet. */
export function GET() {
  return new Response(`﻿${positionsCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-positions-${istToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
