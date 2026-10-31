"use client";

import { useMemo, useState } from "react";
import type { MarketCues } from "@/lib/market/globalCues";
import {
  buildMorningBrief,
  formatMorningBriefText,
  type BiasKey,
  type MorningBriefIdea,
} from "@/lib/screen/morningBrief";
import { EmptyState, LoadingState } from "./WorkspaceShell";
import { StockSymbolButton } from "./StockDetailContext";

const BIAS_STYLES: Record<BiasKey, { badge: string; text: string; dot: string }> = {
  "strong-up": { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", text: "text-emerald-700", dot: "bg-emerald-500" },
  "mild-up": { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", text: "text-emerald-700", dot: "bg-emerald-400" },
  flat: { badge: "border-slate-200 bg-slate-100 text-slate-600", text: "text-slate-600", dot: "bg-slate-400" },
  "mild-down": { badge: "border-amber-200 bg-amber-50 text-amber-700", text: "text-amber-700", dot: "bg-amber-500" },
  "strong-down": { badge: "border-rose-200 bg-rose-50 text-rose-700", text: "text-rose-700", dot: "bg-rose-500" },
};

const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const moveClass = (value: number) => (value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-slate-500");
const signedPercent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-600 transition hover:bg-slate-50"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? "Copied ✓" : "Copy brief"}
    </button>
  );
}

/**
 * Pre-open brief: a derived opening call, the overnight macro tape, key levels
 * from the previous session's range, and the scanners' qualified ideas.
 *
 * The opening call and the levels are explicitly labelled as derived because
 * GIFT Nifty and NSE option-chain OI are not available to this workstation.
 */
export function MorningBriefCard({
  cues,
  error,
  sessionLabel,
  ideas,
  horizonLabel,
  ideasLoading = false,
}: {
  cues: MarketCues | null;
  error: boolean;
  sessionLabel: string;
  ideas: ReadonlyArray<MorningBriefIdea>;
  horizonLabel: string;
  /** True while the universe scan is still warming, so "nothing qualifies" would be wrong. */
  ideasLoading?: boolean;
}) {
  const brief = useMemo(
    () =>
      cues
        ? buildMorningBrief({
            generatedAt: cues.generatedAt,
            sessionLabel,
            cues: cues.cues,
            sessions: cues.sessions,
            ideas: ideas.slice(0, 5),
            unavailable: cues.unavailable,
          })
        : null,
    [cues, ideas, sessionLabel],
  );

  const briefText = useMemo(() => (brief ? formatMorningBriefText(brief) : ""), [brief]);

  return (
    <section aria-labelledby="morning-brief-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="morning-brief-title" className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-600" aria-hidden>☕</span>
            Morning brief
          </h3>
          <p className="mt-1 text-xs text-slate-500">Three things that decide today: the overnight tape, key levels and what qualifies.</p>
        </div>
        {brief && <CopyButton text={briefText} />}
      </header>

      {error && !brief && (
        <div className="mt-4">
          <EmptyState tone="error" title="Global cues unavailable">
            The overnight cue feed could not be reached. The brief will fill in on the next refresh.
          </EmptyState>
        </div>
      )}
      {!brief && !error && <div className="mt-4"><LoadingState rows={4} message="Loading overnight global cues…" /></div>}

      {brief && (
        <>
          {error && (
            <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
              Cue refresh failed — showing the last successful fetch.
            </p>
          )}

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.12em] ${BIAS_STYLES[brief.bias.key].badge}`}>
                <span className={`h-2 w-2 rounded-full ${BIAS_STYLES[brief.bias.key].dot}`} aria-hidden />
                {brief.bias.label}
              </span>
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Derived opening bias</span>
              {brief.bias.score != null && (
                <span className={`font-mono text-sm font-black ${moveClass(brief.bias.score)}`}>{signedPercent(brief.bias.score)}</span>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{brief.bias.summary}</p>

            {brief.bias.components.length > 0 && (
              <details className="group mt-3 rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
                  How the bias is calculated
                  <span className="text-slate-400 transition group-open:rotate-180" aria-hidden>⌄</span>
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {brief.bias.components.map((component) => (
                    <li key={component.label} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 font-semibold text-slate-700">{component.label}</span>
                      <span className={`w-16 shrink-0 text-right font-mono font-black ${moveClass(component.raw)}`}>{signedPercent(component.raw)}</span>
                      <span className="w-14 shrink-0 text-right font-mono text-slate-400">×{component.weight}</span>
                      <span className="w-full text-[11px] text-slate-500">{component.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                  Weighted average of the moves above. Crude and USD/INR are inverted because a dearer barrel or a weaker rupee is a headwind.
                </p>
              </details>
            )}
          </div>

          <h4 className="mt-5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Macro &amp; global cues</h4>
          <p className="mt-1 text-[11px] text-slate-500">Colours show the effect on Indian equities, so a rise in crude, the dollar, yields or VIX reads red.</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {brief.cues.map((section) => (
              <div key={section.title} className="min-w-0 rounded-xl border border-slate-200 p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500" title={section.source}>{section.title}</div>
                <ul className="mt-1.5 space-y-1">
                  {section.lines.map((line) => (
                    <li key={line.label} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-slate-700">{line.label} {line.value}</span>
                      <span
                        className={`shrink-0 font-mono font-black ${moveClass(line.inverseTone ? -line.changePercent : line.changePercent)}`}
                        title={line.inverseTone ? "Coloured by its effect on Indian equities: a rise here is a headwind." : undefined}
                      >
                        {signedPercent(line.changePercent)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <h4 className="mt-5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Key levels</h4>
          <p className="mt-1 text-[11px] text-slate-500">
            Classic floor pivots off the previous session&apos;s range. NSE option-chain open interest is not available here, so these are price structure, not OI walls.
          </p>
          <div className="mt-2 grid gap-2 lg:grid-cols-3">
            {brief.levels.map((level) => (
              <div key={level.key} className="min-w-0 rounded-xl border border-slate-200 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-black text-slate-900">{level.label}</span>
                  <span className={`shrink-0 font-mono text-[11px] font-black ${moveClass(level.changePercent)}`}>{signedPercent(level.changePercent)}</span>
                </div>
                <div className="mt-1 font-mono text-lg font-black tabular-nums text-slate-900">{whole.format(level.close)}</div>
                <div className="mt-1 text-[11px] font-bold text-slate-600">{level.zone} zone</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px] text-slate-500">
                  <div className="flex justify-between"><dt>R2</dt><dd className="text-emerald-700">{whole.format(level.resistance2)}</dd></div>
                  <div className="flex justify-between"><dt>S2</dt><dd className="text-rose-700">{whole.format(level.support2)}</dd></div>
                  <div className="flex justify-between"><dt>R1</dt><dd className="text-emerald-700">{whole.format(level.resistance1)}</dd></div>
                  <div className="flex justify-between"><dt>S1</dt><dd className="text-rose-700">{whole.format(level.support1)}</dd></div>
                  <div className="col-span-2 flex justify-between border-t border-slate-100 pt-0.5 font-black text-slate-700"><dt>Pivot</dt><dd>{whole.format(level.pivot)}</dd></div>
                </dl>
              </div>
            ))}
            {!brief.levels.length && (
              <p className="lg:col-span-3 rounded-xl border border-slate-200 px-3 py-4 text-xs text-slate-400">Index ranges are not available yet.</p>
            )}
          </div>

          <h4 className="mt-5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">What qualifies today · {horizonLabel}</h4>
          {brief.ideas.length ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {brief.ideas.map((idea) => (
                <li key={idea.symbol} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <StockSymbolButton symbol={idea.symbol} className="font-mono text-xs font-black text-slate-900">{idea.symbol}</StockSymbolButton>
                    <div className="truncate text-[11px] text-slate-500">{idea.name} · {idea.statusLabel} {idea.rating}%</div>
                  </div>
                  {idea.entry != null && idea.stop != null && idea.target != null && (
                    <div className="shrink-0 text-right font-mono text-[11px] leading-4">
                      <div className="text-xs font-black text-slate-800">₹{two.format(idea.entry)}</div>
                      <div className="text-rose-700">SL ₹{two.format(idea.stop)}</div>
                      <div className="text-emerald-700">T ₹{two.format(idea.target)}</div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : ideasLoading ? (
            <p className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500">Waiting for the universe scan to finish before ranking ideas…</p>
          ) : (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Nothing is Buy ready or on Watch on the latest scan. Treat today as a watchlist day, not an entry day.
            </p>
          )}

          {brief.unavailable.length > 0 && (
            <p className="mt-4 text-[11px] text-slate-500">
              <span className="font-black text-slate-600">Unavailable:</span> {brief.unavailable.join(", ")}. GIFT Nifty and option-chain OI have no reachable source; the brief never substitutes a guess for them.
            </p>
          )}
        </>
      )}
    </section>
  );
}
