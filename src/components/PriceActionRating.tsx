import { PA_COMPONENTS, paWhy, type PaGrade, type PriceActionRating } from "@/lib/screen/priceActionRating";

const GRADE_TONE: Record<PaGrade, string> = {
  "A+": "border-emerald-300 bg-emerald-100 text-emerald-800",
  A: "border-emerald-200 bg-emerald-50 text-emerald-700",
  B: "border-slate-200 bg-white text-slate-700",
  C: "border-amber-200 bg-amber-50 text-amber-800",
  D: "border-rose-200 bg-rose-50 text-rose-700",
};

const BAR_TONE: Record<PaGrade, string> = {
  "A+": "bg-emerald-500",
  A: "bg-emerald-400",
  B: "bg-slate-400",
  C: "bg-amber-400",
  D: "bg-rose-400",
};

function ratingTitle(rating: PriceActionRating): string {
  if (rating.score == null) return rating.label;
  const parts = rating.components.map((c) => `${c.label} ${c.points}/${c.max}`);
  for (const d of rating.deductions) parts.push(`${d.label} ${d.points}`);
  return `Price Action Rating ${rating.score}/100 (${rating.grade}, ${rating.label}). Raw ${rating.raw} → calibrated ${rating.score}.\n${parts.join(" · ")}`;
}

/** Compact "82 A" pill for tables; the tooltip carries the component breakdown. */
export function PaRatingPill({ rating }: { rating: PriceActionRating | null | undefined }) {
  if (!rating) return <span className="font-mono text-[11px] text-slate-300">—</span>;
  if (rating.score == null || !rating.grade) {
    return <span title={rating.label} className="text-[10px] font-bold text-slate-400">{rating.status === "illiquid" ? "Illiquid" : "Not rated"}</span>;
  }
  return (
    <span title={ratingTitle(rating)} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-black tabular-nums ${GRADE_TONE[rating.grade]}`}>
      {rating.score}<span className="text-[10px] opacity-80">{rating.grade}</span>
    </span>
  );
}

/** Drawer card: score, grade, component bars and deductions. */
export function PaRatingCard({ rating }: { rating: PriceActionRating | null | undefined }) {
  if (!rating) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Price Action Rating</p>
          <p className="mt-0.5 text-xs text-slate-500">Trend quality from daily candles, 0–100. Not a buy signal.</p>
        </div>
        {rating.score != null && rating.grade ? (
          <div className="text-right">
            <div className="font-mono text-3xl font-black leading-none text-slate-900">{rating.score}</div>
            <span className={`mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-black ${GRADE_TONE[rating.grade]}`}>
              {rating.grade} · {rating.label}
            </span>
          </div>
        ) : (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-500">{rating.label}</span>
        )}
      </div>
      {rating.score != null && rating.grade && (
        <>
          <ul className="mt-3 space-y-1.5">
            {rating.components.map((c) => {
              const desc = PA_COMPONENTS.find((p) => p.key === c.key)?.desc;
              return (
                <li key={c.key} title={desc} className="grid grid-cols-[88px_1fr_52px] items-center gap-2 text-xs">
                  <span className="font-bold text-slate-700">{c.label}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full ${BAR_TONE[rating.grade!]}`} style={{ width: `${Math.round((c.points / c.max) * 100)}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-slate-500">{c.points}/{c.max}</span>
                </li>
              );
            })}
          </ul>
          {rating.deductions.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-rose-700">
              Deductions: {rating.deductions.map((d) => `${d.label} ${d.points}`).join(" · ")}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            Raw {rating.raw} → calibrated {rating.score}. Calibrated so 85+ (A+) is about the top 5% of liquid NSE stocks, 70+ (A) the top 20%.
          </p>
          {rating.stats && (
            <>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">52-week range</p>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-gradient-to-r from-rose-200 via-slate-200 to-emerald-200">
                  <span
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-700 shadow"
                    style={{ left: `${Math.round(rating.stats.rangePosition * 100)}%` }}
                    aria-hidden
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] font-semibold text-slate-500">
                  <span>+{rating.stats.fromLow52.toFixed(1)}% above low</span>
                  <span>−{rating.stats.fromHigh52.toFixed(1)}% below high</span>
                </div>
              </div>
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Why</p>
                {paWhy(rating).map((line) => (
                  <li key={line} className="flex gap-1.5">
                    <span className="text-slate-300" aria-hidden>•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
