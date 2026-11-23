import { adminSessionFromRequest } from "@/lib/auth-session";
import { recentAdminActions } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!await adminSessionFromRequest(request)) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers });
  }
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "Use a limit from 1 to 100." }, { status: 400, headers });
  }
  try {
    return Response.json({ events: await recentAdminActions(limit) }, { headers });
  } catch (error) {
    console.error("[admin-audit] list failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the admin audit log." }, { status: 500, headers });
  }
}
