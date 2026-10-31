import type { TimeframeAgreement, TrendDirection } from "@/lib/screen/multiTimeframe";

const ARROW: Record<Exclude<TrendDirection, null>, string> = { up: "↑", down: "↓" };

function letter(direction: TrendDirection): string {
  return direction ? ARROW[direction] : "·";
}

/**
 * Daily/Weekly/Monthly trend at a glance, from the same 20-EMA overlay the
 * chart already offers. Conflicting timeframes are one of the most common
 * reasons a technically-valid setup fails — this surfaces that without
 * making the trader flip the chart's own timeframe toggle three times.
 */
export function TimeframeAgreementBadge({ agreement, dark = false }: { agreement: TimeframeAgreement; dark?: boolean }) {
  const { daily, weekly, monthly, aligned, conflicting } = agreement;
  const title = [
    `Daily: ${daily ?? "not enough history"}`,
    `Weekly: ${weekly ?? "not enough history"}`,
    `Monthly: ${monthly ?? "not enough history"}`,
    conflicting ? "Timeframes disagree — treat the setup with extra caution." : aligned ? "All readable timeframes agree." : "",
  ].filter(Boolean).join("\n");

  const tone = conflicting
    ? dark ? "bg-amber-400/15 text-amber-300 ring-amber-400/30" : "bg-amber-50 text-amber-800 ring-amber-200"
    : aligned
      ? dark ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30" : "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : dark ? "bg-slate-400/15 text-slate-300 ring-slate-400/30" : "bg-slate-100 text-slate-500 ring-slate-200";

  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-black tracking-normal ring-1 ${tone}`}>
      D{letter(daily)} W{letter(weekly)} M{letter(monthly)}
    </span>
  );
}
