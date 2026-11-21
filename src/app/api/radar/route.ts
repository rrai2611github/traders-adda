import { radarView } from "@/lib/radar/radarServer";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

/** Every stock the pre-open and hourly emails listed, each scored against the finished daily prices. Read-only. */
export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return Response.json(radarView(), { headers: { "Cache-Control": "no-store" } });
}
