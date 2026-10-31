import { readFileSync } from "node:fs";
import { join } from "node:path";
import { costOf } from "@/lib/ai/claude";
import { totalCost, type UsageLog } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

const read = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(join(process.cwd(), ".cache", file), "utf8")) as T; } catch { return null; } };

/** What the app's own Claude jobs have used this month and cost at list prices (USD), so the real bill is never a surprise. */
export async function GET() {
  const usage = read<UsageLog>("ai-usage.json");
  const news = read<{ month: string; calls: number; inputTokens: number; outputTokens: number }>("news-check.json");
  const jobs: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = { ...(usage?.jobs ?? {}) };
  if (news) jobs.news = { calls: news.calls, inputTokens: news.inputTokens, outputTokens: news.outputTokens, costUsd: costOf("haiku", news) };
  const total = totalCost(usage) + (jobs.news?.costUsd ?? 0);
  return Response.json(
    { keySet: Boolean(process.env.ANTHROPIC_API_KEY?.trim()), month: usage?.month ?? news?.month ?? null, jobs, totalUsd: total, note: "List prices; your Anthropic console shows the real bill." },
    { headers: { "Cache-Control": "no-store" } },
  );
}
