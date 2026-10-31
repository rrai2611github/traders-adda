export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const unsupported = () => Response.json(
  { ok: false, error: "Telegram alerts are disabled because Telegram is not supported in this environment." },
  { status: 410, headers: noStore },
);

export async function GET() {
  return unsupported();
}

export async function POST() {
  return unsupported();
}
