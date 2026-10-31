import { NextResponse, type NextRequest } from "next/server";
import { FYERS_STATE_COOKIE, FyersAuthError, fyersConfig, fyersLoginUrl, newFyersState } from "@/lib/fyers/fyersClient";

export const dynamic = "force-dynamic";

/** Starts the daily Fyers login: redirects to Fyers with a one-time state cookie. */
export function GET(request: NextRequest) {
  const config = fyersConfig();
  if (!config) return NextResponse.redirect(new URL("/scalp?fyers=not-configured", request.url));
  // The state cookie must be set on the same host Fyers redirects back to.
  const callback = new URL(config.redirectUri);
  if (request.headers.get("host") !== callback.host) {
    return NextResponse.redirect(new URL("/api/fyers/login", callback.origin));
  }
  try {
    const state = newFyersState();
    const response = NextResponse.redirect(fyersLoginUrl(state));
    response.cookies.set(FYERS_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", path: "/api/fyers", maxAge: 600 });
    return response;
  } catch (error) {
    const message = error instanceof FyersAuthError ? error.message : "Could not start Fyers login.";
    return NextResponse.redirect(new URL(`/scalp?fyers=error&message=${encodeURIComponent(message)}`, request.url));
  }
}
