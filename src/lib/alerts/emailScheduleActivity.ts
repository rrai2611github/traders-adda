import { marketEmailBlockReason } from "./marketEmailPolicy.ts";
import { istDateKey } from "../market/marketHours.ts";
import { recordEmailActivity, type EmailActivitySource } from "./emailActivity.ts";

export function scheduledEmailBlockReason(enabled: boolean, configured: boolean, now: number): string | null {
  if (!enabled) return "Automatic sending is turned off.";
  if (!configured) return "Email settings are incomplete.";
  return marketEmailBlockReason(now);
}

export function recordScheduledEmailSkip(source: EmailActivitySource, reason: string, now: number): void {
  recordEmailActivity({
    source, status: "skipped", subject: source === "hourly" ? "Hourly market update" : "Pre-open brief",
    detail: reason, at: now, dedupeKey: `${source}:${istDateKey(now)}:${reason}`,
  });
}
