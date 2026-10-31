import { formatPrice } from "@/lib/format";
import { quickRows, whyLists, yearRange, type QuickInput, type QuickTone } from "@/lib/screen/quickRead";

const TONE: Record<QuickTone, string> = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  ok: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-rose-50 text-rose-800 ring-rose-200",
  none: "bg-slate-100 text-slate-500 ring-slate-200",
};

/**
 * One plain summary at the top of the stock drawer: six one-word ratings with a one-line reason, where the price sits in its 52-week
 * range, and two short lists (why it is here, what could go wrong). Everything comes from numbers the drawer already shows.
 */
export function StockQuickRead({
  input,
  candles,
  price,
  checks,
  flags,
}: {
  input: QuickInput;
  candles: { high: number; low: number; close: number }[];
  price: number | null;
  checks: { label: string; pass: boolean }[] | null;
  flags: { label: string; detail: string }[] | null;
}) {
  const rows = quickRows(input);
  const range = yearRange(candles, price);
  const lists = checks ? whyLists(checks, flags) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Quick read">
      <h3 className="text-sm font-black text-slate-900">Quick read</h3>
      <p className="mt-0.5 text-xs text-slate-500">The short version in plain words. The details are further down.</p>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.key} className="rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{row.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ring-1 ${TONE[row.tone]}`}>{row.rating}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">{row.note}</p>
          </li>
        ))}
      </ul>

      {range && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[11px] font-bold text-slate-500">
            <span>52-week low</span>
            <span>52-week high</span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-slate-200" role="img" aria-label={`Price is ${Math.round(range.position)}% of the way from its 52-week low to its high`}>
            <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#16894f] shadow" style={{ left: `${Math.min(100, Math.max(0, range.position))}%` }} />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono text-xs font-black tabular-nums text-slate-800">
            <span>₹{formatPrice(range.low)}</span>
            <span>₹{formatPrice(range.high)}</span>
          </div>
        </div>
      )}

      {lists && (lists.why.length > 0 || lists.risks.length > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-emerald-50/60 p-3">
            <h4 className="text-xs font-black text-emerald-900">What is working</h4>
            <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
              {lists.why.length ? lists.why.map((item) => <li key={item}>✓ {item}</li>) : <li className="text-slate-500">No checks are passing right now.</li>}
            </ul>
          </div>
          <div className="rounded-xl bg-rose-50/60 p-3">
            <h4 className="text-xs font-black text-rose-900">What is missing or risky</h4>
            <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
              {lists.risks.length ? lists.risks.map((item) => <li key={item}>✕ {item}</li>) : <li className="text-slate-500">Nothing flagged.</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
