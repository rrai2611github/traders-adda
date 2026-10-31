import { getRsiEdgeSourceResults } from "@/lib/screen/rsiEdgeChartink";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getRsiEdgeSourceResults();
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Chartink error.";
    console.error("Unable to load RSI Edge Chartink results:", error);
    return Response.json(
      { error: `RSI Edge source results are unavailable. ${detail}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
