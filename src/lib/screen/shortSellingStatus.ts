import type { ScanStage } from "@/hooks/useScreenScan";
import type { RatedCheck } from "./buyingStatus";
import { TRADE_STATUS } from "./tradeStatus.ts";

/** Short side of the one status vocabulary: Short ready when every bearish check passes, otherwise Avoid. */
export type ShortSellingStatusKey = "short-ready" | "avoid";

export interface ShortSellingStatus {
  key: ShortSellingStatusKey;
  label: "Short ready" | "Avoid";
  rating: number;
  passed: number;
  total: number;
  failed: string[];
  detail: string;
  checks: RatedCheck[];
}

export interface CurrentScanShortInput {
  changePercent: number;
  turnoverCr: number | null;
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  stage: ScanStage | null;
  oscillatorScore: {
    bearish: number;
  } | null;
}

export function classifyShortSellingStatus(checks: RatedCheck[]): ShortSellingStatus {
  const passed = checks.filter((check) => check.pass).length;
  const total = checks.length;
  const rating = total ? Math.round((passed / total) * 100) : 0;
  const failed = checks.filter((check) => !check.pass).map((check) => check.label);
  const key: ShortSellingStatusKey = total > 0 && passed === total ? "short-ready" : "avoid";
  const label = (key === "short-ready" ? TRADE_STATUS["short-ready"].label : TRADE_STATUS.avoid.label) as ShortSellingStatus["label"];
  const detail =
    key === "short-ready"
      ? "Every measured market, liquidity, weakness, trend and momentum check supports a bearish setup."
      : `No short setup: ${failed.join(", ").toLowerCase()}.`;

  return { key, label, rating, passed, total, failed, detail, checks };
}

export function currentScanShortSellingStatus(
  row: CurrentScanShortInput,
  breadthPercent: number | null,
): ShortSellingStatus {
  return classifyShortSellingStatus([
    { key: "breadth", label: "Weak market breadth", pass: breadthPercent != null && breadthPercent < 50 },
    { key: "liquid", label: "Liquidity", pass: row.turnoverCr != null && row.turnoverCr >= 5 },
    { key: "rs", label: "Relative weakness", pass: row.rs != null && row.rs <= 30 },
    { key: "below50", label: "Below 50-day average", pass: row.vs50 != null && row.vs50 < 0 },
    { key: "below200", label: "Below 200-day average", pass: row.vs200 != null && row.vs200 < 0 },
    { key: "oscillators", label: "Bearish oscillators", pass: row.oscillatorScore != null && row.oscillatorScore.bearish >= 8 },
    { key: "priceAction", label: "Negative price action", pass: row.changePercent < 0 },
    { key: "setup", label: "No active bullish breakout", pass: row.stage !== "breakout" && row.stage !== "climbing" },
  ]);
}
