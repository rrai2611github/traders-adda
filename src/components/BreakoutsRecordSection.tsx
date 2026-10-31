"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";
import { useMemo, useState } from "react";
import { buildGroupMap, IndustryFilterPopovers } from "./IndustryFilterPopovers";
import { useBreakoutFeed, type BreakoutEvent } from "@/hooks/useBreakoutFeed";
import type { ScreenName } from "@/lib/screen/criteria";
import type { ScreenScan } from "@/hooks/useScreenScan";
import { currentScanBuyingStatus } from "@/lib/screen/buyingStatus";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { EmptyState, LoadingState } from "./WorkspaceShell";

type BreakoutView = "cards" | "list";
type BreakoutScreen = "" | ScreenName;
type BreakoutSort =
  | "rs"
  | "bc.boChg"
  | "gain"
  | "ext"
  | "boVolX"
  | "boRange"
  | "turn"
  | "mcap";

type BreakoutRow = {
  name: string;
  symbol: string;
  date: string;
  price: number;
  changePercent: number;
  breakoutDayGain: number;
  nowVsPivot: number | null;
  rs: number | null;
  breakoutVolume?: number | null;
  closeInRange?: number | null;
  medianTurnover: number | null;
  marketCap: number | null;
  industry: string;
  subgroup: string;
  tags: ScreenName[];
  seed: string;
};

const SCREEN_OPTIONS: { label: string; value: BreakoutScreen }[] = [
  { label: "All screens", value: "" },
  { label: "VCP", value: "VCP" },
  { label: "Blue sky", value: "Blue sky" },
  { label: "Multi-year breakouts", value: "Multi-year breakouts" },
  { label: "IPO base", value: "IPO base" },
];

const SORT_OPTIONS: { label: string; value: BreakoutSort }[] = [
  { label: "RS rating", value: "rs" },
  { label: "Breakout-day gain (%)", value: "bc.boChg" },
  { label: "1-day gain (%)", value: "gain" },
  { label: "Now vs pivot (%)", value: "ext" },
  { label: "Breakout volume (vs normal day)", value: "boVolX" },
  { label: "Breakout close-in-range (0–1)", value: "boRange" },
  { label: "Median turnover", value: "turn" },
];


