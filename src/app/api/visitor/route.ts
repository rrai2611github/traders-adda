import { sessionFromRequest } from "@/lib/auth-session";
import { recordAccountVisit } from "@/lib/visitor-count";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Counts a signed-in account once per IST calendar day without recording IP or device details. */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  try {
    await recordAccountVisit(session.user.id);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    console.error("[visitor-count] recording failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not record this visit." }, { status: 500, headers });
  }
}
