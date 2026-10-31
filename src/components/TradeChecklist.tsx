"use client";

import { useMemo } from "react";
import { useBreadth } from "@/hooks/useBreadth";
import { useNiftyTrend } from "@/hooks/useNiftyTrend";
import { useResultsDates } from "@/hooks/useResultsDates";
import { daysUntil } from "@/lib/market/boardMeetings";
import { buildChecklist, type CheckState } from "@/lib/screen/checklist";
import type { ScanRow } from "@/hooks/useScreenScan";
import { buildTradePlan, measurePlanInputs } from "@/lib/screen/tradePlan";
import type { Candle } from "@/lib/market/types";

const MARK: Record<CheckState, { icon: string; style: string }> = {
  pass: { icon: "✓", style: "bg-emerald-600 text-white" },
  warn: { icon: "!", style: "bg-amber-500 text-white" },
  fail: { icon: "✕", style: "bg-rose-600 text-white" },
  na: { icon: "–", style: "bg-slate-300 text-slate-700" },
};

const VERDICT_STYLE = {
  ready: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  partly: "bg-amber-50 text-amber-900 ring-amber-200",
  "not-yet": "bg-rose-50 text-rose-800 ring-rose-200",
} as const;

/**
 * The rules the 10-year backtest favoured, checked one by one for this stock, with the exit that tested best for the screens it is on.
 * A research checklist, not advice.
 */
export function TradeChecklist({ row, candles }: { row: ScanRow; candles: Candle[] }) {
  const { data: breadth } = useBreadth();
  const nifty = useNiftyTrend();
  const results = useResultsDates();
  const checklist = useMemo(() => {
    const inputs = candles.length ? measurePlanInputs(candles) : null;
    const plan = inputs ? buildTradePlan(inputs) : null; // the 2 x ATR stop measures how much the stock normally swings
    return buildChecklist({ breadth50: breadth?.latest?.above[50] ?? null, values: { ...row, turn: row.turnoverCr }, stopPercent: plan?.stopPercent ?? null, resultsInDays: results ? (results.dates[row.symbol] ? daysUntil(results.dates[row.symbol], results.today) : null) : undefined, niftyAbove200: nifty ? nifty.above : undefined, niftyPercent: nifty?.percent });
  }, [breadth, candles, results, row, nifty]);

  return (
    <section aria-label="Trade checklist" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Trade checklist</h3>
          <p className="text-[11px] text-slate-500">The rules the 10-year backtest favoured, one by one.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black ring-1 ${VERDICT_STYLE[checklist.verdict]}`}>{checklist.headline}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5 text-xs">
            <span aria-label={item.state} className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${MARK[item.state].style}`}>{MARK[item.state].icon}</span>
            <span className="min-w-0">
              <span className="font-bold text-slate-800">{item.label}</span>
              <span className="block text-[11px] text-slate-500">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-600">
        Exit: stop at the stop level, then hold while it closes above its <b>{checklist.exitDays}-day average</b>
        {checklist.exitDays === 100 ? " (the slower exit tested better for Multi-year breakouts)" : ""}. Risk about 1% of capital a trade.
      </p>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">Only 30–40% of trades win; a few big winners pay for the rest. Research output, not advice.</p>
    </section>
  );
}
