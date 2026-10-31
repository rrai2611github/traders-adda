/** Matches the "risk about 1% of capital per trade" rule quoted throughout the app's rules text. */
export const DEFAULT_RISK_PERCENT = 1;

export interface PositionSize {
  quantity: number;
  capitalRequired: number;
  riskAmount: number;
  riskBudget: number;
  /** True when the account can't afford even one share within the risk budget, so quantity is 0. */
  tooSmall: boolean;
  /** True when quantity was capped by available capital rather than by the risk budget. */
  capitalCapped: boolean;
}

/**
 * Whole-share quantity that risks at most `riskPercent` of `accountSize` if
 * stopped out at `stop`, without spending more than the account holds. This
 * turns the written "risk ≤1%" rule into a number at the exact moment a
 * trader is deciding how much to buy, instead of mental math against the
 * entry/stop shown in the plan.
 */
export function computePositionSize({
  accountSize,
  entry,
  stop,
  riskPercent = DEFAULT_RISK_PERCENT,
}: {
  accountSize: number;
  entry: number;
  stop: number;
  riskPercent?: number;
}): PositionSize {
  const riskBudget = accountSize * (riskPercent / 100);
  const perShareRisk = entry - stop;
  if (!(perShareRisk > 0) || !(accountSize > 0) || !(entry > 0)) {
    return { quantity: 0, capitalRequired: 0, riskAmount: 0, riskBudget, tooSmall: true, capitalCapped: false };
  }
  const byRisk = Math.floor(riskBudget / perShareRisk);
  const byCapital = Math.floor(accountSize / entry);
  const quantity = Math.max(0, Math.min(byRisk, byCapital));
  return {
    quantity,
    capitalRequired: quantity * entry,
    riskAmount: quantity * perShareRisk,
    riskBudget,
    tooSmall: quantity === 0,
    capitalCapped: quantity === byCapital && byCapital < byRisk,
  };
}
