import type { ReactNode } from "react";

export interface TradeCardData {
  key: string;
  /** Left of the header: usually the stock name. */
  title: ReactNode;
  /** Right of the header: the result that matters most (profit or gain), already coloured. */
  headline: ReactNode;
  /** Small label/value pairs under the header. */
  facts: ReadonlyArray<{ label: string; value: ReactNode }>;
}

/**
 * The phone version of a wide trades table: one card per trade with the result on top and the details in a two-column grid.
 * Shown below 640px; the table itself takes over from there (`hidden sm:block`).
 */
export function TradeCards({ items, label }: { items: ReadonlyArray<TradeCardData>; label: string }) {
  return (
    <ul aria-label={label} className="space-y-2 sm:hidden">
      {items.map((item) => (
        <li key={item.key} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] font-black text-slate-900">{item.title}</span>
            <span className="shrink-0 font-mono text-[13px] font-black tabular-nums">{item.headline}</span>
          </div>
          <dl className="mt-1.5 space-y-0.5 text-[12px]">
            {item.facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">{fact.label}</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-800">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
