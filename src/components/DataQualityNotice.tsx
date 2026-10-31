import type { DataHealth } from "@/lib/market/historyQuality";

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Snapshot data checks: a failed refresh behind the shown (last-known) data,
 * histories excluded by validation, and expired-history fallbacks.
 * Renders nothing when every check is clean. Histories merely shortened after an
 * untrustworthy bar are not shown: they are rare, mostly illiquid stocks, and a
 * reader can do nothing about them (single glitches are repaired, not cut).
 */
export function DataQualityNotice({ health, updatedAt }: { health: DataHealth | null | undefined; updatedAt?: number }) {
  const quality = health?.dataQuality;
  const failure = health?.refreshFailure;
  const excluded = quality?.excluded ?? [];
  const fallback = quality?.historyFallback ?? [];
  if (!failure && !excluded.length && !fallback.length) return null;

  const tone = failure || excluded.length || fallback.length
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-border bg-raised text-muted";
  const parts = [
    excluded.length ? `${excluded.length} excluded` : null,
    fallback.length ? `${fallback.length} using expired history` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      {failure && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">
          Latest market-data refresh failed at {IST_TIME.format(failure.at)} IST: {failure.message}{" "}
          Showing the last complete snapshot{updatedAt ? ` from ${IST_TIME.format(updatedAt)} IST` : ""}; figures may be stale. Retrying automatically.
        </p>
      )}
      {parts.length > 0 && (
        <details className={`rounded-xl border px-4 py-2 text-xs ${tone}`}>
          <summary className="cursor-pointer font-bold">Data checks: {parts.join(" · ")}</summary>
          <div className="mt-2 max-h-48 space-y-2 overflow-auto leading-5">
            {excluded.length > 0 && (
              <div>
                <p className="font-semibold">Excluded from every calculation:</p>
                <ul>{excluded.map((item) => <li key={item.symbol}>{item.symbol}: {item.reason}</li>)}</ul>
              </div>
            )}
            {fallback.length > 0 && (
              <p>
                History refresh failed; expired cached history is used where continuity with the current quote is verified: {fallback.join(", ")}.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
