import { HEALTHY_BREADTH_PERCENT } from "@/lib/screen/breadth";

/**
 * The market-wide breadth gate, shown wherever a Buy/Watch/Avoid status is
 * shown. A stock's own "Avoid" can mean either "this stock fails a check" or
 * "the market isn't healthy enough," and those are very different reasons —
 * without this banner repeated next to the per-stock status, the market-wide
 * reason gets lost in the per-stock noise.
 */
export function MarketGateBanner({
  breadth,
  healthy,
  compact = false,
  label = "Market gate",
  threshold = HEALTHY_BREADTH_PERCENT,
  allowedText = "buying allowed",
  blockedText = "no new buys — watch only",
}: {
  breadth: number | null;
  healthy: boolean;
  compact?: boolean;
  label?: string;
  /** Breadth the gate needs, and what to say either way. The older scanner gate needs 50%; the tested setup check needs 35%. */
  threshold?: number;
  allowedText?: string;
  blockedText?: string;
}) {
  const value = breadth ?? 0;

  if (compact) {
    return (
      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2 text-xs ${
          healthy ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
        <span className={`font-black ${healthy ? "text-emerald-800" : "text-amber-900"}`}>
          {label}: {healthy ? allowedText : blockedText}
        </span>
        <span className="ml-auto font-mono text-[11px] font-bold text-slate-500">
          Breadth {breadth != null ? `${Math.round(breadth)}%` : "—"} · needs {threshold}%
        </span>
      </div>
    );
  }

  return (
    <section
      className={`flex flex-wrap items-center gap-5 rounded-2xl border px-5 py-4 shadow-sm ${
        healthy ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
        <div className={`mt-1 text-xl font-black ${healthy ? "text-emerald-800" : "text-amber-900"}`}>
          {healthy ? "Buying allowed" : "No new buys — watch only"}
        </div>
      </div>
      <div className="min-w-[240px] flex-1">
        <div className="flex justify-between text-xs font-bold text-slate-600">
          <span>Breadth {breadth != null ? `${Math.round(breadth)}%` : "—"}</span>
          <span>needs {HEALTHY_BREADTH_PERCENT}%</span>
        </div>
        <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-white">
          <div className={`h-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${HEALTHY_BREADTH_PERCENT}%` }} aria-hidden />
        </div>
      </div>
    </section>
  );
}
