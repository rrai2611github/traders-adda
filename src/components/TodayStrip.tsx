"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dataFreshness } from "@/lib/market/freshness";
import { healthTile, liveTile, positionsTile, type HealthSlice, type PositionsSlice, type StripTile, type StripTone, type TrackerSlice } from "@/lib/screen/todayStrip";

const TONE: Record<StripTone, { card: string; dot: string; big: string }> = {
  good: { card: "border-emerald-200 bg-emerald-50/60", dot: "bg-emerald-500", big: "text-emerald-800" },
  warn: { card: "border-amber-200 bg-amber-50/60", dot: "bg-amber-500", big: "text-amber-800" },
  bad: { card: "border-rose-300 bg-rose-50", dot: "bg-rose-500", big: "text-rose-800" },
  neutral: { card: "border-slate-200 bg-white", dot: "bg-slate-400", big: "text-slate-900" },
};

/** Polls one of the app's own JSON endpoints; `again` says how long to wait before the next look (null stops). Failures keep what is shown. */
function usePolled<T>(url: string, again: (body: T) => number | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
        .then((body) => {
          if (!alive) return;
          if (body) setData(body);
          const wait = body ? again(body) : 60_000;
          if (wait != null) timer = setTimeout(look, wait);
        })
        .catch(() => { if (alive) timer = setTimeout(look, 60_000); });
    };
    look();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // `again` is a plain function of the body; the endpoint is what identifies the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return data;
}

function Tile({ tile }: { tile: StripTile }) {
  const t = TONE[tile.tone];
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
        <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
        {tile.title}
      </div>
      <div className={`mt-1 text-[17px] font-black leading-tight tracking-tight ${t.big}`}>{tile.big}</div>
      <p className="mt-1 text-[11.5px] leading-4 text-slate-600">{tile.sub}</p>
    </>
  );
  const cls = `block min-w-0 rounded-xl border p-3 shadow-sm transition ${t.card} ${tile.href ? "hover:shadow-md" : ""}`;
  return tile.href ? <Link href={tile.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** "What to do today" in three tiles: must I sell, how is the paper test, is the strategy still working. */
export function TodayStrip() {
  const positions = usePolled<PositionsSlice>("/api/positions", () => 60_000);
  const tracker = usePolled<TrackerSlice>("/api/tracker", (b) => (b.job.status === "running" ? 4_000 : 120_000));
  const health = usePolled<HealthSlice>("/api/strategy-health", (b) => (b.status === "running" ? 4_000 : 300_000));
  const tiles = [positionsTile(positions), liveTile(tracker), healthTile(health)];
  // The clock is state, not read during render, so the page stays pure; it only needs to be roughly right.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 300_000);
    return () => clearInterval(id);
  }, []);
  const freshness = tracker?.history ? dataFreshness({ lastCandleDay: tracker.history.lastCandleDay, refreshedDay: tracker.history.lastDay, now }) : null;
  return (
    <section aria-label="What to do today" className="space-y-2">
      <div className="grid gap-3 md:grid-cols-3">
        {tiles.map((tile) => <Tile key={tile.key} tile={tile} />)}
      </div>
      {freshness?.state === "stale" && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] font-semibold leading-5 text-amber-900">⚠ {freshness.message}</p>
      )}
    </section>
  );
}
