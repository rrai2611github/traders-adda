/**
 * The "what to do today" strip at the top of the Dashboard: three facts, each in a few plain words, so the answer to "do I need to sell
 * something, how is the paper test doing, is the strategy still working?" is on one line instead of three pages. Whether real buys are
 * allowed is the banner above it (the setup check), so it is not repeated here.
 */
export type StripTone = "good" | "warn" | "bad" | "neutral";

export interface StripTile {
  key: "positions" | "live" | "health";
  title: string;
  big: string;
  sub: string;
  tone: StripTone;
  href?: string;
}

const signedPercent = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const loading = (key: StripTile["key"], title: string, href?: string): StripTile => ({ key, title, big: "Checking…", sub: "Loading.", tone: "neutral", href });

export interface PositionsSlice {
  open: ReadonlyArray<{ assessment: { status: string } }>;
}

/** Your real positions against the exit rules. */
export function positionsTile(view: PositionsSlice | null | undefined): StripTile {
  const href = "/positions";
  if (!view) return loading("positions", "My positions", href);
  const n = view.open.length;
  if (n === 0) return { key: "positions", title: "My positions", big: "None open", sub: "When you buy a stock, add it here and the app watches the exit rules for you.", tone: "neutral", href };
  const due = view.open.filter((p) => p.assessment.status === "stop-hit" || p.assessment.status === "exit-signal").length;
  const near = view.open.filter((p) => p.assessment.status === "close-to-stop").length;
  if (due > 0) return { key: "positions", title: "My positions", big: `${due} need${due === 1 ? "s" : ""} a decision`, sub: `${n} open. The rules say sell: place the sale, then mark it sold.`, tone: "bad", href };
  if (near > 0) return { key: "positions", title: "My positions", big: `${n} open`, sub: `${near} ${near === 1 ? "is" : "are"} close to the stop. Nothing to do yet.`, tone: "warn", href };
  return { key: "positions", title: "My positions", big: `${n} open`, sub: "All inside the rules. Nothing to sell.", tone: "good", href };
}

export interface TrackerSlice {
  config: { startDate: string } | null;
  /** The saved price files: the latest candle on file and the day the nightly refresh last finished. */
  history?: { lastCandleDay: string | null; lastDay: string | null };
  job:
    | { status: "none" }
    | { status: "waiting" }
    | { status: "running" }
    | { status: "failed" }
    | { status: "done"; result: { stats: { totalReturnPercent: number }; trades: ReadonlyArray<{ exitReason: string }>; openPositions: ReadonlyArray<unknown> } };
}

/** The paper test of the rules on real prices. */
export function liveTile(payload: TrackerSlice | null | undefined): StripTile {
  const href = "/tracker";
  if (!payload) return loading("live", "Live strategy check", href);
  if (!payload.config) return { key: "live", title: "Live strategy check", big: "Not started", sub: "Start it to test the rules on real prices with paper money.", tone: "neutral", href };
  const since = payload.config.startDate;
  const job = payload.job;
  if (job.status === "waiting" || job.status === "none") return { key: "live", title: "Live strategy check", big: "Waiting", sub: `Following since ${since}. The first finished session arrives after 4:30 pm IST.`, tone: "neutral", href };
  if (job.status === "running") return { key: "live", title: "Live strategy check", big: "Calculating…", sub: `Following since ${since}.`, tone: "neutral", href };
  if (job.status === "failed") return { key: "live", title: "Live strategy check", big: "Problem", sub: "The check could not run. Open it for details.", tone: "warn", href };
  const open = job.result.openPositions.length;
  const closed = job.result.trades.filter((t) => t.exitReason !== "end").length;
  if (open + closed === 0) return { key: "live", title: "Live strategy check", big: "No trades yet", sub: `Following since ${since}. The rules are waiting for a market that passes the check.`, tone: "neutral", href };
  const ret = job.result.stats.totalReturnPercent;
  // A handful of trades says nothing either way, so the colour stays neutral until there are enough.
  const tone: StripTone = closed >= 15 ? (ret >= 0 ? "good" : "warn") : "neutral";
  return { key: "live", title: "Live strategy check", big: `${open} open · ${closed} closed`, sub: `${signedPercent(ret)} since ${since}. Judge it after 30 closed trades.`, tone, href };
}

export interface HealthSlice {
  status: "running" | "failed" | "done";
  report?: { verdict: "on-track" | "early" | "watch" | "review"; headline: string };
}

const HEALTH_BIG = { "on-track": "On track", early: "Too early", watch: "Watch", review: "Review" } as const;
const HEALTH_TONE: Record<keyof typeof HEALTH_BIG, StripTone> = { "on-track": "good", early: "neutral", watch: "warn", review: "bad" };

/** Is the strategy's edge still there? */
export function healthTile(payload: HealthSlice | null | undefined): StripTile {
  const href = "/tracker";
  if (!payload || payload.status === "running") return loading("health", "Strategy health", href);
  if (payload.status === "failed" || !payload.report) return { key: "health", title: "Strategy health", big: "Unavailable", sub: "The check could not run right now.", tone: "neutral", href };
  const v = payload.report.verdict;
  return { key: "health", title: "Strategy health", big: HEALTH_BIG[v], sub: payload.report.headline, tone: HEALTH_TONE[v], href };
}
