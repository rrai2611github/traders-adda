import type { TopPicksPayload } from "../screen/topPicksResults.ts";
import { newsFor } from "./newsCheckServer.ts";

/** Attaches each stock's news note to the Top picks payload. Failures and a missing API key leave the notes out; the email still goes. */
export async function withNews(payload: TopPicksPayload | null, options: { cacheOnly?: boolean } = {}): Promise<TopPicksPayload | null> {
  if (!payload) return payload;
  try {
    const result = await newsFor(payload.picks.map((p) => p.symbol), options);
    if (result.status === "failed") console.error("[news-check] skipped:", result.message);
    return { ...payload, picks: payload.picks.map((p) => ({ ...p, news: result.notes[p.symbol] ?? null })) };
  } catch (error) {
    console.error("[news-check] skipped:", error instanceof Error ? error.message : error);
    return payload;
  }
}
