import type { NextRequest } from "next/server";
import { auth, assertAuthEnvironment } from "@/lib/auth";

export type AppSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export async function sessionFromRequest(request: Request | NextRequest): Promise<AppSession | null> {
  assertAuthEnvironment();
  return auth.api.getSession({ headers: request.headers }) as Promise<AppSession | null>;
}

export async function sessionFromHeaders(headers: Headers): Promise<AppSession | null> {
  assertAuthEnvironment();
  return auth.api.getSession({ headers }) as Promise<AppSession | null>;
}

export async function adminSessionFromRequest(request: Request | NextRequest): Promise<AppSession | null> {
  const session = await sessionFromRequest(request);
  return session?.user.role === "admin" ? session : null;
}

export async function requireAdminResponse(request: Request | NextRequest): Promise<Response | null> {
  if (await adminSessionFromRequest(request)) return null;
  return Response.json({ error: "Admin access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
