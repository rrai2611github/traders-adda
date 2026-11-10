import { isTradingDay, istDateKey, NSE_REGULAR_SESSION_HOLIDAYS } from "./marketHours.ts";

export function isMonthlyRegularSession(timestamp: number): boolean {
  return isTradingDay(timestamp) && !NSE_REGULAR_SESSION_HOLIDAYS.has(istDateKey(timestamp));
}
