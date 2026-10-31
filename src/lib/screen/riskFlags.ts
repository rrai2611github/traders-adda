import type { Candle } from "../market/types.ts";
import { istDateKey, type ActiveSession } from "../market/marketHours.ts";

const AVERAGE_SESSIONS = 50;
/** Before this much of the session has passed, a projected RVOL is too noisy to show. */
const MIN_PROJECTION_PROGRESS = 0.05;

/**
 * Typical cumulative share of an NSE day's volume by session progress. Volume is heavy
 * at the open and the close, so a linear projection would overstate RVOL early in the day.
 */
const VOLUME_CURVE: ReadonlyArray<[number, number]> = [
  [0, 0],
  [0.05, 0.1],
  [0.25, 0.3],
  [0.5, 0.5],
  [0.75, 0.68],
  [0.95, 0.88],
  [1, 1],
];

export interface RelativeVolume {
  /** Session volume against the 50-session average; projected to a full day while live. */
  ratio: number;
  /** True when the current session is still trading and the ratio is a projection. */
  projected: boolean;
}

export type RiskFlagKey = "gap-fade" | "climax-run" | "extended" | "thin-liquidity" | "light-breakout";

export interface RiskFlag {
  key: RiskFlagKey;
  label: string;
  /** "high" flags stop a setup from being Buy-ready; "caution" flags are informational. */
  severity: "high" | "caution";
  detail: string;
}

export const RISK_FLAG_THRESHOLDS = {
  gapPercent: 2,
  climaxSessions: 10,
  climaxGainPercent: 25,
  extendedVs50: 25,
  thinTurnoverCr: 10,
  lightBreakoutVolume: 1.2,
} as const;

export function expectedVolumeShare(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  for (let i = 1; i < VOLUME_CURVE.length; i += 1) {
    const [x1, y1] = VOLUME_CURVE[i];
    if (p <= x1) {
      const [x0, y0] = VOLUME_CURVE[i - 1];
      return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

export function relativeVolume(
  candles: ReadonlyArray<Candle>,
  session: Pick<ActiveSession, "dateKey" | "progress" | "isLive">,
): RelativeVolume | null {
  const n = candles.length;
  if (n < 21) return null;
  const prior = candles.slice(Math.max(0, n - 1 - AVERAGE_SESSIONS), n - 1);
  const average = prior.reduce((sum, c) => sum + c.volume, 0) / prior.length;
  if (!(average > 0)) return null;
  const last = candles[n - 1];
  const inProgress = session.isLive && session.progress < 1 && istDateKey(last.t) === session.dateKey;
  if (!inProgress) return { ratio: last.volume / average, projected: false };
  if (session.progress < MIN_PROJECTION_PROGRESS) return null;
  return { ratio: last.volume / (average * expectedVolumeShare(session.progress)), projected: true };
}

export interface RiskFlagInput {
  vs50: number | null;
  turnoverCr: number | null;
  stage?: string | null;
  breakoutVolume?: number | null;
}

/** Price-action warnings that make an otherwise valid setup riskier to buy right now. */
export function riskFlags(candles: ReadonlyArray<Candle>, input: RiskFlagInput): RiskFlag[] {
  const t = RISK_FLAG_THRESHOLDS;
  const flags: RiskFlag[] = [];
  const n = candles.length;

  if (n >= 2) {
    const prevClose = candles[n - 2].close;
    const { open, close } = candles[n - 1];
    const gap = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
    // Gave back at least half of the opening gap.
    if (gap >= t.gapPercent && close <= open - (open - prevClose) / 2) {
      flags.push({
        key: "gap-fade",
        label: "Gap-up faded",
        severity: "high",
        detail: `Opened ${gap.toFixed(1)}% higher but closed ${(((close - prevClose) / prevClose) * 100).toFixed(1)}% vs the prior close; sellers absorbed the gap.`,
      });
    }
  }

  if (n > t.climaxSessions) {
    const base = candles[n - 1 - t.climaxSessions].close;
    const gain = base > 0 ? ((candles[n - 1].close - base) / base) * 100 : 0;
    if (gain >= t.climaxGainPercent) {
      flags.push({
        key: "climax-run",
        label: "Climax run",
        severity: "high",
        detail: `Up ${gain.toFixed(0)}% in ${t.climaxSessions} sessions; vertical runs often need to rest or retrace before a safe entry.`,
      });
    }
  }

  if (input.vs50 != null && input.vs50 >= t.extendedVs50 && !flags.some((f) => f.key === "climax-run")) {
    flags.push({
      key: "extended",
      label: "Extended",
      severity: "caution",
      detail: `${input.vs50.toFixed(0)}% above the 50-day average; a stop at support would be wide.`,
    });
  }

  if (input.turnoverCr != null && input.turnoverCr < t.thinTurnoverCr) {
    flags.push({
      key: "thin-liquidity",
      label: "Thin liquidity",
      severity: "caution",
      detail: `Median turnover ₹${input.turnoverCr.toFixed(1)} Cr a day; expect slippage and keep size small.`,
    });
  }

  if (input.stage === "breakout" && input.breakoutVolume != null && input.breakoutVolume < t.lightBreakoutVolume) {
    flags.push({
      key: "light-breakout",
      label: "Light-volume breakout",
      severity: "caution",
      detail: `Broke out on ${input.breakoutVolume.toFixed(1)}× average volume; strong breakouts usually come on 1.5× or more.`,
    });
  }

  return flags;
}
