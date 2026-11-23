import { NextResponse, type NextRequest } from "next/server";
import { auth, assertAuthEnvironment } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"];
const ADMIN_PAGES = ["/admin", "/backtest", "/performance", "/radar", "/scalp"];
const USER_PAGES = ["/", "/assistant", "/playbook", "/positions", "/tracker"];
const USER_API_PREFIXES = ["/api/market", "/api/assistant", "/api/paper", "/api/user/watchlist", "/api/positions", "/api/tracker", "/api/strategy-health"];
const ADMIN_API_PREFIXES = ["/api/paper/index", "/api/scalp"];

function matchesPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

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

  if (session.user.role === "admin") return NextResponse.next();

  if (matchesPath(pathname, ADMIN_PAGES) || matchesPath(pathname, ADMIN_API_PREFIXES)) {
    if (isApi) return Response.json({ error: "Admin access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isApi) {
    if (matchesPath(pathname, USER_API_PREFIXES)) return NextResponse.next();
    return Response.json({ error: "This feature is only available to administrators." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (USER_PAGES.includes(pathname)) return NextResponse.next();
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
