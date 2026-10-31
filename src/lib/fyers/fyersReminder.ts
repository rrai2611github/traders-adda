import { exec } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { isTradingDay } from "@/lib/market/marketHours";
import { fyersConfig, fyersConnected } from "./fyersClient";
import { REMINDER_MINUTES, reminderDue } from "./reminderRules";

/**
 * Fyers access tokens expire every IST day, and the login needs your own password and one-time code, so it
 * cannot be done for you. This reminds you: on trading days from 08:45 it checks whether today's login exists and, if not,
 * emails you the login link at 08:45, 09:00 and 09:10. With FYERS_AUTO_OPEN_LOGIN=1 it also opens the
 * login page in this PC's default browser at 08:45, so only the credentials are left to type.
 */

const FILE = join(process.cwd(), ".cache", "fyers-reminder.json");
const CHECK_MS = 60_000;

interface ReminderState { day: string; sent: number; opened: boolean; confirmed: boolean }

const store = ((globalThis as { __fyersReminder?: { timer: ReturnType<typeof setInterval> | null } }).__fyersReminder ??= { timer: null });

function read(day: string): ReminderState {
  try {
    const state = JSON.parse(readFileSync(FILE, "utf8")) as ReminderState;
    if (state.day === day) return state;
  } catch { /* first run of the day */ }
  return { day, sent: 0, opened: false, confirmed: false };
}

function write(state: ReminderState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

export function fyersLoginUrl(): string {
  const redirect = fyersConfig()?.redirectUri ?? "http://127.0.0.1:3107/api/fyers/callback";
  return `${new URL(redirect).origin}/api/fyers/login`;
}

async function check(now = Date.now()) {
  if (!fyersConfig() || !isTradingDay(now)) return;
  const shifted = new Date(now + 19_800_000);
  const day = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const state = read(day);
  const connected = fyersConnected().connected;
  if (connected) {
    // Tell you once that the login worked, but only if you were reminded first.
    if (state.sent > 0 && !state.confirmed && ownerAlertAddress()) {
      await notifyOwner("Fyers is connected for today", ["✅ Fyers is connected for today. Live quotes are on."]);
      write({ ...state, confirmed: true });
    }
    return;
  }
  if (!reminderDue(minutes, state.sent)) return;
  const url = fyersLoginUrl();
  await notifyOwner("Fyers login needed for today's live quotes", [`🔑 Fyers login needed for today's live quotes.\nOn your trading PC open: ${url}\nLogin takes about 20 seconds; tokens expire every day.${state.sent ? ` (reminder ${state.sent + 1} of ${REMINDER_MINUTES.length})` : ""}`]);
  let opened = state.opened;
  if (!opened && process.env.FYERS_AUTO_OPEN_LOGIN === "1" && process.platform === "win32") {
    exec(`start "" "${url}"`, (error) => { if (error) console.error("[fyers] could not open the login page:", error.message); });
    opened = true;
  }
  write({ ...state, sent: state.sent + 1, opened });
}

export function startFyersReminder() {
  if (store.timer) return;
  const run = () => void check().catch((error) => console.error("[fyers] reminder check failed:", error instanceof Error ? error.message : error));
  store.timer = setInterval(run, CHECK_MS);
  setTimeout(run, 10_000);
}
