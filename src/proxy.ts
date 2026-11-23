import { NextResponse, type NextRequest } from "next/server";
import { auth, assertAuthEnvironment } from "@/lib/auth";
import { routeAccess } from "@/lib/routeAccess";

const PUBLIC_PATHS = ["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/api/health"
    || pathname === "/api/auth"
    || pathname.startsWith("/api/auth/")
    || PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  assertAuthEnvironment();
  const session = await auth.api.getSession({ headers: request.headers });
  const isApi = pathname.startsWith("/api/");

  if (!session) {
    if (isApi) return Response.json({ error: "Sign in is required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }

  const access = routeAccess(pathname, isApi, session.user.role ?? "");
  if (access.kind === "allow") return NextResponse.next();
  if (access.kind === "redirect") return NextResponse.redirect(new URL("/", request.url));
  return Response.json({ error: access.error }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
