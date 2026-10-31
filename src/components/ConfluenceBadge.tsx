import { CONFLUENCE_FAMILIES, confluenceLevel, type Confluence } from "@/lib/screen/confluence";

const LEVEL_STYLES = {
  high: "border-emerald-300 bg-emerald-600 text-white",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  single: "border-slate-200 bg-slate-50 text-slate-600",
  none: "border-slate-200 bg-white text-slate-400",
} as const;

/** Bullish family count out of five, with one pip per family and a conflict warning. */
export function ConfluenceBadge({ confluence, compact = false }: { confluence: Confluence | null | undefined; compact?: boolean }) {
  const bull = confluence?.bull ?? [];
  const bear = confluence?.bear ?? [];
  const level = confluenceLevel(bull.length);
  const title = [
    `Bullish families: ${bull.length ? bull.join(", ") : "none"}`,
    `Bearish families: ${bear.length ? bear.join(", ") : "none"}`,
  ].join("\n");
  return (
    <span className="inline-flex flex-col gap-1" title={title}>
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${LEVEL_STYLES[level.key]}`}>
        {bull.length}/{CONFLUENCE_FAMILIES.length}
        {!compact && <span>{level.label}</span>}
      </span>
      <span className="flex gap-0.5" aria-hidden>
        {CONFLUENCE_FAMILIES.map((family) => (
          <span
            key={family}
            className={`h-1 w-3 rounded-full ${bull.includes(family) ? "bg-emerald-500" : bear.includes(family) ? "bg-rose-500" : "bg-slate-200"}`}
          />
        ))}
      </span>
      {confluence?.conflict && <span className="text-[9px] font-bold text-amber-700">Scanners disagree</span>}
    </span>
  );
}
