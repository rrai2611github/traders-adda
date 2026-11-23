import { accountHoldings, updateAccountHoldings } from "@/lib/account-data";
import { sessionFromRequest } from "@/lib/auth-session";
import {
  addHoldingTo,
  markHoldingSold,
  positionsViewFor,
  removeHoldingFrom,
  updateHoldingSourceIn,
  writeLegacyHoldings,
} from "@/lib/positions/positionsServer";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Each signed-in account sees only its own recorded positions and journal. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });
  try {
    const holdings = await accountHoldings(session.user.id, session.user.role === "admin");
    return Response.json(positionsViewFor(holdings), { headers });
  } catch (error) {
    console.error("[positions] account load failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load positions." }, { status: 500, headers });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** `{action: "add" | "sell" | "remove" | "source", ...}` updates only the signed-in user's records. */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send a JSON object." }, { status: 400, headers });
  }

  try {
    const isAdmin = session.user.role === "admin";
    const changed = await updateAccountHoldings(session.user.id, isAdmin, (holdings) => (
      body.action === "add" ? addHoldingTo(holdings, body)
        : body.action === "sell" ? markHoldingSold(holdings, body.id, body)
          : body.action === "remove" ? removeHoldingFrom(holdings, body.id)
            : body.action === "source" ? updateHoldingSourceIn(holdings, body.id, body.source)
              : { ok: false, error: "Unknown action.", status: 400 }
    ));
    if (!changed.ok) return Response.json({ error: changed.error }, { status: changed.status, headers });

    let warning: string | undefined;
    if (isAdmin) {
      try {
        writeLegacyHoldings(changed.holdings);
      } catch (error) {
        console.error("[positions] admin legacy mirror failed:", error);
        warning = "Your database save succeeded, but admin background alerts may be delayed.";
      }
    }
    return Response.json({ view: positionsViewFor(changed.holdings), ...(warning ? { warning } : {}) }, { headers });
  } catch (error) {
    console.error("[positions] account update failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not save positions." }, { status: 500, headers });
  }
}
