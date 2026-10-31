import { splitFailedChecks, type BuyingStatus } from "@/lib/screen/buyingStatus";
import { TRADE_STATUS_STYLE } from "./TradeStatusBadge";

const styles = Object.fromEntries(Object.entries(TRADE_STATUS_STYLE).map(([k, v]) => [k, v.chip])) as Record<BuyingStatus["key"], string>;
const bars = Object.fromEntries(Object.entries(TRADE_STATUS_STYLE).map(([k, v]) => [k, v.bar])) as Record<BuyingStatus["key"], string>;

export function BuyingStatusBadge({ status, showMissing = true }: {
  status: BuyingStatus;
  showMissing?: boolean;
}) {
  const missing = splitFailedChecks(status.checks);
  return (
    <div className="min-w-[138px]" title={status.detail}>
      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-black uppercase tracking-wide ${styles[status.key]}`}>
        {status.label}
        <span className="opacity-70">{status.rating}</span>
      </span>
      <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bars[status.key]}`} style={{ width: `${status.rating}%` }} />
      </div>
      {showMissing && missing.stock.length > 0 && (
        <div className="mt-1 max-w-40 truncate text-[10.5px] font-medium text-slate-400" title={`Missing: ${status.failed.join(", ")}`}>
          Missing: {missing.stock.join(", ")}
        </div>
      )}
      {showMissing && missing.stock.length === 0 && missing.breadth && (
        <div className="mt-1 text-[10.5px] font-bold text-amber-700" title="Every stock check passes; only the market-wide breadth gate is closed.">
          Waits for market breadth
        </div>
      )}
      {status.riskFlags?.some((flag) => flag.severity === "high") && (
        <div
          className="mt-1 max-w-40 truncate text-[10.5px] font-bold text-rose-600"
          title={status.riskFlags.filter((flag) => flag.severity === "high").map((flag) => `${flag.label}: ${flag.detail}`).join("\n")}
        >
          ⚠ {status.riskFlags.filter((flag) => flag.severity === "high").map((flag) => flag.label).join(", ")}
        </div>
      )}
    </div>
  );
}
