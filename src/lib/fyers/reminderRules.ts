/** Minutes after IST midnight of the reminders: 08:45, 09:00 and 09:10. */
export const REMINDER_MINUTES = [8 * 60 + 45, 9 * 60, 9 * 60 + 10] as const;
/** After this the market is about to open; stop nagging and let the day run on Yahoo. */
export const REMINDER_CUTOFF_MINUTES = 9 * 60 + 25;

/** True when the next unsent reminder is due: its time has passed and the cutoff has not. */
export function reminderDue(minutes: number, alreadySent: number): boolean {
  if (alreadySent >= REMINDER_MINUTES.length || minutes >= REMINDER_CUTOFF_MINUTES) return false;
  return minutes >= REMINDER_MINUTES[alreadySent];
}
