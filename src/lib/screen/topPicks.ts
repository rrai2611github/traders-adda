import type { ChecklistInputs } from "./checklist.ts";
import { SCREEN_NAMES, matchesScreenName, type ScreenName } from "./criteria.ts";
import { readyToRun, READY_RULES, type ReadyInput } from "./readyToRun.ts";

/**
 * One list for the Today page: the "Ready to run" stocks (just under their breakout level), stocks that just broke out, then the
 * strongest stocks the Weekly Top 5 ranks that are not buyable yet (strong but not near a breakout level, or already extended).
 */
export type PickTag = "ready" | "broke" | "watch" | "extended";

export interface PickRowInput extends ReadyInput {
  price: number;
  pivotPrice: number | null;
  aboveLow: number | null;
  coil: number | null;
  baseWk: number | null;
  baseDepth: number | null;
  listedWk: number | null;
  level: number | null;
  mcap: number | null;
}

export interface Top5Input {
  symbol: string;
  rs: number;
  close: number;
  name: string;
  sector: string | null;
  spark: number[];
}

export interface TopPick {
  symbol: string;
  tag: PickTag;
  name: string | null;
  sector: string | null;
  rs: number;
  price: number;
  /** Percent above the breakout level (negative under it); null with no level. */
  ext: number | null;
  pivotPrice: number | null;
  quiet: boolean;
  /** Where to buy; null for stocks to wait on. */
  buy: number | null;
  /** About 8% under the buy price, the stop that was tested. */
  stop: number | null;
  /** Places to book part profit (2R and 3R from the stop distance); null for stocks to wait on. */
  target1: number | null;
  target2: number | null;
  spark: number[] | null;
  /** The measures the checklist and analysis read; null for a Top 5 stock missing from the scan. */
  values: ChecklistInputs["values"] | null;
  /** The house screens the stock passes now (a stock just through its level is judged as sitting at it). */
  screens: ScreenName[];
}

/** The two screens whose breakout-day entries were backtested best (about 44-46% a year over ten years). */
export const TESTED_SCREENS: ReadonlyArray<ScreenName> = ["Blue sky", "Multi-year breakouts"];

export const PICK_RULES = {
  /** Percent past the breakout level that still counts as "just broke out". */
  brokeMaxExt: 5,
  stopPercent: 12,
  /**
   * Target distances in multiples of the stop distance. With the 12% stop these are the same +16% and +24% price levels the 10-year test
   * counted (scripts/backtest-winners.mjs, 8% stop: about 1 trade in 6 ended above +16% and 1 in 8 above +24%).
   */
  target1R: 4 / 3,
  target2R: 2,
  limitBuyable: 8,
  limitWait: 4,
} as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

const targetsFor = (buy: number, stop: number) => ({ target1: round2(buy + PICK_RULES.target1R * (buy - stop)), target2: round2(buy + PICK_RULES.target2R * (buy - stop)) });

const valuesOf = (row: PickRowInput): ChecklistInputs["values"] => ({
  rs: row.rs, vs50: row.vs50, vs200: row.vs200, fromHigh: row.fromHigh, aboveLow: row.aboveLow, turn: row.turnoverCr, mcap: row.mcap,
  baseWk: row.baseWk, baseDepth: row.baseDepth, coil: row.coil, dry: row.dry, listedWk: row.listedWk, level: row.level, ext: row.ext,
  price: row.price, turnoverCr: row.turnoverCr, series: row.series,
});

function screensOf(row: PickRowInput): ScreenName[] {
  const values = valuesOf(row);
  const judged = row.ext != null && row.ext > 0 && row.ext <= PICK_RULES.brokeMaxExt ? { ...values, ext: 0 } : values;
  return SCREEN_NAMES.filter((name) => matchesScreenName(judged, name));
}

export function buildTopPicks<T extends PickRowInput>(rows: ReadonlyArray<T>, top5: ReadonlyArray<Top5Input>): TopPick[] {
  const R = PICK_RULES;
  const picks: TopPick[] = [];
  const seen = new Set<string>();
  const sparkOf = new Map(top5.map((p) => [p.symbol, p]));
  const info = (symbol: string) => sparkOf.get(symbol);

  for (const { row, underPivot, quiet } of readyToRun(rows)) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    const buy = row.pivotPrice ?? row.price;
    picks.push({ symbol: row.symbol, tag: "ready", name: info(row.symbol)?.name ?? null, sector: info(row.symbol)?.sector ?? null, rs: row.rs ?? 0, price: row.price, ext: -underPivot, pivotPrice: row.pivotPrice, quiet, buy: round2(buy), stop: round2(buy * (1 - R.stopPercent / 100)), ...targetsFor(round2(buy), round2(buy * (1 - R.stopPercent / 100))), spark: info(row.symbol)?.spark ?? null, values: valuesOf(row), screens: screensOf(row) });
  }

  const broke = rows
    .filter((row) => (row.stage === "breakout" || row.stage === "climbing") && row.liquid !== false && row.series !== "BE" && !seen.has(row.symbol)
      && row.rs != null && row.rs >= READY_RULES.minRs && row.ext != null && row.ext > 0 && row.ext <= R.brokeMaxExt
      && row.vs50 != null && row.vs50 > 0 && row.vs200 != null && row.vs200 > 0
      && row.fromHigh != null && Math.abs(row.fromHigh) <= READY_RULES.maxFromHigh && row.turnoverCr != null && row.turnoverCr >= READY_RULES.minTurnoverCr
      && screensOf(row).some((name) => TESTED_SCREENS.includes(name)))
    .sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0));
  for (const row of broke) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    picks.push({ symbol: row.symbol, tag: "broke", name: info(row.symbol)?.name ?? null, sector: info(row.symbol)?.sector ?? null, rs: row.rs ?? 0, price: row.price, ext: row.ext, pivotPrice: row.pivotPrice, quiet: false, buy: round2(row.price), stop: round2(row.price * (1 - R.stopPercent / 100)), ...targetsFor(round2(row.price), round2(row.price * (1 - R.stopPercent / 100))), spark: info(row.symbol)?.spark ?? null, values: valuesOf(row), screens: screensOf(row) });
  }
  // The tested rule buys on the breakout day, so stocks that just broke out lead; the ones still under their level follow.
  picks.sort((a, b) => Number(a.tag === "ready") - Number(b.tag === "ready"));
  const buyable = picks.slice(0, R.limitBuyable);

  const bySymbol = new Map<string, T>();
  for (const row of rows) if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
  const wait: TopPick[] = [];
  for (const p of top5) {
    if (buyable.some((b) => b.symbol === p.symbol) || wait.length >= R.limitWait) continue;
    const row = bySymbol.get(p.symbol);
    const ext = row?.ext ?? null;
    wait.push({ symbol: p.symbol, tag: ext != null && ext > R.brokeMaxExt ? "extended" : "watch", name: p.name, sector: p.sector, rs: p.rs, price: row?.price ?? p.close, ext, pivotPrice: row?.pivotPrice ?? null, quiet: false, buy: null, stop: null, target1: null, target2: null, spark: p.spark, values: row ? valuesOf(row) : null, screens: row ? screensOf(row) : [] });
  }
  wait.sort((a, b) => Number(a.tag === "extended") - Number(b.tag === "extended") || b.rs - a.rs);
  return [...buyable, ...wait];
}
