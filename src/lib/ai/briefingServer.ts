import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { istDateKey } from "../market/marketHours.ts";
import { getBriefing, type BriefingCache, type BriefingFacts, type BriefingResult } from "./briefing.ts";
import { askModel } from "./claude.ts";
import { addUsage, type UsageLog } from "./usage.ts";

const DIR = join(process.cwd(), ".cache");
const BRIEFING_FILE = join(DIR, "briefing.json");
export const USAGE_FILE = join(DIR, "ai-usage.json");

const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; } };
const writeJson = (file: string, value: unknown) => { mkdirSync(DIR, { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2)); };

/** Adds one call to this month's usage log (`.cache/ai-usage.json`). */
export function recordAiUsage(job: "briefing" | "review", model: "haiku" | "sonnet", usage: { inputTokens: number; outputTokens: number }) {
  writeJson(USAGE_FILE, addUsage(readJson<UsageLog>(USAGE_FILE), job, model, usage, istDateKey().slice(0, 7)));
}

/** The "Today at a glance" lines: Claude-written when ANTHROPIC_API_KEY is set, plain-code otherwise. Never throws. */
export function briefingFor(facts: BriefingFacts): Promise<BriefingResult> {
  return getBriefing(facts, {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    today: istDateKey(),
    readCache: () => readJson<BriefingCache>(BRIEFING_FILE),
    writeCache: (cache) => writeJson(BRIEFING_FILE, cache),
    ask: (system, user, key) => askModel({ model: "haiku", system, user, maxTokens: 700 }, key),
    recordUsage: (usage) => recordAiUsage("briefing", "haiku", usage),
  });
}
