import { costOf, type ModelKey, type Usage } from "./claude.ts";

/** What each AI job has used this month, so the real cost is always visible. */
export type JobName = "briefing" | "review";

export interface UsageLog {
  /** YYYY-MM the totals belong to. */
  month: string;
  jobs: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export const emptyUsage = (month: string): UsageLog => ({ month, jobs: {} });

/** Adds one call to the log; a new month starts from zero. Pure. */
export function addUsage(log: UsageLog | null, job: JobName, model: ModelKey, usage: Usage, month: string): UsageLog {
  const base = log && log.month === month ? log : emptyUsage(month);
  const prev = base.jobs[job] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    month,
    jobs: {
      ...base.jobs,
      [job]: { calls: prev.calls + 1, inputTokens: prev.inputTokens + usage.inputTokens, outputTokens: prev.outputTokens + usage.outputTokens, costUsd: prev.costUsd + costOf(model, usage) },
    },
  };
}

export const totalCost = (log: UsageLog | null) => Object.values(log?.jobs ?? {}).reduce((a, j) => a + j.costUsd, 0);
