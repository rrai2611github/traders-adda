import { performanceReport } from "@/lib/performance/report";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  try {
    return Response.json(performanceReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[performance] report failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Performance report unavailable." },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
