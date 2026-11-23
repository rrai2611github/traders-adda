"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LivePrice } from "./LivePrice";
import { AppShell } from "./AppShell";
import { showToast } from "@/lib/toast";
import { Stat, money, num } from "./BacktestPage";
import { StockSymbolButton } from "./StockDetailContext";
import { useAccountSize } from "@/hooks/useAccountSize";
import { DEFAULT_STOP_PERCENT, EXIT_LABEL, NEEDS_ACTION, SECTOR_LIMIT, fillSlippagePercent, ruleStop, suggestedShares, type ExitReason, type Holding, type Status } from "@/lib/positions/positions";
import type { PositionsView } from "@/lib/positions/positionsServer";
import { Term } from "./Term";
import { OrdersPanel } from "./OrdersPanel";
import { TrackerPage } from "./TrackerPage";
import { EmailActivityPanel } from "./EmailActivityPanel";
import { authClient } from "@/lib/auth-client";

const px = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const signedR = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}R`;
const tone = (v: number) => (v >= 0 ? "text-emerald-700" : "text-rose-700");
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const todayIst = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

const STATUS: Record<Status, { label: string; chip: string; card: string }> = {
  "stop-hit": { label: "Stop hit: sell", chip: "bg-rose-600 text-white", card: "border-rose-300 bg-rose-50/60" },
  "exit-signal": { label: "Exit signal: sell", chip: "bg-rose-600 text-white", card: "border-rose-300 bg-rose-50/60" },
  "close-to-stop": { label: "Near stop", chip: "bg-amber-100 text-amber-800", card: "border-amber-200 bg-amber-50/50" },
  hold: { label: "Hold", chip: "bg-emerald-600 text-white", card: "border-border bg-surface" },
  "no-data": { label: "No data", chip: "bg-slate-200 text-slate-700", card: "border-border bg-surface" },
};

const field = "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-semibold text-slate-900";
const label = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500";

async function call(body: Record<string, unknown>): Promise<{ view?: PositionsView; error?: string; warning?: string }> {
  try {
    const res = await fetch("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    return res.ok ? { view: json.view as PositionsView | undefined, warning: typeof json.warning === "string" ? json.warning : undefined } : { error: String(json?.error ?? "That did not work.") };
  } catch {
    return { error: "Could not reach the server." };
  }
}

/**
 * Turns the private "tomorrow's plan" email on or off. On means the account size is saved on this computer (the email needs it to size the
 * orders); the email goes only to the owner, only after the close, only on days the market check passes and something fits.
 */
function PlanEmailSwitch({ accountSize }: { accountSize: number }) {
  const [saved, setSaved] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/account", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { accountSize: number | null } | null) => { if (alive) setSaved(body ? body.accountSize : null); })
      .catch(() => { if (alive) setSaved(null); });
    return () => { alive = false; };
  }, []);

  // While the email is on, a changed account size is saved too, so the orders are always sized to the number you see.
  useEffect(() => {
    if (saved == null || saved === Math.round(accountSize)) return;
    let alive = true;
    fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountSize }) })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { accountSize: number | null } | null) => { if (alive && body?.accountSize) setSaved(body.accountSize); })
      .catch(() => { /* the saved value stays as it was */ });
    return () => { alive = false; };
  }, [accountSize, saved]);

  const turnOn = async () => {
    setError("");
    try {
      const res = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountSize }) });
      const body = await res.json();
      if (res.ok) setSaved(body.accountSize); else setError(String(body?.error ?? "That did not work."));
    } catch { setError("Could not reach the server."); }
  };
  const turnOff = async () => {
    setError("");
    try { await fetch("/api/account", { method: "DELETE" }); setSaved(null); } catch { setError("Could not reach the server."); }
  };

  if (saved === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-700" aria-label="Tomorrow's plan email">
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${saved != null ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>Plan email {saved != null ? "on" : "off"}</span>
      <span className="min-w-[220px] flex-1">
        {saved != null
          ? `After the close, on days the market check passes and something fits your account (₹${saved.toLocaleString("en-IN")}), you get a private email with exact orders for the next open: shares, price, stop. Only to you.`
          : `Turn it on and, after the close on days the market check passes and something fits, you get a private email with exact orders for the next open, sized to the account above (₹${Math.round(accountSize).toLocaleString("en-IN")}). Only to you; nothing is sent until you turn it on.`}
      </span>
      <button type="button" onClick={() => void (saved != null ? turnOff() : turnOn())} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-[11.5px] font-bold text-slate-800 hover:bg-slate-100">{saved != null ? "Turn off" : "Turn on"}</button>
      {error && <span role="alert" className="w-full font-semibold text-rose-700">{error}</span>}
    </div>
  );
}

/** What a pick passes along when you tap "Add to My positions": its symbol, the planned buy price and the planned stop. */
interface Prefill { symbol: string; buy: number | null; stop: number | null; source: string | null }

function AddForm({ prefill, onDone, onError, isAdmin }: { prefill: Prefill | null; onDone: (view: PositionsView) => void; onError: (message: string) => void; isAdmin: boolean }) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? "");
  const [qty, setQty] = useState("");
  const [qtyTyped, setQtyTyped] = useState(false);
  const [price, setPrice] = useState(prefill?.buy != null ? String(prefill.buy) : "");
  const [date, setDate] = useState(todayIst());
  const [stop, setStop] = useState(prefill?.stop != null ? String(prefill.stop) : "");
  const [source, setSource] = useState(prefill?.source ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { accountSize: capital, setAccountSize: setCapital } = useAccountSize();
  // The account box keeps what is being typed and saves it when you leave the box, so it can be cleared and retyped.
  const [accountDraft, setAccountDraft] = useState<string | null>(null);
  const planned = prefill?.buy ?? null;
  const priceNum = Number(price);
  const ruleDefault = priceNum > 0 ? ruleStop(priceNum) : null;
  // The number of shares is worked out from the planned price when there is one, so correcting the price you paid never changes it behind your back.
  const basis = planned != null && planned > 0 ? planned : priceNum;
  const stopNum = stop === "" ? (basis > 0 ? ruleStop(basis) : 0) : Number(stop);
  const suggestion = basis > 0 ? suggestedShares({ capital, buy: basis, stop: stopNum }) : null;
  // Until the user types a number of shares, the rules' own number is used.
  const shares = qtyTyped ? qty : suggestion && suggestion.qty > 0 ? String(suggestion.qty) : "";
  const slip = planned != null && planned > 0 && priceNum > 0 ? ((priceNum - planned) / planned) * 100 : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await call({ action: "add", symbol, qty: Number(shares), buyPrice: priceNum, buyDate: date, stop: stop === "" ? undefined : Number(stop), plannedPrice: planned ?? undefined, source, note });
    setBusy(false);
    if (result.error || !result.view) { onError(result.error ?? "That did not work."); return; }
    onError(result.warning ?? "");
    showToast("Position added");
    onDone(result.view);
    setSymbol(""); setQty(""); setQtyTyped(false); setPrice(""); setStop(""); setSource(""); setNote("");
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Add a position">
      <h2 className="text-[13px] font-extrabold text-slate-900">I bought a stock</h2>
      {prefill && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-900">Filled in from the pick{planned != null ? `: planned buy ₹${px(planned)}` : ""}. Change the price to what you actually paid.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>Symbol<input className={`${field} w-32 uppercase`} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="KPITTECH" required /></label>
        <label className={label}>Price paid ₹<input className={`${field} w-28`} type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
        <label className={label}>Stop ₹ (optional)<input className={`${field} w-28`} type="number" min={0} step="any" value={stop} onChange={(e) => setStop(e.target.value)} placeholder={ruleDefault != null ? String(ruleDefault) : `${DEFAULT_STOP_PERCENT}% below`} /></label>
        <label className={label}>Shares<input className={`${field} w-24`} type="number" min={1} step={1} value={shares} onChange={(e) => { setQty(e.target.value); setQtyTyped(true); }} required /></label>
        <label className={label}>Bought on<input className={`${field} w-40`} type="date" max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className={`${label} min-w-[190px] flex-1`}>Algo / screener (optional)<input className={`${field} w-full`} value={source} maxLength={80} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Blue sky, RSI Edge" /></label>
        <label className={`${label} min-w-[180px] flex-1`}>Note (optional)<input className={`${field} w-full`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Why you bought" /></label>
        <button type="submit" disabled={busy} className="btn-gold h-9 rounded-lg px-4 text-[13px] font-extrabold">{busy ? "Saving…" : "Add position"}</button>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-[11.5px] text-slate-600">
        <label className={label}>My account ₹<input className={`${field} w-32`} type="number" min={10000} step={10000} value={accountDraft ?? String(capital)} onChange={(e) => setAccountDraft(e.target.value)} onBlur={() => { if (accountDraft != null) setCapital(Number(accountDraft)); setAccountDraft(null); }} /></label>
        <p className="min-w-[220px] flex-1 leading-5">
          {suggestion && suggestion.qty > 0
            ? <>The rules would buy <b>{suggestion.qty.toLocaleString("en-IN")} shares</b>{planned != null ? " at the planned price" : ""} (₹{suggestion.invested.toLocaleString("en-IN")}), about ₹{suggestion.atRisk.toLocaleString("en-IN")} lost if the stop is hit ({suggestion.limitedBy === "size" ? "limited by the 20% size cap" : "2% of your account at risk"}).</>
            : basis > 0 ? "At this price and stop the rules would not buy even one share for this account size." : "Enter the price to see how many shares the rules would buy."}
          {slip != null && Math.abs(slip) >= 0.05 ? <> You are paying <b>{slip >= 0 ? "+" : "−"}{Math.abs(slip).toFixed(2)}%</b> {slip >= 0 ? "above" : "below"} the planned price.</> : null}
        </p>
      </div>
      {isAdmin && <PlanEmailSwitch accountSize={capital} />}
      <p className="text-[11.5px] text-slate-500">Leave the stop empty to use the rules&apos; {DEFAULT_STOP_PERCENT}% under your price{ruleDefault != null ? ` (₹${px(ruleDefault)})` : ""}. The app only records what you did; it never places an order.</p>
    </form>
  );
}

function SellForm({ holding, status, onDone, onError, onCancel }: { holding: Holding; status: Status; onDone: (view: PositionsView) => void; onError: (message: string) => void; onCancel: () => void }) {
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIst());
  const [reason, setReason] = useState<ExitReason>(status === "stop-hit" ? "stop" : status === "exit-signal" ? "fifty-day" : "own-call");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await call({ action: "sell", id: holding.id, price: Number(price), date, reason });
    setBusy(false);
    if (result.error || !result.view) { onError(result.error ?? "That did not work."); return; }
    onError(result.warning ?? "");
    showToast("Marked as sold");
    onDone(result.view);
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3" aria-label={`Mark ${holding.symbol} sold`}>
      <label className={label}>Sold at ₹<input className={`${field} w-28`} type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} required autoFocus /></label>
      <label className={label}>Sold on<input className={`${field} w-40`} type="date" min={holding.buyDate} max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      <label className={label}>Why
        <select className={`${field} w-56`} value={reason} onChange={(e) => setReason(e.target.value as ExitReason)}>
          {(Object.keys(EXIT_LABEL) as ExitReason[]).map((r) => <option key={r} value={r}>{EXIT_LABEL[r]}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy} className="h-9 rounded-lg bg-slate-900 px-4 text-[13px] font-extrabold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? "Saving…" : "Save sale"}</button>
      <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-slate-200 px-3 text-[12px] font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
    </form>
  );
}

/** The user's real positions against the exit rules, and a journal of what they did. The app records and warns; it never trades. */
export function PositionsPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const [view, setView] = useState<PositionsView | null>(null);
  const [message, setMessage] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selling, setSelling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  useEffect(() => {
    const revealSection = () => {
      const id = window.location.hash.slice(1);
      const section = Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-portfolio-section]"))
        .find((element) => element.dataset.portfolioSection === id);
      if (section) section.open = true;
      const target = document.getElementById(id) ?? section;
      if (!target) return;
      let ancestor: HTMLElement | null = target;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      target.scrollIntoView({ block: "start" });
    };
    const timer = setTimeout(revealSection, 0);
    window.addEventListener("hashchange", revealSection);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", revealSection); };
  }, []);
  // "Add to My positions" on a pick opens this page with the symbol, planned buy price and planned stop in the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const symbol = (q.get("symbol") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return;
    const num = (key: string) => { const v = Number(q.get(key)); return Number.isFinite(v) && v > 0 ? v : null; };
    const rawSource = q.get("source");
    const id = setTimeout(() => setPrefill({ symbol, buy: num("buy"), stop: (() => { const v = num("stop"); return v == null ? null : Math.floor(v * 20) / 20; })(), source: rawSource?.slice(0, 80) ?? null }), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/positions", { cache: "no-store" });
        if (!res.ok) throw new Error(`Position refresh failed (${res.status}).`);
        const next = (await res.json()) as PositionsView;
        if (alive) {
          setView(next);
          setRefreshError("");
          setLastUpdated(Date.now());
        }
      } catch {
        if (alive) setRefreshError("Could not refresh position checks. Showing the last loaded data; try again shortly.");
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [refreshKey]);

  const accept = (next: PositionsView) => { setView(next); setSelling(null); setRemoving(null); setEditingSource(null); };
  const remove = async (id: string) => {
    const result = await call({ action: "remove", id });
    if (result.view) { setMessage(result.warning ?? ""); showToast("Position removed"); accept(result.view); } else setMessage(result.error ?? "That did not work.");
  };
  const saveSource = async (id: string) => {
    setSourceBusy(true);
    const result = await call({ action: "source", id, source: sourceDraft });
    setSourceBusy(false);
    if (result.error || !result.view) { setMessage(result.error ?? "Could not save the strategy or screener."); return; }
    setMessage(result.warning ?? "");
    showToast("Trade source updated");
    accept(result.view);
  };

  const open = view?.open ?? [];
  const due = open.filter((i) => NEEDS_ACTION.has(i.assessment.status));
  const j = view?.journal;
  const marketValue = view?.exposure.invested ?? 0;
  const openPnl = view?.exposure.openPnl ?? 0;
  const latestUpdate = lastUpdated == null ? "Waiting for first update" : `Updated ${new Date(lastUpdated).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <AppShell current="positions">
    <div className="mx-auto w-full min-w-0 max-w-[1320px] space-y-4 px-4 py-5 lg:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Trading workspace</p>
          <h1 className="mt-0.5 text-[25px] font-extrabold tracking-[-0.04em] text-slate-900">Portfolio</h1>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">Your private trade journal and strategy practice portfolio.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800" role="status"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{latestUpdate} · checks every 30s</span>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:border-emerald-500 hover:text-emerald-700">Refresh</button>
          <a href="/api/positions/export" download title="Every position, open and closed, as a spreadsheet file." className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:border-emerald-500 hover:text-emerald-700">Export</a>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl bg-[#0b1a34] text-white shadow-lg" aria-label="Portfolio overview">
        <div className="flex flex-wrap items-end justify-between gap-5 bg-[radial-gradient(ellipse_at_top_right,rgba(49,92,151,0.42),transparent_58%)] px-5 py-5 sm:px-7 sm:py-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">Portfolio value · last close</p>
            <p className="mt-1 font-mono text-[32px] font-bold tracking-[-0.04em] sm:text-[38px]">{view ? money(marketValue) : "—"}</p>
            <p className="mt-1 text-[11px] text-slate-300">{view?.lastDay ? `Price history through ${dayLabel(view.lastDay)}` : "Waiting for portfolio data"}</p>
          </div>
          <div className="min-w-[155px] rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">Open P/L · last close</p>
            <p className={`mt-1 font-mono text-[20px] font-bold ${openPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{view ? signedMoney(openPnl) : "—"}</p>
            <p className="text-[10px] text-slate-400">Unrealized · before costs</p>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 sm:grid-cols-4">
          <div className="px-5 py-3 sm:px-7"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Cost invested</p><p className="mt-1 font-mono text-[14px] font-bold">{view ? money(view.exposure.costBasis) : "—"}</p></div>
          <div className="px-5 py-3 sm:px-7"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Open positions</p><p className="mt-1 font-mono text-[14px] font-bold">{view ? `${open.length}` : "—"}</p></div>
          <div className="border-t border-white/10 px-5 py-3 sm:border-t-0 sm:px-7"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Needs attention</p><p className={`mt-1 font-mono text-[14px] font-bold ${due.length ? "text-amber-300" : "text-emerald-300"}`}>{view ? due.length : "—"}</p></div>
          <div className="border-t border-white/10 px-5 py-3 sm:border-t-0 sm:px-7"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">At risk if stops hit</p><p className="mt-1 font-mono text-[14px] font-bold text-rose-300">{view ? signedMoney(view.exposure.ifAllStopsHit) : "—"}</p></div>
        </div>
      </section>

      {message && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{message}</p>}
      {refreshError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">{refreshError}</p>}

      {due.length > 0 && (
        <section className="rounded-2xl border border-rose-300 bg-rose-50 p-4" aria-label="Needs a decision">
          <h2 className="text-[13px] font-extrabold text-rose-900">{due.length} position{due.length === 1 ? "" : "s"} need{due.length === 1 ? "s" : ""} a decision</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-rose-900">
            {due.map((i) => <li key={i.holding.id}><b>{i.holding.symbol}</b>: {i.assessment.headline} {i.assessment.action}</li>)}
          </ul>
        </section>
      )}

      {(view?.crowded ?? []).length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-label="Sector concentration">
          <h2 className="text-[13px] font-extrabold text-amber-900">Too many positions in one sector</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-amber-900">
            {view!.crowded.map((c) => <li key={c.sector}><b>{c.count} of your {open.length} open positions are in {c.sector}</b> ({c.symbols.join(", ")}). One bad turn in that sector hits them all at once.</li>)}
          </ul>
          <p className="mt-1 text-[11.5px] text-amber-800">The tested limit is {SECTOR_LIMIT} per sector. In the 10-year test it never hurt either half and trimmed the worst drop a little, so avoid adding more there. Nothing is blocked: it is your call.</p>
        </section>
      )}

      <section id="my-positions" aria-labelledby="my-positions-title" className="scroll-mt-20 space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Real portfolio</p>
          <h2 id="my-positions-title" className="mt-0.5 text-[18px] font-extrabold tracking-[-0.03em] text-slate-900">Open positions <span className="ml-1 text-[13px] font-semibold text-slate-400">{view ? open.length : "…"}</span></h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Manually recorded holdings · not synced from your broker</p>
        </div>
      </header>
      <details id="add-position" open={!!prefill} className="group overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-lg font-medium leading-none text-white">+</span>
          <span className="text-[12px] font-extrabold text-slate-900">Add a position</span>
          <span className="hidden text-[11px] text-slate-500 sm:inline">Record the actual fill after your broker confirms it</span>
          <span className="ml-auto text-[11px] font-bold text-emerald-700 group-open:hidden">Open form</span>
          <span className="ml-auto hidden text-[11px] font-bold text-slate-500 group-open:inline">Close form</span>
        </summary>
        <div className="border-t border-border p-3 sm:p-4">
          <AddForm key={prefill ? `from-${prefill.symbol}` : "blank"} prefill={prefill} onDone={accept} onError={setMessage} isAdmin={isAdmin} />
        </div>
      </details>

      <section className="space-y-3" aria-label="Open positions">
        <h2 className="text-[13px] font-extrabold text-slate-900">Open positions</h2>
        {!view ? (
          <div role="status" aria-label="Loading your positions" className="skeleton-card space-y-3"><span className="skeleton-line w-1/3" /><span className="skeleton-line" /><span className="skeleton-line w-2/3" /></div>
        ) : open.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-slate-500">No open positions. When you buy a stock, add it above and the app will watch it for you.</p>
        ) : (
          <ul className="grid gap-2">
            {open.map(({ holding: h, assessment: a, sector }) => (
              <li key={h.id} className={`min-w-0 rounded-xl border px-3 py-2.5 ${STATUS[a.status].card}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <StockSymbolButton symbol={h.symbol} className="text-sm font-black text-slate-900">{h.symbol}</StockSymbolButton>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${STATUS[a.status].chip}`}>{STATUS[a.status].label}</span>
                      {sector && <span className="text-[11px] text-slate-500">{sector}</span>}
                    </div>
                    <p className="text-[11px] text-slate-500">{h.qty.toLocaleString("en-IN")} shares × ₹{px(h.buyPrice)} · bought {dayLabel(h.buyDate)} · {a.daysHeld} day{a.daysHeld === 1 ? "" : "s"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Cost invested</div>
                    <div className="font-mono text-[13px] font-black text-slate-900">{money(h.qty * h.buyPrice)}</div>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-slate-600">
                  <span className="font-bold text-slate-500">Algo / screener:</span>
                  <span>{h.source ?? "Not recorded"}</span>
                  {editingSource === h.id ? null : <button type="button" onClick={() => { setEditingSource(h.id); setSourceDraft(h.source ?? ""); setSelling(null); setRemoving(null); }} className="ml-1 font-bold text-emerald-700 hover:underline">Edit</button>}
                </div>
                {editingSource === h.id && (
                  <form onSubmit={(event) => { event.preventDefault(); void saveSource(h.id); }} className="mt-2 flex flex-wrap items-end gap-2" aria-label={`Edit ${h.symbol} strategy or screener`}>
                    <label className={`${label} min-w-[200px] flex-1`}>Algo / screener<input className={`${field} w-full`} value={sourceDraft} maxLength={80} onChange={(event) => setSourceDraft(event.target.value)} placeholder="e.g. Blue sky, RSI Edge" /></label>
                    <button type="submit" disabled={sourceBusy} className="h-9 rounded-lg bg-emerald-700 px-3 text-[11px] font-bold text-white disabled:opacity-50">{sourceBusy ? "Saving…" : "Save source"}</button>
                    <button type="button" onClick={() => setEditingSource(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-bold text-slate-600">Cancel</button>
                  </form>
                )}
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                  <div className="text-[11px]"><span className="text-slate-400">Price now </span><b className="text-slate-800"><LivePrice symbol={h.symbol} fallbackPrice={a.last ?? h.buyPrice} fallbackChange={null} /></b></div>
                  <div className="text-[11px]"><span className="text-slate-400">P/L at close </span><b className={a.pnl != null ? tone(a.pnl) : ""}>{a.pnl != null ? `${signedMoney(a.pnl)}${a.pnlPercent != null ? ` (${a.pnlPercent >= 0 ? "+" : "−"}${Math.abs(a.pnlPercent).toFixed(1)}%)` : ""}` : "—"}</b></div>
                  <div className="text-[11px]"><span className="text-rose-700">Stop </span><b className="font-mono text-slate-800">₹{px(h.stop)}</b></div>
                  <div className="text-[11px]"><span className="text-slate-400"><Term k="exit50">50-day avg</Term> </span><b className="font-mono text-slate-800">{a.sma50 != null ? `₹${px(a.sma50)}` : "—"}</b></div>
                </div>
                <details className="mt-1.5 text-[11px] text-slate-600">
                  <summary className="cursor-pointer font-bold text-slate-700">Exit check &amp; trade details</summary>
                  <p className="mt-1 font-semibold text-slate-800">{a.headline}</p>
                  <p>{a.action}</p>
                  {a.rNow != null && <p>Current result: {signedR(a.rNow)} · last candle {a.lastDate ? dayLabel(a.lastDate) : "—"}.</p>}
                  {h.plannedPrice != null && fillSlippagePercent(h) != null && <p>Planned ₹{px(h.plannedPrice)} · paid <b className={fillSlippagePercent(h)! > 0.05 ? "text-amber-700" : "text-slate-700"}>{fillSlippagePercent(h)! >= 0 ? "+" : "−"}{Math.abs(fillSlippagePercent(h)!).toFixed(2)}%</b> {fillSlippagePercent(h)! >= 0 ? "above" : "below"} the plan.</p>}
                  {h.note && <p className="italic">Note: “{h.note}”</p>}
                </details>
                {selling === h.id ? (
                  <SellForm holding={h} status={a.status} onDone={accept} onError={setMessage} onCancel={() => setSelling(null)} />
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => { setSelling(h.id); setRemoving(null); setEditingSource(null); }} className={`rounded-lg px-3 py-1 text-[11px] font-extrabold ${NEEDS_ACTION.has(a.status) ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>I sold it</button>
                    {removing === h.id ? (
                      <>
                        <span className="text-[11.5px] text-slate-600">Delete this entry (a typo, not a sale)?</span>
                        <button type="button" onClick={() => void remove(h.id)} className="rounded-lg border border-rose-300 px-2.5 py-1 text-[11.5px] font-bold text-rose-700 hover:bg-rose-50">Yes, delete</button>
                        <button type="button" onClick={() => setRemoving(null)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-bold text-slate-600 hover:bg-slate-50">Keep</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setRemoving(h.id); setSelling(null); }} className="text-[11.5px] font-bold text-slate-400 hover:text-rose-700">Entered by mistake</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {view && view.fills.count > 0 && view.fills.avgPercent != null && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-700">
            <b>Your fills:</b> {view.fills.count} position{view.fills.count === 1 ? "" : "s"} had a planned price. On average you paid <b>{view.fills.avgPercent >= 0 ? "+" : "−"}{Math.abs(view.fills.avgPercent).toFixed(2)}%</b> {view.fills.avgPercent >= 0 ? "above" : "below"} the plan. The reality check on the Backtest page assumed every fill 1% worse; {view.fills.avgPercent <= 1 ? "you are doing at least that well." : "you are doing worse than that, so use limit orders near the open."}{view.fills.count < 5 ? " (Few positions so far: treat it as a first look.)" : ""}
          </p>
        )}
        <p className="text-[11px] text-slate-500">The rules sell on only two things: the price touching your stop, or a close under the 50-day average (sell at the next open). The stop and the 50-day check use finished daily prices{view?.lastDay ? `, up to ${dayLabel(view.lastDay)}` : ""}, refreshed after about 4:30 pm IST. A stop can be hit during the day, so also set it with your broker. {isAdmin ? "Admin position alerts are emailed after the refresh." : "These records are private to your account and are checked while you use the app."}</p>
      </section>

      <details className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Journal">
        <summary className="cursor-pointer text-[13px] font-extrabold text-slate-900">Real-trade journal · closed trades</summary>
        {!j || j.count === 0 ? (
          <p className="text-[12.5px] text-slate-600">{j?.lines[0] ?? "Loading…"}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Closed trades" value={String(j.count)} />
              <Stat label={<Term k="winRate">Won</Term>} value={j.winRate != null ? `${j.winRate.toFixed(0)}%` : "—"} note={`${j.wins} of ${j.count} (the test won about 45%)`} />
              <Stat label={<Term k="r">Average trade</Term>} value={j.avgR != null ? signedR(j.avgR) : "—"} tone={j.avgR != null && j.avgR >= 0 ? "good" : "bad"} note="in R: 1R = the money risked" />
              <Stat label="Total profit / loss" value={signedMoney(j.totalPnl)} tone={j.totalPnl >= 0 ? "good" : "bad"} note="before brokerage and tax" />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">{j.lines.map((line) => <li key={line}>{line}</li>)}</ul>
            {j.byReason.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[12px]">
                  <thead><tr className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-500"><th className="py-1 pr-3">How you sold</th><th className="py-1 pr-3">Trades</th><th className="py-1">Average</th></tr></thead>
                  <tbody>{j.byReason.map((g) => <tr key={g.reason} className="border-t border-border"><td className="py-1.5 pr-3 font-semibold text-slate-800">{g.label}</td><td className="py-1.5 pr-3">{g.n}</td><td className={`py-1.5 font-mono font-bold ${tone(g.avgR)}`}>{signedR(g.avgR)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="overflow-x-auto">
              <p className="mb-1 text-[11px] text-slate-500">Prices in rupees (₹). R is the profit as a multiple of the amount risked on the trade.</p>
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead><tr className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-500"><th className="py-1 pr-3">Stock</th><th className="py-1 pr-3">Algo / screener</th><th className="py-1 pr-3">Bought</th><th className="py-1 pr-3">Sold</th><th className="py-1 pr-3">Why</th><th className="py-1 pr-3">Result</th><th className="py-1">R</th></tr></thead>
                <tbody>
                  {view!.closed.map((t) => (
                    <tr key={t.holding.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-bold text-slate-900">{t.holding.symbol}</td>
                      <td className="py-1.5 pr-3 text-slate-600">{t.holding.source ?? "Not recorded"}</td>
                      <td className="py-1.5 pr-3">₹{px(t.holding.buyPrice)} · {dayLabel(t.holding.buyDate)}</td>
                      <td className="py-1.5 pr-3">₹{px(t.holding.sold!.price)} · {dayLabel(t.holding.sold!.date)}</td>
                      <td className="py-1.5 pr-3">{EXIT_LABEL[t.holding.sold!.reason]}</td>
                      <td className={`py-1.5 pr-3 font-mono font-bold ${tone(t.pnl)}`}>{signedMoney(t.pnl)}</td>
                      <td className={`py-1.5 font-mono font-bold ${tone(t.r)}`}>{num(t.r, 1)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </details>
      </section>

      {isAdmin && <details data-portfolio-section="order-approvals" className="scroll-mt-20 rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-bold text-foreground">Order review · optional broker workflow</summary>
        <div className="mt-4"><OrdersPanel /></div>
      </details>}
      <details data-portfolio-section="strategy-check" className="scroll-mt-20 rounded-xl border border-amber-200 bg-surface p-4">
        <summary className="cursor-pointer text-sm font-bold text-foreground">Practice strategy · paper money, not real holdings</summary>
        <div className="mt-4"><TrackerPage /></div>
      </details>
      {isAdmin && <details data-portfolio-section="email-activity" className="scroll-mt-20 rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-bold text-foreground">Email delivery activity</summary>
        <div className="mt-4"><EmailActivityPanel /></div>
      </details>}
    </div>
    </AppShell>
  );
}
