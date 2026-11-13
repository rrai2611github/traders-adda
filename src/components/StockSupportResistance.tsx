"use client";

import { useMemo } from "react";
import { autoLevels, type AutoLevel } from "@/lib/chart/autoLevels";
import { formatPrice } from "@/lib/format";
import type { Candle } from "@/lib/market/types";

export function StockSupportResistance({ candles, source }: {
  candles: ReadonlyArray<Candle>;
  source: string;
}) {
  const levels = useMemo(() => autoLevels(candles), [candles]);
  const latest = candles.at(-1);
  const supports = levels.filter((level) => level.kind === "support").sort((a, b) => b.price - a.price);
  const resistances = levels.filter((level) => level.kind === "resistance").sort((a, b) => a.price - b.price);
  const renderLevels = (items: AutoLevel[], kind: "support" | "resistance") => (
    items.length === 0 ? (
      <p className="mt-2 text-xs leading-5 text-slate-500">No qualifying {kind} found within 25% of the daily close. This does not mean none exists.</p>
    ) : (
      <ol className="mt-2 space-y-3">
        {items.map((level, index) => (
          <li key={level.price} className="text-xs leading-5 text-slate-700">
            <p><b className={kind === "support" ? "text-emerald-700" : "text-rose-700"}>{kind === "support" ? "S" : "R"}{index + 1}: ₹{formatPrice(level.price)}</b>
              {latest && <> · {Math.abs((level.price / latest.close - 1) * 100).toFixed(1)}% {kind === "support" ? "below" : "above"} the daily close</>}
            </p>
            <p>Zone ₹{formatPrice(level.zoneLow)}–₹{formatPrice(level.zoneHigh)} · {level.touches} swing touches</p>
            {level.flipped && <p className="text-slate-500">{kind === "support" ? "Former resistance, now below the daily close." : "Former support, now above the daily close."}</p>}
          </li>
        ))}
      </ol>
    )
  );
  return (
    <section aria-label="Support and resistance" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-black text-slate-900">Support & resistance · daily</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">Support is a zone where buyers previously appeared; resistance is where sellers appeared. These are reference zones, not another trade plan.</p>
      {!latest ? <p role="status" className="mt-3 text-xs text-slate-500">Daily history is not available yet. Support and resistance cannot be calculated.</p> : (
        <>
          <p className="mt-2 text-xs text-slate-500">{source} · daily candle {new Date(latest.t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })} · close ₹{formatPrice(latest.close)}. The latest candle may still be forming.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div><h4 className="text-xs font-bold text-emerald-700">Support below price</h4>{renderLevels(supports, "support")}</div>
            <div><h4 className="text-xs font-bold text-rose-700">Resistance above price</h4>{renderLevels(resistances, "resistance")}</div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Same swing-cluster calculation as daily Auto S/R: at least two touches, up to three levels per side, nearest first among the selected levels. Weekly, monthly or intraday chart levels can differ. Zones can fail; touches are not a probability of holding.</p>
        </>
      )}
    </section>
  );
}
