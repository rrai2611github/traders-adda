export const FYERS_LOCAL_DAILY_BUDGET = 4_500;
export const FYERS_DATA_MIN_GAP_MS = 1_500;
export const FYERS_DATA_PER_MINUTE = 40;
const IST_MS = 19_800_000;
export const fyersDay = (now: number) => new Date(now + IST_MS).toISOString().slice(0, 10);
const nextDay = (now: number) => Math.floor((now + IST_MS) / 86_400_000 + 1) * 86_400_000 - IST_MS;

export interface FyersDataUsage {
  day: string;
  requests: number;
  endpoints: Record<string, number>;
  blockedUntil: number;
  reason: string | null;
}

export class FyersDataPausedError extends Error {
  readonly retryAt: number;
  constructor(message: string, retryAt: number) {
    super(message);
    this.name = "FyersDataPausedError";
    this.retryAt = retryAt;
  }
}

export function currentUsage(saved: FyersDataUsage | null, now: number): FyersDataUsage {
  return saved?.day === fyersDay(now) ? saved :
    { day: fyersDay(now), requests: 0, endpoints: {}, blockedUntil: 0, reason: null };
}

export function assertDataAvailable(usage: FyersDataUsage, now: number) {
  if (usage.blockedUntil > now) throw new FyersDataPausedError(usage.reason ?? "Fyers data requests paused.", usage.blockedUntil);
  if (usage.requests >= FYERS_LOCAL_DAILY_BUDGET) {
    throw new FyersDataPausedError(`Local Fyers data budget (${FYERS_LOCAL_DAILY_BUDGET}/day) reached. Requests paused until the next IST day.`, nextDay(now));
  }
}

export function dataBackoff(now: number, status: number, message: string): { blockedUntil: number; reason: string } | null {
  if (/requests\s*\/\s*day|daily.{0,30}limit|limit.{0,30}(?:per day|requests\/day)|blocked.{0,30}(?:day|today)/i.test(message)) {
    return { blockedUntil: nextDay(now), reason: message };
  }
  if (status === 429 || /too many requests|rate limit|per.minute.{0,20}limit|limit.{0,30}requests\s*\/\s*(?:second|minute)/i.test(message)) {
    return { blockedUntil: now + 60_000, reason: message };
  }
  if (status >= 500 || status === 0) return { blockedUntil: now + 30_000, reason: message };
  return null;
}

/** Shares in-flight reads; a cached payload retains its original fetch time. Failures are never cached as success. */
export class FyersReadCache {
  private entries = new Map<string, { until: number; value: Promise<Record<string, unknown>> }>();

  get(key: string, ttl: number, now: number, load: () => Promise<Record<string, unknown>>) {
    const hit = this.entries.get(key);
    if (hit && hit.until > now) return hit.value;
    // Keep an in-flight request shared even if it takes longer than the cache TTL.
    const entry = { until: Infinity, value: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    entry.value.then(() => {
      entry.until = Date.now() + ttl;
      for (const [k, v] of this.entries) if (v.until <= Date.now()) this.entries.delete(k);
      if (this.entries.size > 500) {
        for (const [k, v] of this.entries) {
          if (v.until !== Infinity) { this.entries.delete(k); break; }
        }
      }
    }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.value;
  }
}
