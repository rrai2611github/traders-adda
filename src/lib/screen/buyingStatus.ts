import type { BuyCheck, BuyReadiness } from "./buyReady.ts";
import type { RiskFlag } from "./riskFlags.ts";
import { longStatusKey, TRADE_STATUS, type TradeStatusKey } from "./tradeStatus.ts";

export type BuyingStatusKey = Exclude<TradeStatusKey, "short-ready">;

export interface BuyingStatus {
  key: BuyingStatusKey;
  label: "Buy ready" | "Watch" | "Extended" | "Avoid";
  rating: number;
  passed: number;
  total: number;
  failed: string[];
  detail: string;
  checks: RatedCheck[];
  /** Price-action warnings; any "high" one stops the setup from being Buy-ready. */
  riskFlags?: RiskFlag[];
}

export interface RatedCheck {
  key: string;
  label: string;
  pass: boolean;
}

export interface CurrentScanBuyingInput {
  price: number;
  turnoverCr: number | null;
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  exitReason?: string | null;
  riskFlags?: RiskFlag[];
  oscillatorScore: {
    score: number;
    levels: { riskPercent: number; buyZoneHigh: number } | null;
  } | null;
}

const LABELS = {
  "buy-ready": TRADE_STATUS["buy-ready"].label,
  watch: TRADE_STATUS.watch.label,
  extended: TRADE_STATUS.extended.label,
  avoid: TRADE_STATUS.avoid.label,
} as Record<BuyingStatusKey, BuyingStatus["label"]>;

/**
 * Produces the one status vocabulary (see tradeStatus.ts) from pass/fail checks.
 * Buy ready is possible only when every supplied check passes.
 */
export function classifyBuyingStatus(checks: RatedCheck[]): BuyingStatus {
  const passed = checks.filter((check) => check.pass).length;
  const total = checks.length;
  const rating = total ? Math.round((passed / total) * 100) : 0;
  const failed = checks.filter((check) => !check.pass).map((check) => check.label);
  const key = longStatusKey(checks);
  const stockFailed = checks.filter((check) => !check.pass && check.key !== "breadth").map((check) => check.label);

  const detail =
    key === "buy-ready"
      ? "Every required strength, trend, risk, pattern and market check passes."
      : key === "watch"
        ? "Every stock check passes; wait for market breadth to recover."
        : key === "extended"
          ? "The stock qualifies, but price is past the buy zone. Don't chase; wait for a pullback."
          : `Not a trade today: ${stockFailed.join(", ").toLowerCase() || "checks unavailable"}.`;

  return { key, label: LABELS[key], rating, passed, total, failed, detail, checks };
}

/**
 * Splits failed checks into stock-specific labels and the market-wide breadth
 * gate, so tables don't repeat the same market message on every row.
 */
export function splitFailedChecks(checks: RatedCheck[]): { stock: string[]; breadth: boolean } {
  const failed = checks.filter((check) => !check.pass);
  return {
    stock: failed.filter((check) => check.key !== "breadth").map((check) => check.label),
    breadth: failed.some((check) => check.key === "breadth"),
  };
}

/**
 * Attaches risk flags. The rating is unchanged (it is still the share of checks
 * passing), but a high-severity flag caps a Buy ready setup at Watch.
 */
export function withRiskFlags(status: BuyingStatus, flags: RiskFlag[] | undefined): BuyingStatus {
  if (!flags?.length) return status;
  const blocking = flags.filter((flag) => flag.severity === "high");
  if (status.key !== "buy-ready" || !blocking.length) return { ...status, riskFlags: flags };
  return {
    ...status,
    key: "watch",
    label: LABELS.watch,
    detail: `Every check passes, but wait: ${blocking.map((flag) => flag.label.toLowerCase()).join(" and ")}.`,
    riskFlags: flags,
  };
}

export function scannerBuyingStatus(readiness: BuyReadiness): BuyingStatus {
  const labels: Record<BuyCheck["key"], string> = {
    breadth: "Market breadth",
    liquid: "Liquidity",
    rs: "Relative strength",
    score: "Oscillator score",
    trend: "Trend",
    notExtended: "Extension",
    risk: "Risk",
    pattern: "Pattern quality",
  };
  return classifyBuyingStatus(readiness.checks.map((check) => ({
    key: check.key,
    label: labels[check.key],
    pass: check.pass,
  })));
}

export function currentScanBuyingStatus(row: CurrentScanBuyingInput, breadthPercent: number | null): BuyingStatus {
  return withRiskFlags(classifyBuyingStatus([
    { key: "breadth", label: "Market breadth", pass: breadthPercent != null && breadthPercent >= 50 },
    { key: "liquid", label: "Liquidity", pass: row.turnoverCr != null && row.turnoverCr >= 5 },
    { key: "rs", label: "Relative strength", pass: row.rs != null && row.rs >= 70 },
    { key: "trend", label: "50/200-day trend", pass: row.vs50 != null && row.vs50 > 0 && row.vs200 != null && row.vs200 > 0 },
    { key: "score", label: "Oscillator score", pass: row.oscillatorScore != null && row.oscillatorScore.score >= 10 },
    { key: "risk", label: "Risk at most 6%", pass: row.oscillatorScore?.levels != null && row.oscillatorScore.levels.riskPercent <= 6 },
    { key: "extension", label: "Inside buy zone", pass: row.oscillatorScore?.levels != null && row.price <= row.oscillatorScore.levels.buyZoneHigh },
    { key: "pattern", label: "Active setup", pass: row.exitReason == null },
  ]), row.riskFlags);
}
