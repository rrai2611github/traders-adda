import { cancelOrder, closeOrder, indexSnapshot, placeOrder, setCapital, startIndexPaperEngine, updateAuto, updateSettings, type PlaceInput } from "@/lib/paper/indexPaperServer";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** The index paper portfolio: orders with P&L after costs, risk limits, stats, latest futures quotes and engine status. */
export function GET() {
  startIndexPaperEngine();
  try {
    return Response.json(indexSnapshot(), { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Index paper portfolio unavailable." }, { status: 500, headers: noStore });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

interface Body {
  action?: string;
  order?: PlaceInput;
  id?: string;
  value?: number;
  settings?: Record<string, number>;
  auto?: { enabled?: boolean; indexes?: Array<"NIFTY" | "BANKNIFTY"> };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers: noStore });
  startIndexPaperEngine();
  try {
    const body = (await request.json()) as Body;
    switch (body.action) {
      case "place":
        if (!body.order) throw new Error("An order is required.");
        return Response.json(await placeOrder(body.order), { headers: noStore });
      case "cancel":
        return Response.json(await cancelOrder(String(body.id)), { headers: noStore });
      case "close":
        return Response.json(await closeOrder(String(body.id)), { headers: noStore });
      case "capital":
        return Response.json(await setCapital(Number(body.value)), { headers: noStore });
      case "auto":
        return Response.json(await updateAuto(body.auto ?? {}), { headers: noStore });
      case "settings":
        return Response.json(await updateSettings(body.settings ?? {}), { headers: noStore });
      default:
        throw new Error("Unknown index paper action.");
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Index paper action failed." }, { status: 400, headers: noStore });
  }
}
