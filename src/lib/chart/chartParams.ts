/**
 * User-editable indicator inputs for the pro chart, like TradingView's
 * "Inputs" tab. Values persist with the chart settings and are clamped on load.
 */
export type ParamKey =
  | "ma1" | "ma2" | "ma3"
  | "bbLength" | "bbMult"
  | "stPeriod" | "stMult"
  | "rsiLength"
  | "arbmLength" | "arbmDev" | "arbmSqzLen" | "arbmSqzPct" | "arbmTp1" | "arbmTp2" | "arbmTp3";

export interface ParamDef {
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
}

export const PARAM_DEFS: Record<ParamKey, ParamDef> = {
  ma1: { label: "Fast MA length", def: 20, min: 2, max: 400, step: 1 },
  ma2: { label: "Medium MA length", def: 50, min: 2, max: 400, step: 1 },
  ma3: { label: "Slow MA length", def: 200, min: 2, max: 400, step: 1 },
  bbLength: { label: "Length", def: 20, min: 2, max: 200, step: 1 },
  bbMult: { label: "Std dev multiplier", def: 2, min: 0.5, max: 5, step: 0.1 },
  stPeriod: { label: "ATR period", def: 10, min: 2, max: 100, step: 1 },
  stMult: { label: "Factor", def: 3, min: 0.5, max: 10, step: 0.1 },
  rsiLength: { label: "Length", def: 14, min: 2, max: 100, step: 1 },
  arbmLength: { label: "Regression length", def: 50, min: 10, max: 200, step: 1 },
  arbmDev: { label: "Deviation multiplier", def: 2, min: 0.5, max: 5, step: 0.1 },
  arbmSqzLen: { label: "Squeeze lookback", def: 100, min: 20, max: 300, step: 1 },
  arbmSqzPct: { label: "Squeeze threshold %", def: 20, min: 1, max: 100, step: 1 },
  arbmTp1: { label: "TP1 × bandwidth", def: 1, min: 0.1, max: 10, step: 0.1 },
  arbmTp2: { label: "TP2 × bandwidth", def: 2, min: 0.1, max: 10, step: 0.1 },
  arbmTp3: { label: "TP3 × bandwidth", def: 3, min: 0.1, max: 10, step: 0.1 },
};

export type ChartParams = Record<ParamKey, number>;

export const PARAM_KEYS = Object.keys(PARAM_DEFS) as ParamKey[];

export const DEFAULT_PARAMS: ChartParams = Object.fromEntries(PARAM_KEYS.map((k) => [k, PARAM_DEFS[k].def])) as ChartParams;

/** Inputs shown in each indicator's settings dialog. */
export const PARAM_GROUPS = {
  ma: ["ma1", "ma2", "ma3"],
  bb: ["bbLength", "bbMult"],
  st: ["stPeriod", "stMult"],
  rsi: ["rsiLength"],
  arbm: ["arbmLength", "arbmDev", "arbmSqzLen", "arbmSqzPct", "arbmTp1", "arbmTp2", "arbmTp3"],
} as const satisfies Record<string, readonly ParamKey[]>;

export type ParamGroup = keyof typeof PARAM_GROUPS;

/** Clamp to the allowed range and snap to the step; anything unusable falls back to the default. */
export function cleanParam(key: ParamKey, value: unknown): number {
  const d = PARAM_DEFS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return d.def;
  const clamped = Math.min(d.max, Math.max(d.min, n));
  const snapped = Math.round(clamped / d.step) * d.step;
  return Number(snapped.toFixed(d.step < 1 ? 2 : 0));
}

export function cleanParams(raw: unknown): ChartParams {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(PARAM_KEYS.map((k) => [k, k in src ? cleanParam(k, src[k]) : PARAM_DEFS[k].def])) as ChartParams;
}

/** Short input summary for the legend, e.g. "20 2" for Bollinger. */
export function paramSummary(group: ParamGroup, p: ChartParams): string {
  return PARAM_GROUPS[group].map((k) => (k === "arbmSqzPct" ? `${p[k]}%` : String(p[k]))).join(" ");
}
