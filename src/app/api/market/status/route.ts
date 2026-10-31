import { getDataSource, getStatus } from "@/lib/market/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { status: getStatus(), dataSource: getDataSource() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
