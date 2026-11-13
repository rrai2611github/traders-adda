"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "./AppShell";
import { WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";
import { APPLICATION_INTENTS, QUESTIONS, type ResearchAnswer } from "@/lib/assistant/research";
import { SymbolSearch } from "./SymbolSearch";

const timestamp = (at: number | null) => at == null ? "Not recorded" : new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
type Turn = { question: string; answer?: ResearchAnswer; error?: string };

export function ResearchAssistant() {
  const params = useSearchParams();
  const [stock, setStock] = useState(params.get("symbol") ?? "");
  const [compare, setCompare] = useState("");
  const [question, setQuestion] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, busy]);

  async function ask(message: string) {
    if (busy) return;
    setBusy(true);
    controller.current = new AbortController();
    const symbols = [stock, compare].map((s) => s.trim().toUpperCase()).filter(Boolean);
    const previousAnswer = turns.at(-1)?.answer;
    const context = previousAnswer?.focus;
    const turn: Turn = { question: message };
    setTurns((previous) => [...previous.slice(-9), turn]);
    setQuestion("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ message, symbols, ...(context ? { context } : {}) }), signal: controller.current.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Research failed (${response.status}).`);
      setTurns((previous) => [...previous.slice(0, -1), { ...turn, answer: body }]);
      setNames((previous) => ({ ...previous, ...Object.fromEntries((body as ResearchAnswer).stocks.map((s) => [s.symbol, s.name])) }));
      const answer: ResearchAnswer = body;
      if (!APPLICATION_INTENTS.includes(answer.focus) && answer.symbols.length) {
        setStock(answer.symbols[0]);
        setCompare(answer.symbols[1] ?? "");
      }
    } catch (error) {
      if (!controller.current.signal.aborted) setTurns((previous) => [...previous.slice(0, -1), { ...turn, error: error instanceof Error ? error.message : "Research unavailable." }]);
    } finally { setBusy(false); }
  }
  return <AppShell current="assistant">
    <div className="mx-auto max-w-[1280px] space-y-4 p-4 lg:p-6">
      <WorkspaceFrame><WorkspaceHero title="Application research chatbot" eyebrow="Ask the application" icon="search"
        description="Ask which stocks to monitor, how the market looks, or why an engine is paused. Answers use approved app data, not external AI or price predictions." /></WorkspaceFrame>
      <div role="log" aria-label="Research conversation" aria-live="polite" aria-busy={busy} className="space-y-5">
        {!turns.length && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600"><b className="text-slate-900">Ask a stock question directly</b><p>Try: &ldquo;Is SBIN bullish or bearish?&rdquo;, &ldquo;Can I buy Infosys?&rdquo;, &ldquo;What are its risks?&rdquo; or &ldquo;Show support and resistance.&rdquo; You can also ask about radar stocks, market breadth, paper results or application status.</p><p>The answer starts with your question&apos;s conclusion and explains the daily-price evidence. Bullish trend and permission to buy are separate. Unsupported data/timeframes are stated, not invented.</p></div>}
        {turns.map((turn, index) => <section key={index} className="space-y-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-emerald-700 p-4 text-white"><p className="mb-1 text-[10px] font-bold uppercase">You</p><h2 className="break-words text-sm font-semibold">{turn.question}</h2></div>
          <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-4"><p className="mb-3 text-xs font-extrabold text-emerald-700">Research chatbot · App data only</p>
          {!turn.answer && !turn.error && <p role="status" className="text-sm text-slate-500">Reading the research snapshot...</p>}
          {turn.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{turn.error}</p>}
          {turn.answer && <>
            <h3 className="text-sm font-bold text-slate-800">{turn.answer.title}</h3>
            <p className="text-sm text-slate-600">{turn.answer.summary}</p>
            <p className="text-xs text-slate-500">Report read: {timestamp(turn.answer.readAt)}. Underlying source times differ.</p>
            {turn.answer.focus === "radar" && turn.answer.sections.slice(0, 2).map((s) => <div key={s.title} className="my-3"><h3 className="text-sm font-bold text-slate-800">{s.title}</h3>{s.lines.map((line) => <p key={line} className="mt-1 text-xs leading-5 text-slate-600">{line}</p>)}</div>)}
            <div className="grid gap-4 lg:grid-cols-2">{turn.answer.stocks.map((s, candidateIndex) => <article key={s.symbol} className="min-w-0 rounded-xl border border-slate-200 p-4">
              <h3 className="font-extrabold text-slate-900">{turn.answer?.focus === "radar" ? `${candidateIndex + 1}. ` : ""}{s.symbol} — {s.name}</h3>
              <p className={`mt-2 inline-block rounded-lg px-3 py-1 text-sm font-extrabold ${s.outlook.label === "Bullish" ? "bg-emerald-50 text-emerald-800" : s.outlook.label === "Bearish" ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{s.outlook.label} · Daily trend</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{s.outlook.explanation}</p>
              <p className="my-2 text-sm font-bold text-emerald-700">{s.status}</p>
              {turn.answer?.focus === "radar" && <p className="text-xs leading-5 text-slate-600">{s.evidence[0]} {s.evidence[3]}</p>}
              <details open={turn.answer?.focus !== "radar"}><summary className="my-2 cursor-pointer text-xs font-bold text-emerald-700">Facts, risks and reference levels</summary>
              <p className="break-words text-xs leading-5 text-slate-500">{s.source} · Session {s.session ?? "unavailable"}<br />Provider/session: {timestamp(s.quoteAt)}<br />Fetched: {timestamp(s.fetchedAt)}</p>
              <dl className="my-3 grid grid-cols-2 gap-3">{s.metrics.map((m) => <div key={m.label} className="min-w-0"><dt className="text-xs text-slate-500">{m.label}</dt><dd className="break-words text-sm font-bold text-slate-900">{m.value}</dd></div>)}</dl>
              {[{ title: "Measured evidence", lines: s.evidence, focus: "setup" }, { title: "Risks / limitations", lines: s.risks, focus: "risks" }, { title: "App reference levels", lines: s.levels, focus: "levels" }, { title: "Missing information", lines: s.missing, focus: "" }].sort((a,b) => Number(b.focus === turn.answer?.focus) - Number(a.focus === turn.answer?.focus)).map(({title, lines}) =>
                <div key={title} className="mt-3"><h4 className="text-xs font-bold text-slate-800">{title}</h4><ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-5 text-slate-600">{lines.map((line) => <li key={line}>{line}</li>)}</ul></div>)}</details>
            </article>)}</div>
            {turn.answer.sections.slice(turn.answer.focus === "radar" ? 2 : 0).map((s) => <div key={s.title} className="my-3"><h3 className="text-sm font-bold text-slate-800">{s.title}</h3>{s.lines.map((line) => <p key={line} className="mt-1 text-xs leading-5 text-slate-600">{line}</p>)}</div>)}
            <div className="flex flex-wrap gap-3">{turn.answer.sources.map((s) => <Link key={s.href} href={s.href} className="text-xs font-bold text-emerald-700 underline">{s.label}</Link>)}</div>
          </>}</div>
        </section>)}
        <div ref={end} />
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (question.trim()) void ask(question.trim()); }} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div><h2 className="text-sm font-bold text-slate-800">Select a stock by name or symbol</h2><p className="mt-1 text-xs text-slate-500">Choose a stock below for your questions. A second stock is optional for comparisons; application-wide questions need no selection.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{[{label: "Stock", value: stock, change: setStock, other: compare}, {label: "Compare with (optional)", value: compare, change: setCompare, other: stock}].map((field) =>
          <div key={field.label} className="min-w-0"><p className="mb-1 text-xs font-bold text-slate-700">{field.label}</p>
            <SymbolSearch equitiesOnly fullWidth disabled={busy} label={`Search ${field.label}`} existing={[field.other].filter(Boolean)} onSelect={field.change} onChoose={(s) => setNames((previous) => ({...previous, [s.symbol]: s.name}))} />
            {field.value && <div className="mt-2 flex items-start justify-between gap-2 rounded-xl bg-emerald-50 p-2 text-xs text-emerald-800"><span className="min-w-0 break-words"><b>{field.value}</b>{names[field.value] ? ` — ${names[field.value]}` : ""}</span><button type="button" disabled={busy} aria-label={`Remove ${field.value}`} onClick={() => field.change("")} className="font-bold">Remove</button></div>}
          </div>)}</div></div>
        <div className="flex flex-wrap gap-2">{QUESTIONS.map((q) => <button type="button" key={q} disabled={busy} onClick={() => void ask(q)} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{q}</button>)}</div>
        <div className="flex items-end gap-2"><textarea aria-label="Message" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy} maxLength={500} rows={2} required placeholder="Is SBIN bullish or bearish? Why?" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (question.trim()) void ask(question.trim()); } }} className="min-w-0 flex-1 resize-y rounded-xl border border-slate-200 p-3 text-sm" /><button disabled={busy || !question.trim()} className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Reading..." : "Send"}</button></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Enter to send · Shift+Enter for a new line. Selected stocks stay for follow-ups. Last 10 replies, page memory only.</p><button type="button" disabled={busy} onClick={() => setTurns([])} className="text-xs font-bold text-slate-500">Clear conversation</button></div>
      </form>
      <Link href="/" className="inline-block text-sm font-bold text-emerald-700">Back to Today</Link>
    </div>
  </AppShell>;
}