function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** Percentages in this table always carry their sign, and may be unknown. */
function signedPercent(value: number | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}%`;
}

function getSortValue(row: BreakoutRow, sort: BreakoutSort): number {
  switch (sort) {
    case "rs":
      return row.rs ?? -1;
    case "bc.boChg":
      return row.breakoutDayGain;
    case "gain":
      return row.changePercent;
    case "ext":
      return row.nowVsPivot ?? -1;
    case "boVolX":
      return row.breakoutVolume ?? -1;
    case "boRange":
      return row.closeInRange ?? -1;
    case "turn":
      return row.medianTurnover ?? -1;
    case "mcap":
      return row.marketCap ?? -1;
  }
}

/** The call-to-action the source shows under each card, driven by its screens. */
function seedFor(tags: BreakoutRow["tags"]): string {
  if (!tags.length) return "Find bases like this — before they break out ›";
  if (tags.length === 1) return `Open the ${tags[0]} screen ›`;
  return `See ${tags.join(" + ")} together ›`;
}

function eventToRow(event: BreakoutEvent): BreakoutRow {
  return {
    name: event.name,
    symbol: event.symbol,
    date: event.d,
    price: event.price,
    changePercent: event.changePercent,
    breakoutDayGain: event.breakoutDayGain,
    nowVsPivot: event.nowVsPivot,
    rs: event.rs,
    breakoutVolume: event.breakoutVolume,
    closeInRange: event.closeInRange,
    medianTurnover: event.medianTurnover,
    marketCap: event.marketCap,
    industry: event.industry,
    subgroup: event.subgroup,
    tags: event.tags,
    seed: seedFor(event.tags),
  };
}


export function BreakoutsRecordSection({ scan }: { scan: ScreenScan | null }) {
  const feed = useBreakoutFeed(5);
  const allRows = useMemo(() => (feed?.events ?? []).map(eventToRow), [feed]);

  // Newest session first, so "Last close" is the default the source opens on.
  const dateOptions = useMemo(() => {
    const days = [...(feed?.days ?? [])].reverse();
    return days.map((value, index) => ({
      value,
      label: index === 0 ? `Last close · ${formatDate(value)}` : formatDate(value),
    }));
  }, [feed]);

  const [day, setDay] = useState("");
  const [screen, setScreen] = useState<BreakoutScreen>("");
  const [view, setView] = useState<BreakoutView>("cards");
  const [sort, setSort] = useState<BreakoutSort>("bc.boChg");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const breadthPercent = useMemo(() => movingAverageBreadth(scan?.rows ?? [], "vs50").percent, [scan]);
  const ratings = useMemo(() => new Map((scan?.rows ?? []).map((row) => [
    row.symbol,
    currentScanBuyingStatus(row, breadthPercent),
  ])), [breadthPercent, scan]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [barOpen, setBarOpen] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showMeasures, setShowMeasures] = useState(false);
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [minRs, setMinRs] = useState("");
  const [visibleMeasures, setVisibleMeasures] = useState<BreakoutSort[]>([
    "bc.boChg",
    "gain",
    "ext",
    "boVolX",
    "boRange",
    "turn",
  ]);

  // The feed decides which sessions exist, so follow it until the user picks.
  const selectedDay = day && dateOptions.some((o) => o.value === day) ? day : dateOptions[0]?.value ?? "";

  const groupMap = useMemo(
    () => buildGroupMap(allRows.map((row) => ({ industry: row.industry, subgroup: row.subgroup }))),
    [allRows],
  );

  const rowsForDay = useMemo(
    () => allRows.filter((row) => row.date === selectedDay),
    [allRows, selectedDay],
  );
  const screenCount = (value: BreakoutScreen) =>
    value ? rowsForDay.filter((row) => row.tags.includes(value)).length : rowsForDay.length;

  const activeFilterCount = minRs.trim() ? 1 : 0;
  const pool = useMemo(() => {
    const min = Number(minRs);
    return rowsForDay
      .filter((row) => !screen || row.tags.includes(screen))
      .filter((row) => !minRs.trim() || !Number.isFinite(min) || (row.rs ?? -1) >= min);
  }, [minRs, rowsForDay, screen]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((row) => picked.size === 0 || picked.has(row.subgroup))
      .filter((row) => !q || `${row.name} ${row.symbol} ${row.industry} ${row.subgroup}`.toLowerCase().includes(q))
      .sort((left, right) => getSortValue(right, sort) - getSortValue(left, sort));
  }, [picked, pool, query, sort]);

  const clearPicked = () => {
    setPicked(new Set());
    setExpanded(false);
  };

  const dayLabel = dateOptions.find((option) => option.value === selectedDay)?.label ?? formatDate(selectedDay);
  const appliedSummary = [
    screen || null,
    picked.size ? `${picked.size} industr${picked.size === 1 ? "y" : "ies"}` : null,
    activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const visibleRows = expanded ? rows : rows.slice(0, 6);
  const loading = feed == null;

  return (
    <section id="breakouts-record" className="scroll-mt-28 rounded-3xl border border-border bg-[#fbfaf4] p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[#16894f]">Breakouts</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-foreground">The breakout record</h2>
          <p className="mt-1 text-sm text-muted">
            Every breakout at the liquidity floor, across all screens — the last five trading days.
          </p>
          {feed ? (
            <p className="mt-1 text-xs text-muted">
              Source: {feed.source.label}
              {feed.unavailable.length > 0
                ? ` · Skipped ${feed.unavailable.length} with no provider data: ${feed.unavailable.slice(0, 12).join(", ")}${feed.unavailable.length > 12 ? ` and ${feed.unavailable.length - 12} more` : ""}`
                : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setBarOpen((value) => !value)}
          className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-black shadow-sm"
        >
          {loading ? "Loading…" : dayLabel}
          {appliedSummary ? <i className="font-bold not-italic text-muted"> · {appliedSummary}</i> : null}
          <span className="ml-2 text-muted">{barOpen ? "Hide" : "Change"} ›</span>
        </button>
      </div>

      {barOpen ? (
      <div className="mt-5 rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <label className="text-xs font-semibold text-muted">
            Pick a date
            <select value={selectedDay} onChange={(event) => setDay(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-foreground">
              {dateOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-muted">
            Screen
            <select value={screen} onChange={(event) => setScreen(event.target.value as BreakoutScreen)} className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-foreground">
              {SCREEN_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label} ({screenCount(option.value)})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <IndustryFilterPopovers
            idPrefix="brk"
            pool={pool.map((row) => ({ industry: row.industry, subgroup: row.subgroup }))}
            groupMap={groupMap}
            picked={picked}
            onChange={(next) => { setPicked(next); setExpanded(false); }}
            allLabel={`All ${pool.length} that day`}
          />
          <div className="ml-auto flex overflow-hidden rounded-xl border border-border bg-white">
            <button type="button" onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-black ${view === "cards" ? "bg-[#16894f] text-white" : "text-muted"}`}>▦ Cards</button>
            <button type="button" onClick={() => setView("list")} className={`px-3 py-2 text-xs font-black ${view === "list" ? "bg-[#16894f] text-white" : "text-muted"}`}>☰ List</button>
          </div>
          <button onClick={() => setShowFilters((show) => !show)} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-muted" type="button">⚙ Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
          <button onClick={() => setShowMeasures((show) => !show)} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-muted" type="button">Choose measures</button>
          <button onClick={() => setShowChartSettings((show) => !show)} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-muted" type="button">Chart settings</button>
        </div>
        {showFilters && (
          <div className="mt-3 rounded-xl border border-[#cbe9d8] bg-[#f6fbf8] p-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-muted">
                Minimum RS rating
                <input value={minRs} onChange={(event) => setMinRs(event.target.value)} type="number" min="1" max="99" className="mt-1 block rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none" />
              </label>
              <button
                type="button"
                onClick={() => {
                  setMinRs("");
                  clearPicked();
                  setScreen("");
                }}
                className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-black text-muted"
              >
                Reset filters
              </button>
            </div>
          </div>
        )}
        {showMeasures && (
          <div className="mt-3 grid gap-2 rounded-xl border border-border bg-white p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {SORT_OPTIONS.filter((option) => option.value !== "rs").map((option) => (
              <label key={option.value} className="flex items-center gap-2 font-semibold text-muted">
                <input
                  type="checkbox"
                  checked={visibleMeasures.includes(option.value)}
                  onChange={(event) =>
                    setVisibleMeasures((current) =>
                      event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        )}
        {showChartSettings && (
          <div className="mt-3 rounded-xl border border-border bg-white p-3 text-xs text-muted">
            Daily setup charts · pivot line on · volume on · 56 candles
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a stock" className="min-w-[210px] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none" />
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            Sort
            <select value={sort} onChange={(event) => (event.target.value === "__custom" ? setShowMeasures(true) : setSort(event.target.value as BreakoutSort))} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-foreground">
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option disabled>──────────</option>
              <option value="__custom">Customise this list…</option>
            </select>
          </label>
        </div>
      </div>
      ) : null}

      {loading ? (
        <div className="mt-5 rounded-2xl border border-border bg-white"><LoadingState message="Scanning the market for breakouts…" /></div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border bg-white">
          <EmptyState tone={rowsForDay.length === 0 ? "neutral" : "search"} title={rowsForDay.length === 0 ? "No breakouts" : "No matches"}>
            {rowsForDay.length === 0
              ? "Nothing broke out of a base on this session."
              : "No breakouts match your picks that day."}
          </EmptyState>
        </div>
      ) : view === "cards" ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((row) => (
            <article key={row.symbol} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <StockSymbolButton symbol={row.symbol} className="block max-w-full truncate text-base font-black text-foreground">{row.name}</StockSymbolButton>
                  <div className="mt-1 text-xs font-bold text-slate-400">{row.symbol}</div>
                  <div className="mt-1 text-xs text-muted">{row.industry} · {row.subgroup}</div>
                </div>
                <div className="text-right font-mono text-sm font-black">
                  <LivePrice symbol={row.symbol} fallbackPrice={row.price} fallbackChange={row.changePercent} stacked />
                </div>
              </div>
              <div className="mt-3 border-y border-border py-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  Current buying status
                </div>
                {ratings.get(row.symbol)
                  ? <BuyingStatusBadge status={ratings.get(row.symbol)!} />
                  : <span className="text-xs text-muted">Rating unavailable</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Metric label="Breakout date" value={formatDate(row.date)} />
                {visibleMeasures.includes("ext") && <Metric label="Now vs pivot (%)" value={signedPercent(row.nowVsPivot)} />}
                {visibleMeasures.includes("bc.boChg") && <Metric label="Breakout-day gain (%)" value={signedPercent(row.breakoutDayGain)} />}
                <Metric label="RS rating" value={row.rs == null ? "—" : String(row.rs)} />
                {visibleMeasures.includes("turn") && <Metric label="Median turnover" value={row.medianTurnover == null ? "—" : `₹${row.medianTurnover.toFixed(2)}cr`} />}
                {visibleMeasures.includes("mcap") && <Metric label="Market cap" value={row.marketCap == null ? "—" : `₹${Math.round(row.marketCap).toLocaleString("en-IN")}cr`} />}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {row.tags.length ? row.tags.map((tag) => <span key={tag} className="rounded-md bg-[#e7f6ee] px-2 py-1 text-[10px] font-black text-[#16894f]">{tag}</span>) : <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">matches no screen</span>}
              </div>
              <button type="button" className="mt-3 w-full rounded-xl border border-border bg-slate-50 px-3 py-2 text-xs font-black text-foreground">{row.seed}</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-white">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-3 text-left">Stock</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">Breakout-day gain (%)</th>
                <th className="px-3 py-3 text-right">Now vs pivot (%)</th>
                <th className="px-3 py-3 text-right">RS rating</th>
                <th className="px-3 py-3 text-left">Buying status / rating</th>
                <th className="px-3 py-3 text-left">Screen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((row) => (
                <tr key={row.symbol}>
                  <td className="px-3 py-3">
                    <StockSymbolButton symbol={row.symbol} className="block font-black">{row.name}</StockSymbolButton>
                    <div className="text-xs text-slate-400">{row.symbol} · {row.subgroup}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono"><LivePrice symbol={row.symbol} fallbackPrice={row.price} fallbackChange={row.changePercent} stacked /></td>
                  <td className="px-3 py-3 text-right font-mono">{signedPercent(row.breakoutDayGain)}</td>
                  <td className="px-3 py-3 text-right font-mono">{signedPercent(row.nowVsPivot)}</td>
                  <td className="px-3 py-3 text-right font-mono">{row.rs ?? "—"}</td>
                  <td className="px-3 py-3">
                    {ratings.get(row.symbol)
                      ? <BuyingStatusBadge status={ratings.get(row.symbol)!} />
                      : <span className="text-xs text-muted">Rating unavailable</span>}
                  </td>
                  <td className="px-3 py-3">{row.tags.length ? row.tags.join(" / ") : "matches no screen"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!expanded && rows.length > 6 ? (
        <button type="button" onClick={() => setExpanded(true)} className="mt-4 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm font-black shadow-sm">
          Show all {rows.length} ›
        </button>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <div className="text-[10px] font-bold text-slate-400">{label}</div>
      <div className="mt-1 font-mono font-black text-slate-700">{value}</div>
    </div>
  );
}
