import { addHolding, markSold, positionsView, removeHolding, updateHoldingSource } from "@/lib/positions/positionsServer";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** The user's real positions, each checked against the exit rules, plus the journal of closed trades. */
export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return Response.json(positionsView(), { headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** `{action: "add" | "sell" | "remove" | "source", ...}`. The app only records what the user did; it never places an order. */
export async function POST(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send a JSON object." }, { status: 400, headers });
  }
  const result = body.action === "add" ? addHolding(body)
    : body.action === "sell" ? markSold(body.id, body)
    : body.action === "remove" ? removeHolding(body.id)
    : body.action === "source" ? updateHoldingSource(body.id, body.source)
    : null;
  if (!result) return Response.json({ error: "Unknown action." }, { status: 400, headers });
  return result.ok ? Response.json(result.view, { headers }) : Response.json({ error: result.error }, { status: result.status, headers });
}
