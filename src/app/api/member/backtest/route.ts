import { getBacktest, settingsId, startBacktest } from "@/lib/backtest/jobs";
import { getMemberBacktestPresetFromBody, MEMBER_BACKTEST_PRESETS } from "@/lib/backtest/memberPresets";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const startedMemberJobIds = new Set<string>();

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers });
  }
  const preset = getMemberBacktestPresetFromBody(body);
  if (!preset) return Response.json({ error: "That backtest preset is not supported." }, { status: 400, headers });
  const job = startBacktest(preset.settings);
  startedMemberJobIds.add(job.id);
  return Response.json(job, { headers });
}

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401, headers });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const knownPresetRun = MEMBER_BACKTEST_PRESETS.some((preset) => settingsId(preset.settings) === id);
  if (!/^[0-9a-f]{16}$/.test(id) || (!knownPresetRun && !startedMemberJobIds.has(id))) {
    return Response.json({ status: "unknown" }, { status: 404, headers });
  }
  const job = getBacktest(id);
  if (!job) return Response.json({ status: "unknown" }, { status: 404, headers });
  return Response.json(job, { headers });
}
