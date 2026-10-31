import raw from "./horizonBacktest.json";
import type { BuyHorizon, TargetOdds } from "./horizonSignal";

type Sample = Omit<TargetOdds, "maxHoldSessions" | "from" | "to"> | null;

interface RawHorizonBacktest {
  from: string;
  to: string;
  maxHoldSessions: Record<BuyHorizon, number>;
  horizons: Record<BuyHorizon, { buyReady: Sample; stockChecks: Sample }>;
}

const backtest = raw as RawHorizonBacktest;

/** Buy ready sample from `node --no-warnings scripts/backtest-horizons.mjs --write`; null if the horizon has no trades. */
export function horizonTargetOdds(horizon: BuyHorizon): TargetOdds | null {
  const sample = backtest.horizons[horizon]?.buyReady;
  if (!sample) return null;
  return { ...sample, maxHoldSessions: backtest.maxHoldSessions[horizon], from: backtest.from, to: backtest.to };
}
