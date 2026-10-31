import { SCREEN_NAMES } from "../screen/criteria.ts";
import { DEFAULT_SETTINGS, type BacktestSettings } from "./types.ts";

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const date = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Turns whatever the browser sent into safe settings; anything missing or out of range falls back to the default. */
export function parseSettings(input: unknown): BacktestSettings {
  const d = DEFAULT_SETTINGS;
  const o = rec(input);
  const st = rec(o.strategy);
  const strategy: BacktestSettings["strategy"] = st.kind === "screen" && SCREEN_NAMES.includes(st.screen as never)
    ? { kind: "screen", screen: st.screen as never }
    : { kind: "leaders", rsMin: num(st.rsMin, 80, 1, 99), nearHighPercent: num(st.nearHighPercent, 25, 1, 90), breakout: st.breakout === true, ...(st.maxAboveSma50Percent != null ? { maxAboveSma50Percent: num(st.maxAboveSma50Percent, 15, 1, 100) } : {}), ...(st.volumeDryUp === true ? { volumeDryUp: true } : {}) };
  const sp = rec(o.stop);
  const stop: BacktestSettings["stop"] = sp.kind === "percent" ? { kind: "percent", percent: num(sp.percent, 8, 1, 25) } : { kind: "atr", multiple: num(sp.multiple, 2, 0.5, 6) };
  const ex = rec(o.exit);
  const exit: BacktestSettings["exit"] = ex.kind === "stop" ? { kind: "stop" }
    : ex.kind === "ma" ? { kind: "ma", type: ex.type === "ema" ? "ema" : "sma", period: Math.round(num(ex.period, 50, 5, 200)), when: ex.when === "next-open" ? "next-open" : "close" }
    : { kind: "target", r: num(ex.r, 3, 0.5, 20) };
  const sz = rec(o.sizing);
  return {
    strategy,
    from: date(o.from, "2017-01-01"),
    to: date(o.to, d.to),
    entry: o.entry === "at-pivot" && strategy.kind === "screen" ? "at-pivot" : "next-open",
    stop,
    exit,
    maxHoldDays: Math.round(num(o.maxHoldDays, 0, 0, 500)),
    costPercent: num(o.costPercent, d.costPercent, 0, 3),
    capital: num(o.capital, d.capital, 10_000, 1e9),
    maxPositions: Math.round(num(o.maxPositions, d.maxPositions, 1, 50)),
    sizing: sz.kind === "equal" ? { kind: "equal" } : { kind: "risk", riskPercent: num(sz.riskPercent, 1, 0.1, 5) },
    positionCapPercent: num(o.positionCapPercent, d.positionCapPercent, 1, 100),
    turnoverLimitPercent: num(o.turnoverLimitPercent, d.turnoverLimitPercent, 0, 100),
    breadthMin: num(o.breadthMin, 50, 0, 100),
    floor: o.floor === "screen" ? "screen" : "trading",
    maxNewPerDay: Math.round(num(o.maxNewPerDay, d.maxNewPerDay, 1, 20)),
    ...(Array.isArray(o.alsoScreens) && strategy.kind === "screen"
      ? (() => { const list = SCREEN_NAMES.filter((n) => (o.alsoScreens as unknown[]).includes(n) && n !== strategy.screen); return list.length ? { alsoScreens: list } : {}; })()
      : {}),
    ...(rec(o.addOn).afterPercent != null && num(rec(o.addOn).afterPercent, 0, 0, 200) > 0
      ? { addOn: { afterPercent: num(rec(o.addOn).afterPercent, 15, 1, 200), fraction: num(rec(o.addOn).fraction, 1, 0.1, 2) } }
      : {}),
    ...(num(o.niftyAbove, 0, 0, 400) > 0 ? { niftyAbove: Math.round(num(o.niftyAbove, 0, 5, 400)) } : {}),
    ...(() => {
      const s = rec(o.stress);
      const slippagePercent = num(s.slippagePercent, 0, 0, 5);
      const gapShare = num(s.gapShare, 0, 0, 0.5);
      return slippagePercent > 0 || gapShare > 0
        ? { stress: { slippagePercent, gapShare, gapLossPercent: num(s.gapLossPercent, 25, 5, 60), seed: Math.round(num(s.seed, 7, 1, 1_000_000)) } }
        : {};
    })(),
    ...(num(o.maxPerSector, 0, 0, 20) >= 1 ? { maxPerSector: Math.round(num(o.maxPerSector, 0, 1, 20)) } : {}),
    ...(num(o.minRs, 0, 0, 99) > 0 ? { minRs: Math.round(num(o.minRs, 0, 0, 99)) } : {}),
    ...(typeof o.symbol === "string" && /^[A-Z0-9&_.-]{1,20}$/.test(o.symbol.trim().toUpperCase()) ? { symbol: o.symbol.trim().toUpperCase() } : {}),
  };
}
