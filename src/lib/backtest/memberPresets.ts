import type { BacktestSettings } from "./types.ts";

export interface MemberBacktestPreset {
  id: string;
  name: string;
  description: string;
  settings: BacktestSettings;
}

const BASE: Omit<BacktestSettings, "strategy" | "alsoScreens"> = {
  from: "2017-01-01",
  to: "2026-11-20",
  entry: "next-open",
  stop: { kind: "percent", percent: 12 },
  exit: { kind: "ma", type: "sma", period: 50, when: "close" },
  maxHoldDays: 0,
  costPercent: 0.25,
  capital: 1_000_000,
  maxPositions: 10,
  sizing: { kind: "risk", riskPercent: 2 },
  positionCapPercent: 20,
  turnoverLimitPercent: 10,
  breadthMin: 35,
  floor: "trading",
  maxNewPerDay: 3,
};

export const MEMBER_BACKTEST_PRESETS: readonly MemberBacktestPreset[] = [
  {
    id: "tested-combination",
    name: "Blue sky + Multi-year breakouts",
    description: "The tested combination, using the 12% stop and 50-day-average exit.",
    settings: {
      ...BASE,
      strategy: { kind: "screen", screen: "Blue sky" },
      alsoScreens: ["Multi-year breakouts"],
    },
  },
  {
    id: "blue-sky",
    name: "Blue sky only",
    description: "The same fixed risk and exit rules, using only the Blue sky screen.",
    settings: { ...BASE, strategy: { kind: "screen", screen: "Blue sky" } },
  },
  {
    id: "multi-year-breakouts",
    name: "Multi-year breakouts only",
    description: "The same fixed risk and exit rules, using only the Multi-year breakouts screen.",
    settings: { ...BASE, strategy: { kind: "screen", screen: "Multi-year breakouts" } },
  },
];

export function getMemberBacktestPreset(id: unknown): MemberBacktestPreset | null {
  return typeof id === "string" ? MEMBER_BACKTEST_PRESETS.find((preset) => preset.id === id) ?? null : null;
}

export function getMemberBacktestPresetFromBody(body: unknown): MemberBacktestPreset | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("presetId" in record)) return null;
  return getMemberBacktestPreset(record.presetId);
}
