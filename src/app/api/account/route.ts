import { clearAccount, readAccount, writeAccount } from "@/lib/positions/account";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** The account size saved on this computer, or null. Saving one turns on the private "tomorrow's plan" email. */
export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return Response.json({ accountSize: readAccount() }, { headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

export async function POST(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let body: { accountSize?: unknown } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  if (!writeAccount(body.accountSize)) return Response.json({ error: "Enter an account size between ₹10,000 and ₹100 crore." }, { status: 400, headers });
  return Response.json({ accountSize: readAccount() }, { headers });
}

/** Turns the plan email off. */
export async function DELETE(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  clearAccount();
  return Response.json({ accountSize: null }, { headers });
}
