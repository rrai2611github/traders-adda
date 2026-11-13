import { pickCallsView } from "@/lib/radar/radarServer";

export const dynamic = "force-dynamic";

/** First call and time on the list for each recent Top pick, read from the email track record. Read-only: it records and sends nothing. */
export async function GET() {
  try {
    return Response.json(pickCallsView(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[pick-calls] Failed:", error);
    return Response.json({ error: "First calls are unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
