import type { Trade } from "./types.ts";

/**
 * Strategy health: is the edge still there? Two comparisons, all plain code.
 *  1. Drift: the last 12 months of the rules' own backtest against every rolling 12-month stretch since 2017, and the recent average trade
 *     against the earlier average trade.
 *  2. Live: the live strategy check's closed trades, drawdown and losing streak against what the backtest says is normal for that many trades.
 * It only warns; it never changes a rule. Small samples are called small ("early") and never raise an alarm.
 */
export type HealthState = "ok" | "early" | "watch" | "alert";

export interface HealthCheck {
  key: string;
  label: string;
  state: HealthState;
  detail: string;
}

export interface HealthReport {
  verdict: "on-track" | "early" | "watch" | "review";
  headline: string;
  checks: HealthCheck[];
}

type R = Pick<Trade, "r" | "pnl" | "entryDay" | "exitDay">;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/** Returns over every `window` sessions of an account-value series, as percent, one per end day. */
export function rollingReturns(account: ReadonlyArray<number>, window = 252): number[] {
  const out: number[] = [];
  for (let i = window; i < account.length; i += 1) if (account[i - window] > 0) out.push((account[i] / account[i - window] - 1) * 100);
  return out;
}

/** Share of `sorted` values that are at or below `value`, 0-100. */
export function percentileOf(sorted: ReadonlyArray<number>, value: number): number {
  if (!sorted.length) return 50;
  let below = 0;
  for (const v of sorted) if (v <= value) below += 1;
  return (below / sorted.length) * 100;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const longestLoss = (wins: boolean[]) => { let best = 0, run = 0; for (const w of wins) { run = w ? 0 : run + 1; best = Math.max(best, run); } return best; };

/** The longest losing run that `n` trades would show 95% of the time, drawing win/loss outcomes at random from the baseline's own trades. Seeded, so it never flickers. */
export function losingStreak95(baselineWins: ReadonlyArray<boolean>, n: number, runs = 2000, seed = 19): number {
  if (!baselineWins.length || n < 1) return 0;
  const rand = mulberry32(seed);
  const streaks: number[] = [];
  for (let k = 0; k < runs; k += 1) {
    const sample: boolean[] = [];
    for (let i = 0; i < n; i += 1) sample.push(baselineWins[Math.floor(rand() * baselineWins.length)]);
    streaks.push(longestLoss(sample));
  }
  streaks.sort((a, b) => a - b);
  return streaks[Math.min(streaks.length - 1, Math.floor(streaks.length * 0.95))];
}

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;
const rr = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface HealthInput {
  /** The rules' own backtest from 2016-12 to the latest day. */
  baseline: { trades: ReadonlyArray<R>; account: ReadonlyArray<number>; maxDrawdownPercent: number; lastDay: string };
  /** The live strategy check's result; null when it has not been started. */
  live: { trades: ReadonlyArray<R>; maxDrawdownPercent: number; sessions: number; startDate: string } | null;
  /** When `live` is null: the day the live check was started if it has been (it is only waiting for its first finished session). */
  liveStartedOn?: string | null;
}

export function assessHealth(input: HealthInput): HealthReport {
  const checks: HealthCheck[] = [];
  const base = input.baseline.trades;
  const baseR = base.map((t) => t.r);
  const baseAvg = baseR.length ? mean(baseR) : 0;
  const baseSd = baseR.length > 1 ? sd(baseR) : 1;
  const baseWinRate = base.length ? base.filter((t) => t.pnl > 0).length / base.length : 0;

  // 1. Drift: the last 12 months against every rolling 12-month stretch.
  const rolling = rollingReturns(input.baseline.account);
  if (rolling.length >= 100) {
    const now = rolling[rolling.length - 1];
    const p = percentileOf([...rolling].sort((a, b) => a - b), now);
    checks.push({
      key: "drift-return",
      label: "Last 12 months of the rules, against every 12-month stretch since 2017",
      state: p >= 25 ? "ok" : p >= 10 ? "watch" : "alert",
      detail: `The last 12 months made ${pct(now, 0)}, better than ${Math.round(p)}% of the rolling 12-month results since 2017 (the typical one made ${pct([...rolling].sort((a, b) => a - b)[Math.floor(rolling.length / 2)], 0)}). One weak year is normal for a breakout rule; a result in the bottom tenth deserves a look.`,
    });
  }

  // 2. Recent average trade against the earlier average trade.
  const cut = addDays(input.baseline.lastDay, -365);
  const recent = base.filter((t) => t.entryDay >= cut);
  const earlier = base.filter((t) => t.entryDay < cut);
  if (earlier.length >= 30) {
    const eR = earlier.map((t) => t.r);
    const rAvg = recent.length ? mean(recent.map((t) => t.r)) : 0;
    const se = sd(eR) / Math.sqrt(Math.max(1, recent.length));
    const z = recent.length ? (rAvg - mean(eR)) / se : 0;
    checks.push({
      key: "drift-trade",
      label: "Average trade, last 12 months against the years before",
      state: recent.length < 15 ? "early" : z <= -2 ? "alert" : z <= -1 ? "watch" : "ok",
      detail: `${recent.length} trades in the last 12 months averaged ${rr(rAvg)}; the ${earlier.length} before averaged ${rr(mean(eR))}.${recent.length < 15 ? " Too few recent trades to judge." : ""}`,
    });
  }

  // 3-6. Live results against the baseline.
  const live = input.live;
  if (!live) {
    checks.push({ key: "live", label: "Live strategy check", state: "early", detail: input.liveStartedOn ? `Started on ${input.liveStartedOn}; waiting for its first finished session.` : "Not started. Press Start on the Live strategy check to collect real results." });
  } else {
    const done = live.trades;
    const n = done.length;
    const liveAvg = n ? mean(done.map((t) => t.r)) : 0;
    if (n < 15) {
      checks.push({ key: "live-trades", label: "Live trades so far", state: "early", detail: `${n} closed trade${n === 1 ? "" : "s"} since ${live.startDate}. The backtest needs about 30 to judge fairly; below 15 nothing here can raise an alarm.` });
    } else {
      const z = (liveAvg - baseAvg) / (baseSd / Math.sqrt(n));
      checks.push({
        key: "live-r",
        label: "Live average trade against the backtest",
        state: z <= -2 ? "alert" : z <= -1 ? "watch" : "ok",
        detail: `${n} live trades averaged ${rr(liveAvg)} against ${rr(baseAvg)} in the backtest (${z >= 0 ? "above" : "below"} by ${Math.abs(z).toFixed(1)} standard errors).`,
      });
      const wins = done.filter((t) => t.pnl > 0).length / n;
      const zw = (wins - baseWinRate) / Math.sqrt(Math.max(1e-6, (baseWinRate * (1 - baseWinRate)) / n));
      checks.push({
        key: "live-win",
        label: "Live win rate against the backtest",
        state: zw <= -2 ? "alert" : zw <= -1 ? "watch" : "ok",
        detail: `${Math.round(wins * 100)}% of live trades won against ${Math.round(baseWinRate * 100)}% in the backtest.`,
      });
      const streak = longestLoss(done.map((t) => t.pnl > 0));
      const limit = losingStreak95(base.map((t) => t.pnl > 0), n);
      checks.push({
        key: "live-streak",
        label: "Longest losing run",
        state: streak > limit ? "alert" : streak === limit && limit > 0 ? "watch" : "ok",
        detail: `${streak} losses in a row live; ${n} trades of the backtest's win rate would produce a run longer than ${limit} only 5% of the time.`,
      });
    }
    const ddLimit = Math.abs(input.baseline.maxDrawdownPercent);
    const ddLive = Math.abs(live.maxDrawdownPercent);
    checks.push({
      key: "live-drawdown",
      label: "Live worst drop against the backtest's",
      state: live.sessions < 40 ? "early" : ddLive > ddLimit * 1.5 ? "alert" : ddLive > ddLimit ? "watch" : "ok",
      detail: `The live account's worst drop is ${pct(-ddLive)} over ${live.sessions} sessions; the backtest's worst in ten years was ${pct(-ddLimit)}.${live.sessions < 40 ? " Too short a stretch to compare." : ""}`,
    });
  }

  const alerts = checks.filter((c) => c.state === "alert");
  const watches = checks.filter((c) => c.state === "watch");
  const early = checks.filter((c) => c.state === "early");
  const verdict: HealthReport["verdict"] = alerts.length ? "review" : watches.length ? "watch" : early.length && !checks.some((c) => c.state === "ok") ? "early" : "on-track";
  const headline = verdict === "review"
    ? `Review the rules: ${alerts.map((c) => c.label.toLowerCase()).join("; ")}.`
    : verdict === "watch"
      ? `Watch: ${watches.map((c) => c.label.toLowerCase()).join("; ")}.`
      : verdict === "early"
        ? "Too early to judge: the live check has too few trades or sessions."
        : early.length ? "No sign the edge has faded; the live check is still too small to add much." : "No sign the edge has faded.";
  return { verdict, headline, checks };
}

/** True on the last trading day of a month (the next session is in another month). */
export function isLastSessionOfMonth(lastDay: string, isTradingDay: (isoDay: string) => boolean): boolean {
  const month = lastDay.slice(0, 7);
  for (let k = 1; k <= 7; k += 1) {
    const day = addDays(lastDay, k);
    if (day.slice(0, 7) !== month) return true;
    if (isTradingDay(day)) return false;
  }
  return false;
}

export function healthLines(report: HealthReport): string[] {
  const mark: Record<HealthState, string> = { ok: "OK", early: "EARLY", watch: "WATCH", alert: "ALERT" };
  return [report.headline, ...report.checks.map((c) => `[${mark[c.state]}] ${c.label}: ${c.detail}`), "This monitor only warns. It never changes a rule, and a warning is a reason to look, not a reason to stop. Paper money only."];
}
