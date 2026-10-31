/**
 * The email track record. Every stock the pre-open or hourly email gives to the recipients is saved the first time it is listed, with the
 * price, tag and plan as they were in that email. Later, each one is scored against the finished daily prices: did it go up, did it hit the
 * stop, did the rules tell us to leave. Nothing here changes any rule or sends anything.
 */
export type RadarList = "top-picks" | "weekly-top5" | "buy-list" | "watch" | "confluence" | "bottomed";
export type EmailKind = "pre-open" | "hourly";

export const LIST_LABEL: Record<RadarList, string> = {
  "top-picks": "Top picks",
  "weekly-top5": "Weekly Top 5",
  "buy-list": "Older Buy ready list",
  watch: "Older watch list",
  confluence: "Scanner agreement",
  bottomed: "Bottomed out",
};

export const TAG_LABEL: Record<string, string> = { ready: "Ready", broke: "Just broke out", watch: "Watch", extended: "Extended" };

/** One stock as an email listed it. */
export interface Mention {
  symbol: string;
  name: string;
  sector: string | null;
  list: RadarList;
  /** Top picks only: ready, broke, watch or extended. */
  tag: string | null;
  price: number;
  rs: number | null;
  buy: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  /** 1 is the first stock in its list. */
  rank: number;
}

export interface RadarEntry extends Mention {
  id: string;
  firstDay: string;
  firstAt: number;
  email: EmailKind;
  /** Share of liquid stocks above their 50-day average when the email went out. */
  breadth50: number | null;
  lastDay: string;
  mentions: number;
}

/** A stock that leaves the emails for longer than this and comes back is counted as a new entry. */
export const SAME_EPISODE_DAYS = 10;
/** The stop used when an email gave none: the tested 12%. */
export const DEFAULT_STOP_PERCENT = 12;
/** Fewer evaluated stocks than this in a group is too few to say anything. */
export const ENOUGH = 30;

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

const DAY_MS = 86_400_000;
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const orNull = (v: number | null | undefined) => (valid(v) ? v : null);
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const groupKey = (m: Pick<Mention, "symbol" | "list" | "tag">) => `${m.symbol}|${m.list}|${m.tag ?? ""}`;

/**
 * Adds what one email listed. A stock already on file (same list and tag) within the last ten days only gets its "last seen" day and
 * count updated, so a stock listed every hour for a week is one entry. A stock whose tag changes (Watch to Ready) is a new entry, because
 * that is a new call. Unusable rows (no price) and repeats inside one email are skipped.
 */
export function recordMentions(
  entries: ReadonlyArray<RadarEntry>,
  mentions: ReadonlyArray<Mention>,
  context: { day: string; at: number; email: EmailKind; breadth50: number | null },
): { entries: RadarEntry[]; added: number } {
  const out = entries.map((e) => ({ ...e }));
  const latest = new Map<string, number>();
  out.forEach((entry, index) => {
    const key = groupKey(entry);
    const at = latest.get(key);
    if (at == null || out[at].lastDay <= entry.lastDay) latest.set(key, index);
  });
  const seen = new Set<string>();
  let added = 0;
  for (const m of mentions) {
    const key = groupKey(m);
    if (!m.symbol || !valid(m.price) || seen.has(key)) continue;
    seen.add(key);
    const at = latest.get(key);
    if (at != null && dayDiff(context.day, out[at].lastDay) <= SAME_EPISODE_DAYS) {
      if (context.day > out[at].lastDay) out[at].lastDay = context.day;
      out[at].mentions += 1;
      continue;
    }
    out.push({
      ...m,
      buy: orNull(m.buy), stop: orNull(m.stop), target1: orNull(m.target1), target2: orNull(m.target2),
      rs: m.rs != null && Number.isFinite(m.rs) ? m.rs : null,
      id: `${context.day}-${m.symbol}-${m.list}${m.tag ? `-${m.tag}` : ""}`,
      firstDay: context.day, firstAt: context.at, email: context.email, breadth50: context.breadth50, lastDay: context.day, mentions: 1,
    });
    latest.set(key, out.length - 1);
    added += 1;
  }
  return { entries: out, added };
}

