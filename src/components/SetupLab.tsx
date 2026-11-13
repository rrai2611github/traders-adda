"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LAB_FEATURES, LAB_HORIZONS, LAB_RULES, labSentence, type FeatureKey, type LabFilters, type LabHorizon, type LabResult, type LabStats } from "@/lib/screen/setupLab";
import type { DataHealth } from "@/lib/market/historyQuality";
import { formatPrice } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { DataQualityNotice } from "./DataQualityNotice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

interface Payload extends LabResult, DataHealth {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  stocks: number;
  matchingNow: { total: number; rows: { symbol: string; name: string; close: number; rank: number }[] };
}

const GROUPS = ["Trend", "Strength", "Setup", "Context"] as const;
const PRESETS: { label: string; filters: LabFilters }[] = [
  { label: "Stage 2 · top RS · at the high", filters: { stage2: [1], rs: [4], fromHigh: [0] } },
  { label: "Stage 2 base breakout", filters: { stage2: [1], base: [3] } },
  { label: "Stage 2 · forming within 5% · surging volume", filters: { stage2: [1], base: [2], volume: [2, 3] } },
  { label: "Control: not Stage 2, 50%+ below the high", filters: { stage2: [0], fromHigh: [4] } },
];
const signed = (v: number | null, d = 1, unit = "") => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}${unit}`);
const toParams = (filters: LabFilters, horizon: LabHorizon) => {
  const p = new URLSearchParams({ h: String(horizon) });
  for (const [key, levels] of Object.entries(filters)) if (levels?.length) p.set(key, [...levels].sort().join(","));
  return p.toString();
};

export function SetupLab() {
  const [filters, setFilters] = useState<LabFilters>({});
  const [horizon, setHorizon] = useState<LabHorizon>(20);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useMemo(() => toParams(filters, horizon), [filters, horizon]);
  const latest = useRef(query);

  useEffect(() => {
    latest.current = query;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = async () => {
      setBusy(true);
      try {
        const response = await fetch(`/api/market/setup-lab?${query}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) { if (alive) { setProgress(body.error ?? "Building the Lab."); setError(null); } timer = setTimeout(load, 3000); return; }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`Setup Lab request failed (HTTP ${response.status}).`);
        const payload: Payload = await response.json();
        if (alive && latest.current === query) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[setup-lab] Request failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Request failed."); setProgress(null); }
      } finally {
        if (alive && !controller.signal.aborted) setBusy(false);
      }
    };
    // A short pause so clicking several chips in a row sends one request, not one per click.
    timer = setTimeout(load, 200);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [query]);

  const active = (Object.keys(filters) as FeatureKey[]).filter((k) => filters[k]?.length);
  const toggle = (key: FeatureKey, level: number) => setFilters((current) => {
    const levels = current[key] ?? [];
    const next = levels.includes(level) ? levels.filter((l) => l !== level) : [...levels, level];
    const copy = { ...current };
    if (next.length) copy[key] = next; else delete copy[key];
    return copy;
  });

  return (
    <WorkspaceFrame id="setup-lab" className="scroll-mt-28">
      <WorkspaceHero eyebrow="Research" icon="setups" title="Setup Lab"
        description="Build a setup from trend, strength, base and market conditions, then see what actually happened next to every past stock-day that met it, recomputed from the price history each time you change a filter." />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Showing the previous result." : ""}</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <summary className="cursor-pointer font-bold">Read this before trusting a result</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>These are today&apos;s listed liquid stocks only, so stocks that fell and were delisted are missing (survivorship bias flatters every setup).</li>
            <li>The history is about four years, mostly one market regime. The monthly and regime panels below show how much a result leans on a stretch of time.</li>
            <li>Consecutive days of one stock are not independent, so the effective sample is smaller than the count shown.</li>
            <li>Returns are measured from the signal day&apos;s close, with no costs, not from a realistic next-open entry.</li>
            <li>A &quot;win&quot; means beating the median stock over the same days, so about half of all stock-days win by construction. Trying many filter combinations will find some that look good by chance.</li>
            <li>Nothing here is a recommendation. A past pattern does not establish that a condition predicts returns.</li>
          </ul>
        </details>

        <div className="space-y-3 rounded-xl border border-border bg-raised p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-foreground">Look ahead</span>
            {LAB_HORIZONS.map((h) => (
              <button key={h} type="button" aria-pressed={horizon === h} onClick={() => setHorizon(h)}
                className={`rounded-full border px-3 py-1 ${horizon === h ? "border-emerald-600 bg-emerald-50 font-bold text-emerald-800" : "border-border bg-white text-muted hover:border-emerald-300"}`}>{h} sessions</button>
            ))}
            <span className="ml-3 font-bold text-foreground">Examples</span>
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" onClick={() => setFilters(preset.filters)} className="rounded-full border border-border bg-white px-3 py-1 text-muted hover:border-emerald-300">{preset.label}</button>
            ))}
            {active.length > 0 && <button type="button" onClick={() => setFilters({})} className="ml-auto font-bold text-accent underline">Reset all</button>}
          </div>
          {GROUPS.map((group) => (
            <fieldset key={group} className="border-t border-border pt-3">
              <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted">{group}</legend>
              <div className="space-y-2">
                {LAB_FEATURES.filter((f) => f.group === group).map((feature) => (
                  <div key={feature.key} className="flex flex-wrap items-center gap-2">
                    <span className="w-52 shrink-0 font-bold text-foreground" title={feature.hint}>{feature.label}</span>
                    {feature.levels.map((label, level) => {
                      const on = filters[feature.key]?.includes(level) ?? false;
                      return <button key={label} type="button" aria-pressed={on} title={feature.hint} onClick={() => toggle(feature.key, level)}
                        className={`rounded-lg border px-2.5 py-1 ${on ? "border-emerald-600 bg-emerald-50 font-bold text-emerald-800" : "border-border bg-white hover:border-emerald-300"}`}>{label}</button>;
                    })}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {!data ? (error ? <EmptyState tone="error" title="Setup Lab unavailable">The page will retry when you change a filter.</EmptyState> : <LoadingState rows={5} message={progress ?? "Loading the Setup Lab."} />) : (
          <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
            <p className="rounded-xl border border-border bg-raised p-3 text-sm leading-6">{active.length ? "" : "No filters yet: this is every judged stock-day. "}{labSentence(data)}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Beat the median stock" value={data.combo.winRate == null ? "—" : `${data.combo.winRate.toFixed(1)}%`} sub={`all stocks ${data.universe.winRate?.toFixed(1) ?? "—"}%`} tone={data.combo.winRate == null ? "n" : data.combo.winRate >= (data.universe.winRate ?? 50) + 2 ? "g" : data.combo.winRate <= (data.universe.winRate ?? 50) - 2 ? "r" : "n"} />
              <Stat label="Median excess return" value={signed(data.combo.median, 1, "%")} sub={`all stocks ${signed(data.universe.median, 1, "%")}`} />
              <Stat label="Mean excess return" value={signed(data.combo.mean, 1, "%")} sub={`all stocks ${signed(data.universe.mean, 1, "%")}`} />
              <Stat label="Worst 10% of outcomes" value={signed(data.combo.p10, 1, "%")} sub={`all stocks ${signed(data.universe.p10, 1, "%")}`} />
              <Stat label="Stock-days measured" value={data.combo.n.toLocaleString("en-IN")} sub={`${data.matched.toLocaleString("en-IN")} met the filters, ${data.observations.toLocaleString("en-IN")} judged`} />
            </div>
            <p className="mt-1 text-[11px] text-muted">Excess return is the {horizon}-session return minus the median stock&apos;s over the same days. {data.sessions} sessions from {data.stocks.toLocaleString("en-IN")} liquid stocks · {data.source.label}.</p>

            <Panel title="Where the returns landed" note={`Share of each group's own stock-days by ${horizon}-session excess return.`}>
              <Histogram labels={data.histogram.labels} combo={data.histogram.combo} universe={data.histogram.universe} dim={data.combo.winRate == null} />
            </Panel>
            <Panel title="Which filter is doing the work" note="Win rate with all your filters, minus the win rate if you drop just that one. Positive: the filter earns its place. Near zero or negative: it is costing you samples for nothing.">
              {!data.dropOne.length ? <p className="text-xs text-muted">Pick a filter and this panel shows how much of the result it is responsible for.</p> : (
                <ul className="space-y-1.5 text-xs">{data.dropOne.map((d) => (
                  <li key={d.key} className="flex items-center gap-3"><span className="w-56 shrink-0">{d.label}</span>
                    <DeltaBar value={d.delta} scale={10} /><span className="w-24 shrink-0 text-right font-mono">{signed(d.delta, 1, " pts")}</span>
                    <span className="hidden w-40 shrink-0 text-muted sm:inline">{d.winRate == null ? "too few without it" : `${d.winRate.toFixed(1)}% without it`}</span></li>
                ))}</ul>
              )}
            </Panel>
            <Panel title="Every month, or one lucky month?" note="Win rate in each calendar month minus all stocks' win rate that same month, so a bar reads as better or worse than that month was. Months with fewer than 10 outcomes are blank; the latest months are still open.">
              <div className="flex h-24 items-center gap-1" role="img" aria-label="Win rate against baseline, by month">
                {data.months.map((m) => (
                  <div key={m.month} className="group flex h-full flex-1 flex-col justify-center" title={`${m.month}: ${m.delta == null ? "too few" : signed(m.delta, 1, " pts")} (${m.n} stock-days)`}>
                    <div className="flex h-1/2 items-end"><div className="w-full bg-emerald-500" style={{ height: `${m.delta != null && m.delta > 0 ? Math.min(100, (m.delta / 25) * 100) : 0}%` }} /></div>
                    <div className="flex h-1/2 items-start"><div className="w-full bg-rose-500" style={{ height: `${m.delta != null && m.delta < 0 ? Math.min(100, (-m.delta / 25) * 100) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted"><span>{data.months[0]?.month}</span><span>{data.months.at(-1)?.month}</span></div>
              <p className="mt-1 text-[11px] text-muted">{(() => { const w = data.months.filter((m) => m.delta != null); const g = w.filter((m) => m.delta! > 0).length; return w.length ? `Better than baseline in ${g} of ${w.length} measurable months.` : "Not enough stock-days per month to compare."; })()}</p>
            </Panel>
            <Panel title="One regime, or both?" note="The same filters split by the market regime each stock-day fell in, each against all stocks in that regime.">
              <table className="w-full text-xs"><thead className="text-left text-[11px] uppercase text-muted"><tr><th className="py-1">Regime</th><th>This setup</th><th>All stocks</th><th>Stock-days</th></tr></thead>
                <tbody>{data.regimes.map((g) => (
                  <tr key={g.label} className="border-t border-border"><td className="py-2">{g.label}</td><td className="font-mono">{g.combo.winRate == null ? "too few" : `${g.combo.winRate.toFixed(1)}%`}</td><td className="font-mono text-muted">{g.universe.winRate == null ? "—" : `${g.universe.winRate.toFixed(1)}%`}</td><td className="font-mono text-muted">{g.combo.n.toLocaleString("en-IN")}</td></tr>
                ))}</tbody></table>
            </Panel>
            <Panel title="Matching right now" note={`${data.matchingNow.total.toLocaleString("en-IN")} stock${data.matchingNow.total === 1 ? "" : "s"} meet every condition on the latest session${data.matchingNow.total > data.matchingNow.rows.length ? `; the ${data.matchingNow.rows.length} with the strongest 63-day return rank are shown` : ""}. Meeting a past pattern is not a prediction.`}>
              {!data.matchingNow.rows.length ? <p className="text-xs text-muted">No stock meets every condition today.</p> : (
                <div className="max-h-96 overflow-auto rounded-lg border border-border"><table className="w-full text-xs"><thead className="sticky top-0 bg-raised text-left text-[11px] uppercase text-muted"><tr><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Close</th><th className="px-3 py-2">63-day rank</th></tr></thead>
                  <tbody>{data.matchingNow.rows.map((row) => (
                    <tr key={row.symbol} className="border-t border-border odd:bg-white even:bg-slate-50"><td className="px-3 py-2"><StockSymbolButton symbol={row.symbol} className="font-bold">{row.symbol}</StockSymbolButton><span className="ml-2 text-muted">{row.name}</span></td><td className="px-3 py-2 font-mono">₹{formatPrice(row.close)}</td><td className="px-3 py-2 font-mono font-bold text-accent">{row.rank}</td></tr>
                  ))}</tbody></table></div>
              )}
            </Panel>
            <p className="mt-3 text-[11px] text-muted">Results below {LAB_RULES.minObservations} measured stock-days are withheld rather than shown.</p>
          </div>
        )}
      </div>
    </WorkspaceFrame>
  );
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return <section className="mt-4 rounded-xl border border-border bg-white p-4"><h3 className="text-sm font-bold">{title}</h3><p className="mb-3 mt-1 text-xs leading-5 text-muted">{note}</p>{children}</section>;
}

function Stat({ label, value, sub, tone = "n" }: { label: string; value: string; sub: string; tone?: "g" | "r" | "n" }) {
  return <div className="rounded-xl border border-border bg-white p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
    <div className={`mt-1 font-mono text-xl font-bold ${tone === "g" ? "text-emerald-700" : tone === "r" ? "text-rose-700" : ""}`}>{value}</div><div className="mt-1 text-[11px] text-muted">{sub}</div></div>;
}

function DeltaBar({ value, scale }: { value: number | null; scale: number }) {
  const width = value == null ? 0 : Math.min(50, (Math.abs(value) / scale) * 50);
  return <span className="relative h-3 flex-1 rounded bg-slate-100" aria-hidden><span className="absolute inset-y-0 left-1/2 w-px bg-slate-400" />
    {value != null && <span className={`absolute inset-y-0 ${value >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`} style={{ width: `${width}%` }} />}</span>;
}

function Histogram({ labels, combo, universe, dim }: { labels: string[]; combo: number[]; universe: number[]; dim: boolean }) {
  const max = Math.max(1, ...combo, ...universe);
  return (
    <div>
      <div className={`flex h-36 items-end gap-1 ${dim ? "opacity-40" : ""}`} role="img" aria-label="Distribution of excess returns, this setup against all stocks">
        {labels.map((label, i) => (
          <div key={label} className="flex h-full flex-1 flex-col justify-end" title={`${label}%: this setup ${combo[i]}% · all stocks ${universe[i]}%`}>
            <div className="flex items-end gap-px"><div className="w-1/2 bg-emerald-500" style={{ height: `${(combo[i] / max) * 130}px` }} /><div className="w-1/2 bg-slate-300" style={{ height: `${(universe[i] / max) * 130}px` }} /></div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-center text-[9px] text-muted">{labels.map((label) => <span key={label} className="flex-1">{label}</span>)}</div>
      <p className="mt-2 text-[11px] text-muted"><span className="font-bold text-emerald-700">■</span> this setup <span className="ml-3 font-bold text-slate-400">■</span> all stocks · buckets in % excess return</p>
    </div>
  );
}

export type { LabStats };
