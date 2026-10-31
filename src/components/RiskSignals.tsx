import type { RelativeVolume, RiskFlag } from "@/lib/screen/riskFlags";

function rvolTone(ratio: number): string {
  if (ratio >= 2) return "border-emerald-300 bg-emerald-100 text-emerald-800";
  if (ratio >= 1.5) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (ratio >= 1) return "border-slate-200 bg-white text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-400";
}

/** Relative volume: session volume against the 50-session average. */
export function RvolPill({ rvol }: { rvol: RelativeVolume | null | undefined }) {
  if (!rvol) return <span className="font-mono text-[11px] text-slate-300">—</span>;
  const title = rvol.projected
    ? `Projected full-session volume is ${rvol.ratio.toFixed(2)}× the 50-day average (from volume so far, adjusted for the usual intraday pattern)`
    : `Session volume was ${rvol.ratio.toFixed(2)}× the 50-day average`;
  return (
    <span title={title} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-black tabular-nums ${rvolTone(rvol.ratio)}`}>
      {rvol.projected ? "~" : ""}{rvol.ratio.toFixed(1)}×
    </span>
  );
}

const FLAG_STYLES: Record<RiskFlag["severity"], string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  caution: "border-amber-200 bg-amber-50 text-amber-800",
};

/** Compact risk warnings; `max` limits the chips shown and folds the rest into "+n". */
export function RiskFlagChips({ flags, max = 2 }: { flags: RiskFlag[] | undefined; max?: number }) {
  if (!flags?.length) return null;
  const sorted = [...flags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  const shown = sorted.slice(0, max);
  const rest = sorted.slice(max);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((flag) => (
        <span key={flag.key} title={flag.detail} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${FLAG_STYLES[flag.severity]}`}>
          <span aria-hidden>⚠</span>{flag.label}
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map((flag) => `${flag.label}: ${flag.detail}`).join("\n")} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
          +{rest.length}
        </span>
      )}
    </span>
  );
}
