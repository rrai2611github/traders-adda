"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { journalStats, realizedR, type JournalEntry } from "@/lib/screen/tradeJournal";
import { StockSymbolButton } from "./StockDetailContext";
import { EmptyState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

const HORIZON_LABEL: Record<JournalEntry["horizon"], string> = { short: "Short", mid: "Mid", long: "Long" };

const todayIso = () => new Date().toISOString().slice(0, 10);

const signedR = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;

function CloseTradeForm({ entry, onClose }: { entry: JournalEntry; onClose: (exitPrice: number, exitDate: string) => void }) {
  const [price, setPrice] = useState(String(entry.entryPrice));
  const [date, setDate] = useState(todayIso());
  const valid = Number(price) > 0;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Exit price</span>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Exit date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs" />
      </label>
      <button
        type="button"
        disabled={!valid}
        onClick={() => onClose(Number(price), date)}
        className="rounded-lg bg-[#16894f] px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Confirm close
      </button>
    </div>
  );
}

export function TradeJournal({
  entries,
  onClose,
  onReopen,
  onRemove,
}: {
  entries: JournalEntry[];
  onClose: (id: string, exitPrice: number, exitDate: string) => void;
  onReopen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const stats = journalStats(entries);
  const open = entries.filter((e) => e.status === "open");
  const closed = entries.filter((e) => e.status === "closed");

  return (
    <WorkspaceFrame id="journal" className="scroll-mt-28">
      <WorkspaceHero
        eyebrow="Your own track record"
        title="Trade Journal"
        icon="journal"
        description="Log what you actually did when you act on a pick, and see your real R multiples next to the backtest — your own record is stronger evidence than a backtest alone."
      />
      <div className="space-y-5 bg-slate-50/60 p-5">
        <div className="grid grid-cols-4 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Stat label="Open positions" value={String(stats.open)} tone="text-slate-900" />
          <Stat label="Closed trades" value={String(stats.closed)} tone="text-slate-900" />
          <Stat label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} tone="text-slate-900" />
          <Stat
            label="Avg R (closed)"
            value={stats.avgR != null ? signedR(stats.avgR) : "—"}
            tone={stats.avgR == null ? "text-slate-900" : stats.avgR > 0 ? "text-emerald-700" : stats.avgR < 0 ? "text-rose-700" : "text-slate-900"}
          />
        </div>

        {entries.length === 0 ? (
          <EmptyState tone="search" title="No trades logged yet">
            Open a stock from any scanner or Today&rsquo;s Picks and use &ldquo;Log trade&rdquo; on its Buy Plan to start.
          </EmptyState>
        ) : (
          <>
            {open.length > 0 && (
              <Section title="Open" count={open.length}>
                {open.map((entry) => (
                  <Row key={entry.id} entry={entry}>
                    {closingId === entry.id ? (
                      <CloseTradeForm
                        entry={entry}
                        onClose={(exitPrice, exitDate) => {
                          onClose(entry.id, exitPrice, exitDate);
                          setClosingId(null);
                        }}
                      />
                    ) : (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setClosingId(entry.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">
                          Close trade
                        </button>
                        <button type="button" onClick={() => onRemove(entry.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:border-rose-200">
                          Delete
                        </button>
                      </div>
                    )}
                  </Row>
                ))}
              </Section>
            )}
            {closed.length > 0 && (
              <Section title="Closed" count={closed.length}>
                {closed.map((entry) => {
                  const r = realizedR(entry);
                  return (
                    <Row key={entry.id} entry={entry} r={r}>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => onReopen(entry.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">
                          Reopen
                        </button>
                        <button type="button" onClick={() => onRemove(entry.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:border-rose-200">
                          Delete
                        </button>
                      </div>
                    </Row>
                  );
                })}
              </Section>
            )}
          </>
        )}
      </div>
    </WorkspaceFrame>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
        <span className="font-mono text-xs font-black text-slate-400">{count}</span>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function Row({ entry, r, children }: { entry: JournalEntry; r?: number | null; children: React.ReactNode }) {
  const capital = entry.entryPrice * entry.quantity;
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
      <div className="min-w-[140px]">
        <StockSymbolButton symbol={entry.symbol} className="font-black text-slate-900">{entry.symbol}</StockSymbolButton>
        <div className="text-[11px] text-slate-400">{HORIZON_LABEL[entry.horizon]} term · {entry.source}</div>
      </div>
      <Cell label="Entry" value={`₹${formatPrice(entry.entryPrice)}`} sub={entry.entryDate} />
      <Cell label="Stop" value={`₹${formatPrice(entry.stop)}`} tone="text-rose-700" />
      <Cell label="Qty" value={String(entry.quantity)} sub={`₹${formatPrice(capital)}`} />
      {entry.status === "closed" && entry.exitPrice != null && (
        <Cell label="Exit" value={`₹${formatPrice(entry.exitPrice)}`} sub={entry.exitDate} />
      )}
      {r != null && (
        <Cell label="Result" value={signedR(r)} tone={r > 0 ? "text-emerald-700" : r < 0 ? "text-rose-700" : "text-slate-700"} />
      )}
      <div className="ml-auto">{children}</div>
    </div>
  );
}

function Cell({ label, value, sub, tone = "text-slate-900" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-[80px]">
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className={`font-mono text-sm font-black tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
