import { getResultsDates } from "@/lib/market/boardMeetings";
import { istDateKey } from "@/lib/market/marketHours";

export const dynamic = "force-dynamic";

/** Upcoming results dates by symbol, from NSE's board-meeting calendar. */
export async function GET() {
  const result = await getResultsDates(istDateKey());
  if (!result) return Response.json({ error: "Results dates are not available right now." }, { status: 503 });
  return Response.json({ ...result, today: istDateKey() }, { headers: { "Cache-Control": "no-store" } });
}
