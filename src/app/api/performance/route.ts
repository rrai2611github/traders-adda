import { performanceReport } from "@/lib/performance/report";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(performanceReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[performance] report failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Performance report unavailable." },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
