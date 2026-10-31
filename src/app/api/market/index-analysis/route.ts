import { getIndexContext } from "@/lib/market/indexContext";
import { marketProviderErrorResponse } from "@/lib/market/apiErrors";
import { readIndexOutlookJournal, summarizeIndexOutlookJournal } from "@/lib/market/indexOutlookJournal";
import type { IndexContext } from "@/lib/market/indexContext";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mode = new URL(request.url).searchParams.get("mode") ?? "completed";
  if (mode !== "completed" && mode !== "live") {
    return Response.json({ error: "mode must be completed or live." }, { status: 400 });
  }
  try {
    const context = await getIndexContext(mode);
    let journal: IndexContext["journal"] = context.journal;
    if (journal?.status !== "error") {
      try {
        const stored = await readIndexOutlookJournal();
        journal = stored.status === "available"
          ? { status: "available", records: stored.value.records.sort((a, b) => b.tradingDate.localeCompare(a.tradingDate)),
            summary: summarizeIndexOutlookJournal(stored.value.records) }
          : stored;
      } catch (error) {
        console.error("[index] outlook journal read failed:", error);
        journal = { status: "error", reason: "Outlook journal could not be read. Check server logs and disk permissions." };
      }
    }
    return Response.json({ ...context, journal }, { status: Object.keys(context.analysis).length || Object.keys(context.breadthByIndex).length ? 200 : 503,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marketProviderErrorResponse(error);
  }
}
