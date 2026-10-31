import { TRADE_STATUS, type TradeStatusKey } from "@/lib/screen/tradeStatus";

export const TRADE_STATUS_STYLE: Record<TradeStatusKey, { chip: string; bar: string; text: string }> = {
  "buy-ready": { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500", text: "text-emerald-700" },
  watch: { chip: "border-sky-200 bg-sky-50 text-sky-700", bar: "bg-sky-500", text: "text-sky-700" },
  extended: { chip: "border-amber-200 bg-amber-50 text-amber-800", bar: "bg-amber-500", text: "text-amber-700" },
  avoid: { chip: "border-slate-200 bg-slate-100 text-slate-600", bar: "bg-slate-400", text: "text-slate-500" },
  "short-ready": { chip: "border-rose-200 bg-rose-50 text-rose-700", bar: "bg-rose-500", text: "text-rose-700" },
};

/** The compact status pill used everywhere a stock's single status is shown. */
export function TradeStatusPill({ status, title, suffix }: { status: TradeStatusKey; title?: string; suffix?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-black uppercase tracking-wide ${TRADE_STATUS_STYLE[status].chip}`}
      title={title ?? TRADE_STATUS[status].meaning}
    >
      {TRADE_STATUS[status].label}
      {suffix && <span className="opacity-70">{suffix}</span>}
    </span>
  );
}

/** One-line legend of the five statuses, for table footers. */
export function TradeStatusLegend({ keys }: { keys?: readonly TradeStatusKey[] }) {
  const list = keys ?? (["buy-ready", "watch", "extended", "avoid", "short-ready"] as const);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {list.map((key) => (
        <span key={key}>
          <b className={TRADE_STATUS_STYLE[key].text}>{TRADE_STATUS[key].label}:</b> {TRADE_STATUS[key].meaning}
        </span>
      ))}
    </div>
  );
}
