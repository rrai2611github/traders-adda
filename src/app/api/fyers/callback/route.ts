import { NextResponse, type NextRequest } from "next/server";
import { FYERS_STATE_COOKIE, FyersAuthError, exchangeFyersAuthCode } from "@/lib/fyers/fyersClient";

export const dynamic = "force-dynamic";

/** Fyers redirects here after login with ?auth_code=…&state=…; exchange it for today's token. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("auth_code") || params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(FYERS_STATE_COOKIE)?.value;
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/scalp?${query}`, `http://${request.headers.get("host") ?? "127.0.0.1:3107"}`));
    response.cookies.delete({ name: FYERS_STATE_COOKIE, path: "/api/fyers" });
    return response;
  };
  if (!code) return back(`fyers=error&message=${encodeURIComponent("Fyers did not return an auth code.")}`);
  if (!state || !expected || state !== expected) {
    return back(`fyers=error&message=${encodeURIComponent("Login check failed. Click Connect Fyers again.")}`);
  }
  try {
    await exchangeFyersAuthCode(code);
    return back("fyers=connected");
  } catch (error) {
    const message = error instanceof FyersAuthError ? error.message : "Fyers login failed.";
    return back(`fyers=error&message=${encodeURIComponent(message)}`);
  }
}
