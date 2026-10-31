import { fetchFundamentals } from "@/lib/fundamentals/fundamentalsServer";

export const dynamic = "force-dynamic";

/** Company health for one stock: sales, profit, debt, promoter holding and pledged shares. Information only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return Response.json({ error: "Invalid symbol." }, { status: 400 });
  const report = await fetchFundamentals(symbol, params.get("lender") === "1");
  if (!report) return Response.json({ error: "Company data is not available right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
