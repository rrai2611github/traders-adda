import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scheduledEmailBlockReason } from "./emailScheduleActivity.ts";

export interface EmailScheduleStatus {
  source: "hourly" | "pre-open";
  label: string;
  status: "paused" | "waiting" | "accepted" | "eligible" | "retry-pending";
  detail: string;
}

interface Checkpoint { lastSentSlotKey: string | null; lastAttemptAt: number | null; lastError: string | null }

export function readEmailCheckpoint(file: string): Checkpoint {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { lastSentSlotKey: null, lastAttemptAt: null, lastError: null };
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object"
    || !("lastSentSlotKey" in parsed) || (parsed.lastSentSlotKey !== null && typeof parsed.lastSentSlotKey !== "string")
    || !("lastAttemptAt" in parsed) || (parsed.lastAttemptAt !== null && (typeof parsed.lastAttemptAt !== "number" || !Number.isFinite(parsed.lastAttemptAt)))
    || !("lastError" in parsed) || (parsed.lastError !== null && typeof parsed.lastError !== "string")) {
    throw new Error("Email scheduler state is invalid.");
  }
  return { lastSentSlotKey: parsed.lastSentSlotKey, lastAttemptAt: parsed.lastAttemptAt, lastError: parsed.lastError };
}

export function emailScheduleStatus(
  source: EmailScheduleStatus["source"], enabled: boolean, configured: boolean,
  slot: string | null, checkpoint: Checkpoint, now: number,
): EmailScheduleStatus {
  const base = { source, label: source === "hourly" ? "Hourly market update" : "Pre-open brief" };
  const blocked = scheduledEmailBlockReason(enabled, configured, now);
  if (blocked) return { ...base, status: "paused", detail: blocked };
  if (!slot) return {
    ...base, status: "waiting",
    detail: source === "hourly" ? "Waiting for NSE hours: hourly slots from 09:15 to 15:15 IST." : "Waiting for the 09:00-09:15 IST pre-open window.",
  };
  if (checkpoint.lastSentSlotKey === slot) return { ...base, status: "accepted", detail: "This slot was already accepted by SMTP. Inbox delivery is not confirmed." };
  if (checkpoint.lastError && checkpoint.lastAttemptAt != null) {
    const retryAt = checkpoint.lastAttemptAt + (source === "hourly" ? 10 : 5) * 60_000;
    return {
      ...base, status: "retry-pending",
      detail: retryAt > now
        ? `Send failed. Retry eligible after ${new Date(retryAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST, only while this send window remains open.`
        : "Send failed. Eligible for retry at the next scheduler check while this send window remains open.",
    };
  }
  return { ...base, status: "eligible", detail: "This slot is eligible for the next scheduler check; an email has not been confirmed yet." };
}

const CHECKPOINT_PATHS = {
  hourly: join(process.cwd(), ".cache", "email-alert.json"),
  "pre-open": join(process.cwd(), ".cache", "preopen-email.json"),
};
export const emailCheckpointPath = (source: EmailScheduleStatus["source"]) => CHECKPOINT_PATHS[source];
