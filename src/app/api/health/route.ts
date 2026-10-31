export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ app: "traders-adda", status: "running" }, { headers: { "Cache-Control": "no-store" } });
}
