/**
 * Breakout state: a finer, actionable read of where a Core Setups stock sits
 * inside its lifecycle stage (inspired by Scanner Pro's stage chips).
 * Pure so it can be node-tested.
 */
export type LifecycleStage = "forming" | "breakouts" | "climbing" | "played-out";

export type BreakoutState =
  | "coiled"
  | "near-pivot"
  | "building"
  | "buy-zone"
  | "extended"
  | "strong"
  | "paid-off"
  | "failed"
  | "faded";

export type BreakoutStateTone = "good" | "watch" | "caution" | "bad" | "neutral";

export interface BreakoutStateInfo {
  key: BreakoutState;
  label: string;
  tone: BreakoutStateTone;
  rule: string;
}

/** Forming bases within this % of the pivot are near it. */
export const NEAR_PIVOT_PERCENT = 5;
/** Coiled: within this % of the pivot and ranges contracting to this ATR ratio or tighter. */
export const COILED_PIVOT_PERCENT = 3;
export const COILED_MAX_ATR_RATIO = 0.75;
/** Classic buy zone: up to 5% above the pivot; beyond that it is extended. */
export const BUY_ZONE_PERCENT = 5;
/** 20%+ above the pivot is a strong move where protecting gains matters. */
export const STRONG_PERCENT = 20;

export const BREAKOUT_STATES: Record<BreakoutState, BreakoutStateInfo> = {
  coiled: {
    key: "coiled",
    label: "Coiled",
    tone: "good",
    rule: `Within ${COILED_PIVOT_PERCENT}% of the pivot with ranges contracting (ATR ratio ≤${COILED_MAX_ATR_RATIO}). Ready to watch for a volume breakout.`,
  },
  "near-pivot": {
    key: "near-pivot",
    label: "Near pivot",
    tone: "watch",
    rule: `Within ${NEAR_PIVOT_PERCENT}% of the pivot but not yet tight. Put it on alert.`,
  },
  building: {
    key: "building",
    label: "Building",
    tone: "neutral",
    rule: `More than ${NEAR_PIVOT_PERCENT}% below the pivot. Still building the right side of the base.`,
  },
  "buy-zone": {
    key: "buy-zone",
    label: "In buy zone",
    tone: "good",
    rule: `Broke out and trades no more than ${BUY_ZONE_PERCENT}% above the pivot, the classic buy zone.`,
  },
  extended: {
    key: "extended",
    label: "Extended",
    tone: "caution",
    rule: `More than ${BUY_ZONE_PERCENT}% above the pivot. Don't chase; wait for a pullback or a new base.`,
  },
  strong: {
    key: "strong",
    label: "Strong",
    tone: "good",
    rule: `${STRONG_PERCENT}%+ above the pivot and still in trend. A leader; holders should protect gains.`,
  },
  "paid-off": {
    key: "paid-off",
    label: "Paid off",
    tone: "good",
    rule: "The breakout ended with a gain.",
  },
  failed: {
    key: "failed",
    label: "Failed",
    tone: "bad",
    rule: "The breakout hit its 8% stop.",
  },
  faded: {
    key: "faded",
    label: "Faded",
    tone: "caution",
    rule: "Closed below its 50-day line without a gain.",
  },
};

/** States each stage can produce, in display order. */
export const STATES_BY_STAGE: Record<LifecycleStage, BreakoutState[]> = {
  forming: ["coiled", "near-pivot", "building"],
  breakouts: ["buy-zone", "extended", "strong"],
  climbing: ["buy-zone", "extended", "strong"],
  "played-out": ["paid-off", "failed", "faded"],
};

export interface BreakoutStateInput {
  /** Now vs pivot, %. Negative while below it. */
  pivot: number;
  /** Second-half / first-half ATR of the base; null or ≤0 when unknown. */
  coil?: number | null;
  resultPercent?: number | null;
  exitReason?: string | null;
}

export function breakoutState(stage: LifecycleStage, input: BreakoutStateInput): BreakoutState {
  const { pivot } = input;
  if (stage === "played-out") {
    if ((input.resultPercent ?? 0) > 0) return "paid-off";
    return /stop/i.test(input.exitReason ?? "") ? "failed" : "faded";
  }
  if (stage === "forming") {
    const coil = input.coil != null && input.coil > 0 ? input.coil : null;
    if (pivot >= -COILED_PIVOT_PERCENT && coil != null && coil <= COILED_MAX_ATR_RATIO) return "coiled";
    return pivot >= -NEAR_PIVOT_PERCENT ? "near-pivot" : "building";
  }
  if (pivot >= STRONG_PERCENT) return "strong";
  return pivot > BUY_ZONE_PERCENT ? "extended" : "buy-zone";
}
