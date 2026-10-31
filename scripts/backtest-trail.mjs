// How the trailing-average length changes results, per screen and per period (a neighbourhood check, not a single best pick).
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";
const periods = [["2017-2026", "2016-12-01", "2026-10-16"], ["2017-2021", "2016-12-01", "2021-12-31"], ["2022-2026", "2022-01-01", "2026-10-16"]];
for (const screen of ["Multi-year breakouts", "Blue sky", "VCP", "IPO base"]) {
  for (const period of [30, 50, 75, 100, 150]) {
    const cells = periods.map(([label, from, to]) => {
      const r = runBacktest({ ...DEFAULT_SETTINGS, from, to, breadthMin: 50, strategy: { kind: "screen", screen }, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period, when: "close" }, maxHoldDays: 0 }, ".cache/history10y");
      return `${label}: R${r.stats.avgR?.toFixed(2)} ${r.stats.cagrPercent?.toFixed(0) ?? "-"}% DD${r.stats.maxDrawdownPercent.toFixed(0)}`;
    });
    console.log(`${screen.padEnd(21)} ${String(period).padStart(3)}DMA  ${cells.join(" | ")}`);
  }
}
