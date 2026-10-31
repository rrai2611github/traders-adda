import { splitFailedChecks } from "@/lib/screen/buyingStatus";
import type { ShortSellingStatus } from "@/lib/screen/shortSellingStatus";
import { TRADE_STATUS_STYLE } from "./TradeStatusBadge";

const styles: Record<ShortSellingStatus["key"], string> = { "short-ready": TRADE_STATUS_STYLE["short-ready"].chip, avoid: TRADE_STATUS_STYLE.avoid.chip };
const bars: Record<ShortSellingStatus["key"], string> = { "short-ready": TRADE_STATUS_STYLE["short-ready"].bar, avoid: TRADE_STATUS_STYLE.avoid.bar };

export function ShortSellingStatusBadge({ status }: { status: ShortSellingStatus }) {
  const missing = splitFailedChecks(status.checks);
  return (
    <div className="min-w-[138px]" title={status.detail}>
      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${styles[status.key]}`}>
        {status.label}
        <span className="opacity-70">{status.rating}</span>
      </span>
      <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bars[status.key]}`} style={{ width: `${status.rating}%` }} />
      </div>
      {missing.stock.length > 0 && (
        <div className="mt-1 max-w-40 truncate text-[9px] font-medium text-slate-400" title={`Missing: ${status.failed.join(", ")}`}>
          Missing: {missing.stock.join(", ")}
        </div>
      )}
      {missing.stock.length === 0 && missing.breadth && (
        <div className="mt-1 text-[9px] font-bold text-orange-700" title="Every stock check passes; the market is too broad-based to favour shorts.">
          Waits for weaker breadth
        </div>
      )}
    </div>
  );
}
