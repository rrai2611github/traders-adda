import type { TopPicksPayload } from "../screen/topPicksResults.ts";
import { attachFirstCalls } from "./pickCalls.ts";
import { pickCallsView } from "./radarServer.ts";

/**
 * Attaches each pick's first call (read from the email track record) to the Top picks payload an email is built from. A read problem
 * leaves the calls out and the email still goes: this only adds context and never gates anything.
 */
export function withFirstCalls(payload: TopPicksPayload | null): TopPicksPayload | null {
  if (!payload) return payload;
  try {
    return { ...payload, picks: attachFirstCalls(payload.picks, pickCallsView().calls) };
  } catch (error) {
    console.error("[email] first calls skipped:", error instanceof Error ? error.message : error);
    return payload;
  }
}
