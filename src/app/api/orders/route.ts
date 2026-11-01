import { ordersView, sendOrders } from "@/lib/orders/orderServer";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Tomorrow's plan as broker orders, the mode (dry run or live) and anything that blocks sending. */
export async function GET() {
  return Response.json(ordersView(), { headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !!origin && !!host && new URL(origin).host === host;
}

/** `{fingerprint}` of the orders shown. A dry run unless FYERS_ORDERS_ENABLED=1 is set. Needs a same-origin request (an Origin header is required). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers });
  let fingerprint: unknown;
  try {
    const body = await request.json();
    fingerprint = body?.fingerprint;
  } catch {
    return Response.json({ error: "Send a JSON object." }, { status: 400, headers });
  }
  const result = await sendOrders(fingerprint);
  return result.ok ? Response.json(result, { headers }) : Response.json({ error: result.error }, { status: result.status, headers });
}
