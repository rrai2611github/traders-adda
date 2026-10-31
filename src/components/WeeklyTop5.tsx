"use client";

import { useWeeklyTop5 } from "@/hooks/useWeeklyTop5";
import { TOP5_RULES } from "@/lib/screen/weeklyTop5";
import { formatPrice } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";

const SIZE_STYLE = {
  full: "border-emerald-200 bg-emerald-50 text-emerald-900",
  quarter: "border-amber-200 bg-amber-50 text-amber-900",
  paper: "border-rose-200 bg-rose-50 text-rose-900",
} as const;

/**
 * The five strongest stocks right now, with a buy level, a stop and a target, and how much to risk in today's market.
 * Ranked by relative strength; the size note is part of the pick because the rule only paid in strong markets.
 */
export function WeeklyTop5() {
  const { data, message, failed } = useWeeklyTop5();

  return (
    <section aria-label="Weekly Top 5" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-black text-slate-900">Weekly Top 5</h2>
          <p className="text-xs text-slate-500">The strongest stocks to swing trade, ranked by relative strength. Hold about 2 to 6 weeks.</p>
        </div>
        {data && <span className="font-mono text-xs font-black text-slate-500">{data.picks.length} of {data.qualifying} qualify</span>}
      </header>

      {data && (
        <p className={`border-b px-5 py-3 text-xs leading-5 ${SIZE_STYLE[data.size.key]}`}>
          <b>{data.size.label}.</b> {data.size.detail}
          {data.breadth50 != null && <span className="opacity-80"> Breadth is {Math.round(data.breadth50)}%.</span>}
        </p>
      )}

      {!data ? (
        <p className="px-5 py-6 text-sm text-slate-600">
          {failed ? "The Weekly Top 5 could not be loaded. It retries every two minutes." : message}
        </p>
      ) : data.picks.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-600">No stock passes every rule right now. Not picking is a valid answer.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
              <tr>
                <th className="px-5 py-2.5">#</th>
                <th className="px-3 py-2.5">Stock</th>
                <th className="px-3 py-2.5 text-right">RS</th>
                <th className="px-3 py-2.5 text-right" title="Latest price">Price now</th>
                <th className="px-3 py-2.5 text-right" title="Last close. Skip it if the stock opens more than 5% above this.">Buy near</th>
                <th className="px-3 py-2.5 text-right" title={`${TOP5_RULES.atrStopMultiple} × average daily range below the buy price`}>Stop</th>
                <th className="px-3 py-2.5 text-right" title={`${TOP5_RULES.targetR}R: three times the distance to the stop. A point to book part profit; the tested exit is a close under the 50-day average`}>Part profit</th>
                <th className="px-5 py-2.5 text-right" title="Number of the app's scanners that list this stock today. A tie-breaker only.">Scanners</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.picks.map((pick, index) => (
                <tr key={pick.symbol} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-mono text-xs font-black text-slate-400">{index + 1}</td>
                  <td className="px-3 py-3">
                    <StockSymbolButton symbol={pick.symbol} className="font-black text-slate-900">{pick.symbol}</StockSymbolButton>
                    <div className="max-w-[220px] truncate text-xs text-slate-500">{pick.name}{pick.sector ? ` · ${pick.sector}` : ""}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-black text-emerald-700">{Math.round(pick.rs)}</td>
                  <td className="px-3 py-3 text-right"><LivePrice symbol={pick.symbol} fallbackPrice={pick.close} fallbackChange={null} /></td>
                  <td className="px-3 py-3 text-right font-mono">{formatPrice(pick.close)}</td>
                  <td className="px-3 py-3 text-right font-mono text-rose-700">{formatPrice(pick.stop)}<div className="text-[11px] text-slate-400">−{pick.riskPercent.toFixed(1)}%</div></td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-700">{formatPrice(pick.target)}</td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">{pick.scanners ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-600">
        <summary className="cursor-pointer font-bold text-slate-800">How these were picked</summary>
        <p className="mt-2">
          Every stock must have RS {TOP5_RULES.minRs} or higher, trade above its 50-day average, with the 50-day above the 150-day and the 150-day above the 200-day,
          sit within {TOP5_RULES.nearHighPercent}% of its 52-week high, and have a stop no wider than {TOP5_RULES.maxRiskPercent}%. The five with the highest RS are shown.
          Entry is the last close, stop is {TOP5_RULES.atrStopMultiple} × the average daily range below it, and the {TOP5_RULES.targetR}R level is only a point to book part profit. The tested exit is to hold until the stock closes under its 50-day average, or the stop is hit.
        </p>
        <p className="mt-2">
          Ten-year backtest, 2016 to 2026 (/backtest): with the exit under the 50-day average these picks made about +0.5R per trade (612 trades, same in both halves of the period, but a worst drop of about 52%); selling at a fixed 3R made only +0.12R. Buying only while 50%+ of stocks are above their 50-day average helps, which is why the size note above comes first.
          The test uses today&apos;s stock list, so delisted stocks are missing. This is a research ranking, not advice.
          {data?.provisional && " Today's forming candle is included while the market is open, so a pick can drop off before the close."}
        </p>
      </details>
    </section>
  );
}
