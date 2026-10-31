import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { getBacktest } from "./jobs.ts";
import { readTracker, trackerState } from "./tracker.ts";
import { trackerNote } from "./trackerNoteFormat.ts";

const FILE = join(process.cwd(), ".cache", "tracker-note.json");

function lastNoteDay(): string | null {
  try { return JSON.parse(readFileSync(FILE, "utf8")).lastDay ?? null; } catch { return null; }
}

/**
 * After the daily price update, waits for the live strategy check to finish recomputing and emails the owner (PERSONAL_ALERT_EMAIL only,
 * never the customer list) one note: account, today's trades, what is held and how close to its exit, and the next open's buys.
 * Sent once per last-candle day.
 */
export async function sendTrackerNote(): Promise<void> {
  const config = readTracker();
  if (!config || !ownerAlertAddress()) return;
  const first = trackerState();
  if (first.job.status === "waiting" || first.job.status === "none") return;
  const id = first.job.status === "done" || first.job.status === "running" || first.job.status === "failed" ? first.job.id : null;
  if (!id) return;
  for (let i = 0; i < 180; i += 1) {
    const job = getBacktest(id);
    if (job?.status === "done") {
      if (lastNoteDay() === job.result.data.lastDay) return;
      const note = trackerNote(job.result, config.capital, config.startDate);
      await notifyOwner(note.subject, note.lines);
      mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
      writeFileSync(FILE, JSON.stringify({ lastDay: job.result.data.lastDay }));
      return;
    }
    if (job?.status === "failed") { console.error("[tracker-note] the check failed:", job.error); return; }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
