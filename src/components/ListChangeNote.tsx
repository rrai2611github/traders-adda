import type { ListChanges } from "@/lib/listChanges";
import { sinceLabel } from "@/hooks/useListChanges";
import { StockSymbolButton } from "./StockDetailContext";

export function NewTag() {
  return <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 align-middle text-[10.5px] font-black uppercase tracking-wide text-emerald-800" title="Not on this list the last time you looked on an earlier day">New</span>;
}

/** What entered and left a list since the last day this browser saw it. Silent until there is an earlier day to compare with. */
export function ListChangeNote({ changes }: { changes: ListChanges }) {
  if (!changes.hasBaseline) return null;
  const since = sinceLabel(changes.since);
  return (
    <p className="border-b border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] text-slate-600">
      <b className="text-slate-800">Since {since}:</b> {changes.added.size} new
      {changes.dropped.length > 0 ? (
        <> · dropped off: {changes.dropped.map((symbol, i) => (
          <span key={symbol}>{i > 0 && ", "}<StockSymbolButton symbol={symbol} className="font-bold">{symbol}</StockSymbolButton></span>
        ))}</>
      ) : " · none dropped"}
      . <span className="text-slate-400">Compared with the last day you opened this page on this browser.</span>
    </p>
  );
}