export type ScoreState = "no-data" | "too-new" | "open" | "stopped" | "exited";

export interface Score {
  state: ScoreState;
  /** Finished sessions seen since the email. */
  sessions: number;
  /** The stop that was used: the email's own, or 12% under the price when it had none. */
  stop: number | null;
  /** Percent move from the email price to the latest close, or to the exit when the rules already ended it. */
  returnPercent: number | null;
  /** The plain move after 5 and 20 sessions, ignoring the stop; null until that many sessions have passed. */
  ret5: number | null;
  ret20: number | null;
  /** Highest high and lowest low since the email, in percent of the email price (to the exit if there was one). */
  best: number | null;
  worst: number | null;
  hitTarget1: boolean;
  /** Profit or loss in units of the money at risk (price minus stop); live for an open stock. */
  r: number | null;
  exitDay: string | null;
  exitPrice: number | null;
  /** The move over the same days, minus the Nifty 50's move. */
  vsNifty: number | null;
}

const EMPTY: Omit<Score, "state"> = { sessions: 0, stop: null, returnPercent: null, ret5: null, ret20: null, best: null, worst: null, hitTarget1: false, r: null, exitDay: null, exitPrice: null, vsNifty: null };
const pct = (to: number, from: number) => round(((to - from) / from) * 100, 2);

function niftyAt(nifty: ReadonlyArray<Bar>, date: string): number | null {
  let lo = 0;
  let hi = nifty.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nifty[mid].date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : nifty[found].close;
}

/**
 * Follows one entry through the finished daily prices, the way the tested rules would treat a stock bought at the email price: out if a
 * day trades down to the stop (a gap under it exits at the open), or if it closes under its 50-day average. A pre-open email counts the
 * same day's session; an hourly email counts from the next session, because part of that day had already happened. If the stop and a
 * target are both inside one day's range, the stop is assumed to have come first.
 */
export function scoreEntry(entry: RadarEntry, bars: ReadonlyArray<Bar>, nifty: ReadonlyArray<Bar>): Score {
  if (!bars.length) return { ...EMPTY, state: "no-data" };
  const start = bars.findIndex((b) => (entry.email === "pre-open" ? b.date >= entry.firstDay : b.date > entry.firstDay));
  if (start < 0) return { ...EMPTY, state: "too-new" };
  const price = entry.price;
  const stop = entry.stop != null && entry.stop < price ? entry.stop : price * (1 - DEFAULT_STOP_PERCENT / 100);
  const risk = price - stop;
  const closeSum = [0];
  bars.forEach((b, i) => closeSum.push(closeSum[i] + b.close));

  let best = -Infinity;
  let worst = Infinity;
  let hitTarget1 = false;
  let state: ScoreState = "open";
  let exitDay: string | null = null;
  let exitPrice: number | null = null;
  let last = start;
  const smaAt = (j: number) => (j >= 49 ? (closeSum[j + 1] - closeSum[j - 49]) / 50 : null);
  // The exit rule only applies to a stock that was above its 50-day average: one listed while still under it (a bottomed-out or scanner
  // idea) is not "exited" on day one, it simply has to get above the line first.
  const before = start > 0 ? smaAt(start - 1) : null;
  let armed = before == null || bars[start - 1].close >= before;
  for (let j = start; j < bars.length; j += 1) {
    const bar = bars[j];
    last = j;
    best = Math.max(best, bar.high);
    worst = Math.min(worst, bar.low);
    if (bar.low <= stop) {
      state = "stopped";
      exitDay = bar.date;
      exitPrice = Math.min(bar.open, stop);
      worst = Math.min(worst, exitPrice);
      break;
    }
    if (entry.target1 != null && bar.high >= entry.target1) hitTarget1 = true;
    const sma50 = smaAt(j);
    if (sma50 != null && bar.close >= sma50) armed = true;
    if (armed && sma50 != null && bar.close < sma50) {
      state = "exited";
      exitDay = bar.date;
      exitPrice = bar.close;
      break;
    }
  }
  const sessions = last - start + 1;
  // The plain price move after 5 and 20 sessions, whatever the stop did: it answers "was the call right", not "did the rules survive".
  const at = (n: number) => (start + n - 1 < bars.length ? pct(bars[start + n - 1].close, price) : null);
  const endPrice = exitPrice ?? bars[last].close;
  const niftyNow = niftyAt(nifty, bars[last].date);
  const niftyThen = niftyAt(nifty, start > 0 ? bars[start - 1].date : bars[start].date);
  return {
    state,
    sessions,
    stop: round(stop),
    returnPercent: pct(endPrice, price),
    ret5: at(5),
    ret20: at(20),
    best: pct(best, price),
    worst: pct(worst, price),
    hitTarget1,
    r: risk > 0 ? round((endPrice - price) / risk, 2) : null,
    exitDay,
    exitPrice: exitPrice != null ? round(exitPrice) : null,
    vsNifty: niftyNow != null && niftyThen != null ? round(pct(endPrice, price) - pct(niftyNow, niftyThen), 2) : null,
  };
}

