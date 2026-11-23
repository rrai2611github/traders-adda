import { adminSessionFromRequest } from "@/lib/auth-session";
import { visitorCounts } from "@/lib/visitor-count";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!await adminSessionFromRequest(request)) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers });
  }
  try {
    return Response.json(await visitorCounts(), { headers });
  } catch (error) {
    console.error("[visitor-count] admin load failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load visitor counts." }, { status: 500, headers });
  }
}
