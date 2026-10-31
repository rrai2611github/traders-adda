import { radarView } from "@/lib/radar/radarServer";

export const dynamic = "force-dynamic";

/** Every stock the pre-open and hourly emails listed, each scored against the finished daily prices. Read-only. */
export async function GET() {
  return Response.json(radarView(), { headers: { "Cache-Control": "no-store" } });
}