export interface GroupSummary {
  key: string;
  label: string;
  /** Entries in the group. */
  count: number;
  /** Entries with at least one finished session since the email. */
  scored: number;
  open: number;
  stopped: number;
  exited: number;
  /** Share of finished trades (stopped or exited) that made money, in percent; null with none finished. */
  winRate: number | null;
  /** Average R of finished trades. */
  avgR: number | null;
  /** Average move so far over all scored entries, open or not. */
  avgReturn: number | null;
  avgRet5: number | null;
  avgRet20: number | null;
  avgVsNifty: number | null;
  /** Share of scored entries that reached the first target before the stop. */
  hitTarget1: number | null;
  /** Share of scored entries that were stopped out. */
  stopRate: number | null;
  /** False with fewer scored entries than ENOUGH: the numbers are too few to judge by. */
  enough: boolean;
}

const mean = (values: ReadonlyArray<number | null>): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null;
};

export function groupLabel(entry: Pick<Mention, "list" | "tag">): string {
  const base = LIST_LABEL[entry.list];
  return entry.list === "top-picks" && entry.tag ? `${base} · ${TAG_LABEL[entry.tag] ?? entry.tag}` : base;
}

export function summarise(items: ReadonlyArray<{ entry: RadarEntry; score: Score }>, keyOf: (entry: RadarEntry) => { key: string; label: string }): GroupSummary[] {
  const groups = new Map<string, { label: string; items: Array<{ entry: RadarEntry; score: Score }> }>();
  for (const item of items) {
    const { key, label } = keyOf(item.entry);
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { label, items: list }]) => {
    const scored = list.filter((i) => i.score.state !== "no-data" && i.score.state !== "too-new");
    const finished = scored.filter((i) => i.score.state === "stopped" || i.score.state === "exited");
    const share = (n: number, of: number) => (of ? round((n / of) * 100, 1) : null);
    return {
      key, label,
      count: list.length,
      scored: scored.length,
      open: scored.filter((i) => i.score.state === "open").length,
      stopped: scored.filter((i) => i.score.state === "stopped").length,
      exited: scored.filter((i) => i.score.state === "exited").length,
      winRate: share(finished.filter((i) => (i.score.r ?? 0) > 0).length, finished.length),
      avgR: mean(finished.map((i) => i.score.r)),
      avgReturn: mean(scored.map((i) => i.score.returnPercent)),
      avgRet5: mean(scored.map((i) => i.score.ret5)),
      avgRet20: mean(scored.map((i) => i.score.ret20)),
      avgVsNifty: mean(scored.map((i) => i.score.vsNifty)),
      hitTarget1: share(scored.filter((i) => i.score.hitTarget1).length, scored.length),
      stopRate: share(scored.filter((i) => i.score.state === "stopped").length, scored.length),
      enough: scored.length >= ENOUGH,
    };
  }).sort((a, b) => b.count - a.count);
}
