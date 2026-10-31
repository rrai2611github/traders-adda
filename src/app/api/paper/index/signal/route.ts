import { frameworkSignal } from "@/lib/paper/indexPaperServer";

export const dynamic = "force-dynamic";

/** The daily-trend and hourly-entry framework as a live checklist for one index, with a sized proposal when it passes. */
export async function GET(request: Request) {
  const index = new URL(request.url).searchParams.get("index")?.toUpperCase();
  if (index !== "NIFTY" && index !== "BANKNIFTY") return Response.json({ error: "index must be NIFTY or BANKNIFTY." }, { status: 400 });
  try {
    return Response.json(await frameworkSignal(index), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Framework signal unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
