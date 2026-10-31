import { clearAccount, readAccount, writeAccount } from "@/lib/positions/account";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** The account size saved on this computer, or null. Saving one turns on the private "tomorrow's plan" email. */
export function GET() {
  return Response.json({ accountSize: readAccount() }, { headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let body: { accountSize?: unknown } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  if (!writeAccount(body.accountSize)) return Response.json({ error: "Enter an account size between ₹10,000 and ₹100 crore." }, { status: 400, headers });
  return Response.json({ accountSize: readAccount() }, { headers });
}

/** Turns the plan email off. */
export function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  clearAccount();
  return Response.json({ accountSize: null }, { headers });
}
