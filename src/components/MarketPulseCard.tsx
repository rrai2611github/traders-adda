"use client";

import type { MarketPulse, PulseMood, PulseSignal } from "@/lib/screen/marketPulse";

const MOOD_STYLES: Record<PulseMood, { ring: string; badge: string; text: string }> = {
  bullish: { ring: "#10b981", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", text: "text-emerald-700" },
  constructive: { ring: "#34d399", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", text: "text-emerald-700" },
  neutral: { ring: "#94a3b8", badge: "border-slate-200 bg-slate-100 text-slate-600", text: "text-slate-600" },
  cautious: { ring: "#f59e0b", badge: "border-amber-200 bg-amber-50 text-amber-700", text: "text-amber-700" },
  bearish: { ring: "#f43f5e", badge: "border-rose-200 bg-rose-50 text-rose-700", text: "text-rose-700" },
  "no-data": { ring: "#94a3b8", badge: "border-slate-200 bg-slate-100 text-slate-500", text: "text-slate-500" },
};

const VERDICT_STYLES: Record<PulseSignal["verdict"], { dot: string; label: string }> = {
  bull: { dot: "bg-emerald-500", label: "Supportive" },
  bear: { dot: "bg-rose-500", label: "Against longs" },
  neutral: { dot: "bg-slate-400", label: "Mixed" },
};

function MoodRing({ score, color }: { score: number | null; color: string }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const filled = score == null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={radius} fill="none" strokeWidth="7" style={{ stroke: "var(--chart-grid)" }} />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-black text-slate-900">
        {score ?? "—"}
      </span>
    </div>
  );
}

/** Scanner Pro-style plain-English market card: mood score, stance, what it means today and what the tape favours. */
export function MarketPulseCard({ pulse, compact = false }: { pulse: MarketPulse; compact?: boolean }) {
  const style = MOOD_STYLES[pulse.mood];
  return (
    <section aria-labelledby="market-pulse-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="market-pulse-title" className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-600" aria-hidden>◔</span>
          Market pulse
        </h3>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${style.badge}`}>
          {pulse.moodLabel}
        </span>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <MoodRing score={pulse.score} color={style.ring} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className={`font-black uppercase tracking-[0.12em] ${style.text}`}>{pulse.moodLabel}</span>
                <span className="text-slate-500">market mood · {pulse.inputs} of 3 inputs</span>
              </div>
              <p className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">{pulse.headline}</p>
            </div>
          </div>
          {!compact && <p className="mt-3 text-sm leading-6 text-slate-600">{pulse.summary}</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-white">{pulse.stance}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">What this means today</span>
          </div>
          {!compact && <p className="mt-2 text-sm leading-6 text-slate-800">{pulse.meaning}</p>}
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-black text-slate-800">Tape favours:</span> {pulse.tapeFavours}
          </p>
        </div>
      </div>

      <details className="group mt-3 rounded-xl border border-slate-200">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
          Signals &amp; score breakdown
          <span className="text-slate-400 transition group-open:rotate-180" aria-hidden>⌄</span>
        </summary>
        {compact && <div className="border-t border-border px-4 py-3 text-xs leading-5 text-muted"><p>{pulse.summary}</p><p className="mt-2">{pulse.meaning}</p></div>}
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {pulse.signals.map((signal) => (
            <li key={signal.label} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_STYLES[signal.verdict].dot}`} title={VERDICT_STYLES[signal.verdict].label} />
              <span className="min-w-0 flex-1 font-semibold text-slate-700">{signal.label}</span>
              <span className="w-14 shrink-0 font-mono font-black text-slate-900">{signal.value}</span>
              <span className="w-full text-xs text-slate-500">{signal.note}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Mood = 40% above-50-DMA + 30% above-200-DMA + 30% advancing today, across every liquid NSE stock (not the universe filter).
        </p>
      </details>
    </section>
  );
}
