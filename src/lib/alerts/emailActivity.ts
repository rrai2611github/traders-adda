import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export type EmailActivitySource = "hourly" | "pre-open" | "owner" | "other";
export type EmailActivityStatus = "accepted" | "partial" | "failed" | "skipped";
export interface EmailActivityEntry {
  id: string;
  at: number;
  source: EmailActivitySource;
  status: EmailActivityStatus;
  subject: string;
  detail: string;
  test: boolean;
  dedupeKey?: string;
}
export type EmailActivityInput = Omit<EmailActivityEntry, "id" | "at" | "test"> & { at?: number; test?: boolean };
export const EMAIL_ACTIVITY_LIMIT = 200;

function isEntry(value: unknown): value is EmailActivityEntry {
  if (!value || typeof value !== "object") return false;
  return "id" in value && typeof value.id === "string"
    && "at" in value && typeof value.at === "number" && Number.isFinite(value.at)
    && "source" in value && ["hourly", "pre-open", "owner", "other"].includes(String(value.source))
    && "status" in value && ["accepted", "partial", "failed", "skipped"].includes(String(value.status))
    && "subject" in value && typeof value.subject === "string"
    && "detail" in value && typeof value.detail === "string"
    && "test" in value && typeof value.test === "boolean"
    && (!("dedupeKey" in value) || typeof value.dedupeKey === "string");
}

export function emailActivityStore(file: string) {
  function read(): EmailActivityEntry[] {
    let raw: string;
    try { raw = readFileSync(file, "utf8"); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) throw new Error("Email activity history is invalid; refusing to discard it.");
    return parsed;
  }
  return {
    read,
    append(input: EmailActivityInput): void {
      const entries = read();
      if (input.dedupeKey && entries.some((entry) => entry.dedupeKey === input.dedupeKey)) return;
      const entry: EmailActivityEntry = {
        ...input, id: randomUUID(), at: input.at ?? Date.now(), test: input.test ?? false,
        subject: input.subject.slice(0, 250), detail: input.detail.slice(0, 500),
      };
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify([entry, ...entries].slice(0, EMAIL_ACTIVITY_LIMIT)));
        renameSync(temporary, file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    },
  };
}

const store = emailActivityStore(join(process.cwd(), ".cache", "email-activity.json"));
export const readEmailActivity = () => store.read();

/** Logging must never turn an SMTP success into a send failure (and a duplicate retry). */
export function recordEmailActivity(input: EmailActivityInput): void {
  try { store.append(input); } catch (error) {
    console.error("[email-activity] could not save activity:", error instanceof Error ? error.message : error);
  }
}

export function emailFailureDetail(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return /^[A-Z0-9_]{1,30}$/.test(code)
    ? `Email attempt failed (${code}). Check server logs for details.`
    : "Email attempt failed. Check server logs for details.";
}
