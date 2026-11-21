import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const unsupported = () => Response.json(
  { ok: false, error: "Telegram alerts are disabled because Telegram is not supported in this environment." },
  { status: 410, headers: noStore },
);

export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return unsupported();
}

export async function POST(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  return unsupported();
}
