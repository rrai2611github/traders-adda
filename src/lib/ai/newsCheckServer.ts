import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAnnouncements } from "../market/announcements.ts";
import { istDateKey } from "../market/marketHours.ts";
import { askClaude, costUsd, getNews, type NewsCache, type NewsResult } from "./newsCheck.ts";

const FILE = join(process.cwd(), ".cache", "news-check.json");

function readCache(): NewsCache | null {
  try { return JSON.parse(readFileSync(FILE, "utf8")) as NewsCache; } catch { return null; }
}

function writeCache(cache: NewsCache) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(cache, null, 2));
}

/** Notes for these symbols from today's saved set, plus one Claude call for any still missing (unless `cacheOnly`). Off without ANTHROPIC_API_KEY. */
export function newsFor(symbols: ReadonlyArray<string>, options: { cacheOnly?: boolean } = {}): Promise<NewsResult> {
  return getNews(symbols, {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    readCache,
    writeCache,
    announcementsFor: (symbol) => fetchAnnouncements(symbol, 14),
    ask: (text, key) => askClaude(text, key),
    today: istDateKey(),
    cacheOnly: options.cacheOnly,
  });
}

/** What the news check has used this month and what that cost at list prices. */
export function newsUsage(): { month: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number } | null {
  const cache = readCache();
  return cache ? { month: cache.month, calls: cache.calls, inputTokens: cache.inputTokens, outputTokens: cache.outputTokens, costUsd: costUsd(cache) } : null;
}
