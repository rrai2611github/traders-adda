import { approvePick, cancelOrder, closeOrder, importLegacy, paperSnapshot, removeDemoOrders, setCapital, startPaperEngine, updateSettings } from "@/lib/paper/paperServer";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** The paper portfolio, risk limits, totals net of costs, stats and the engine's status. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  const isAdmin = session.user.role === "admin";
  const scope = isAdmin ? "admin" : session.user.id;
  startPaperEngine(scope, isAdmin);
  try {
    return Response.json(paperSnapshot(Date.now(), scope, isAdmin), { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Paper portfolio unavailable." }, { status: 500, headers: noStore });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

interface Body {
  action?: string;
  pick?: unknown;
  signalDate?: string;
  id?: string;
  exitPrice?: number;
  value?: number;
  settings?: Record<string, number>;
  portfolio?: { initialCapital: number; orders: unknown[] };
}

/** One endpoint for every paper action; a refused action returns 400 with the reason. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403, headers: noStore });
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  const isAdmin = session.user.role === "admin";
  const scope = isAdmin ? "admin" : session.user.id;
  startPaperEngine(scope, isAdmin);
  try {
    const body = (await request.json()) as Body;
    switch (body.action) {
      case "approve":
        if (!body.pick || typeof body.signalDate !== "string") throw new Error("A pick and signal date are required.");
        return Response.json(await approvePick(body.pick as Parameters<typeof approvePick>[0], body.signalDate, scope, isAdmin), { headers: noStore });
      case "cancel":
        return Response.json(await cancelOrder(String(body.id), scope, isAdmin), { headers: noStore });
      case "close":
        return Response.json(await closeOrder(String(body.id), Number(body.exitPrice), scope, isAdmin), { headers: noStore });
      case "capital":
        return Response.json(await setCapital(Number(body.value), scope, isAdmin), { headers: noStore });
      case "settings":
        return Response.json(await updateSettings(body.settings ?? {}, scope, isAdmin), { headers: noStore });
      case "removeDemo":
        return Response.json(await removeDemoOrders(scope, isAdmin), { headers: noStore });
      case "import":
        if (!body.portfolio) throw new Error("A portfolio is required.");
        return Response.json(await importLegacy(body.portfolio, scope, isAdmin), { headers: noStore });
      default:
        throw new Error("Unknown paper action.");
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Paper action failed." }, { status: 400, headers: noStore });
  }
}
