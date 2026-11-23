import { sessionFromRequest } from "@/lib/auth-session";
import { getUserSavedScans, saveUserScans } from "@/lib/user-saved-scans";
import { validateSavedScans } from "@/lib/screen/stockScreener";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  try {
    return Response.json(await getUserSavedScans(session.user.id), { headers: noStore });
  } catch (error) {
    console.error("[saved-scans] load failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load saved scans." }, { status: 500, headers: noStore });
  }
}

export async function PUT(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("scans" in body)) {
    return Response.json({ error: "Request must include a scans list." }, { status: 400, headers: noStore });
  }
  const validated = validateSavedScans(body.scans);
  if (!validated.ok) return Response.json({ error: validated.error }, { status: 400, headers: noStore });

  try {
    await saveUserScans(session.user.id, validated.scans);
    return Response.json({ exists: true, scans: validated.scans }, { headers: noStore });
  } catch (error) {
    console.error("[saved-scans] save failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not save scans." }, { status: 500, headers: noStore });
  }
}
