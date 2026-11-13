import { SAME_EPISODE_DAYS, dayDiff, scoreEntry, type Bar, type EmailKind, type RadarEntry, type ScoreState } from "./radar.ts";

/**
 * The first call on a Top pick. A stock can sit on the Top picks list for days while its price, buy level and stop move every day, so the
 * list on its own cannot say what was first called, or how that call has done since. The email track record already saves each stock the
 * first time it is listed under a tag ("a stock whose tag changes is a new call"), with the price and plan as they were. This reads those
 * records and answers: since when has the stock been on the list, and what was the first buyable call (Ready, or Just broke out) that is
 * still alive?
 *
 * A stock listed only as Watch or Extended has no buy call: those are waiting lists. A call ends when a later session trades down to its
 * stop or closes under the 50-day average (the same rules `scoreEntry` applies); a later buyable listing then starts a new call.
 */
export interface FirstCall {
  day: string;
  tag: "ready" | "broke";
  /** The reference buy: the plan's buy level, or the listed price when the plan had none. */
  buy: number;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  /** The price at the time of the listing. */
  price: number;
  rs: number | null;
  email: EmailKind;
  mentions: number;
  breadth50: number | null;
}

export interface PickCall {
  symbol: string;
  /** First day on the Top picks list in the current run of appearances, under any tag. */
  onListSince: string;
  firstTag: string | null;
  /** The earliest buyable call that is still alive; null when the stock has only been a Watch/Extended listing, or every call ended. */
  call: FirstCall | null;
  state: ScoreState | null;
  /** Finished sessions since the call. */
  sessions: number;
  /** Move from the call's listed price to the latest finished close. */
  returnPercent: number | null;
  /** Earlier buyable calls in this run that already hit their stop or exit rule. */
  endedCalls: number;
}

const isBuyable = (e: RadarEntry): e is RadarEntry & { tag: "ready" | "broke" } => e.tag === "ready" || e.tag === "broke";

/** The entries of one stock's latest run of appearances: each starts within the same-episode window of the last one's end. */
export function currentRun(entries: ReadonlyArray<RadarEntry>): RadarEntry[] {
  const sorted = [...entries].sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.firstAt - b.firstAt);
  const run: RadarEntry[] = [];
  let runEnd = "";
  for (const entry of sorted) {
    if (run.length && dayDiff(entry.firstDay, runEnd) > SAME_EPISODE_DAYS) { run.length = 0; runEnd = ""; }
    run.push(entry);
    if (entry.lastDay > runEnd) runEnd = entry.lastDay;
  }
  return run;
}

export function pickCallFor(entries: ReadonlyArray<RadarEntry>, bars: ReadonlyArray<Bar>, nifty: ReadonlyArray<Bar>): PickCall | null {
  const mine = entries.filter((e) => e.list === "top-picks");
  if (!mine.length) return null;
  const run = currentRun(mine);
  const buyable = run.filter(isBuyable);
  let ended = 0;
  let found: { entry: RadarEntry & { tag: "ready" | "broke" }; score: ReturnType<typeof scoreEntry> } | null = null;
  for (const entry of buyable) {
    const score = scoreEntry(entry, bars, nifty);
    if (score.state === "stopped" || score.state === "exited") { ended += 1; continue; }
    found = { entry, score };
    break;
  }
  return {
    symbol: run[0].symbol,
    onListSince: run[0].firstDay,
    firstTag: run[0].tag,
    call: found ? {
      day: found.entry.firstDay, tag: found.entry.tag, buy: found.entry.buy ?? found.entry.price, stop: found.entry.stop, target1: found.entry.target1,
      target2: found.entry.target2, price: found.entry.price, rs: found.entry.rs, email: found.entry.email, mentions: found.entry.mentions, breadth50: found.entry.breadth50,
    } : null,
    state: found?.score.state ?? null,
    sessions: found?.score.sessions ?? 0,
    returnPercent: found?.score.returnPercent ?? null,
    endedCalls: ended,
  };
}

/** One result per stock that was on the Top picks list within the last `SAME_EPISODE_DAYS` days of `today`. */
export function pickCalls(
  entries: ReadonlyArray<RadarEntry>,
  barsFor: (symbol: string) => ReadonlyArray<Bar>,
  nifty: ReadonlyArray<Bar>,
  today: string,
): Record<string, PickCall> {
  const bySymbol = new Map<string, RadarEntry[]>();
  for (const entry of entries) if (entry.list === "top-picks") (bySymbol.get(entry.symbol) ?? bySymbol.set(entry.symbol, []).get(entry.symbol)!).push(entry);
  const out: Record<string, PickCall> = {};
  for (const [symbol, list] of bySymbol) {
    if (!list.some((e) => dayDiff(today, e.lastDay) <= SAME_EPISODE_DAYS)) continue;
    const call = pickCallFor(list, barsFor(symbol), nifty);
    if (call) out[symbol] = call;
  }
  return out;
}

export type CallProgressKey = "stop" | "in-zone" | "past-zone" | "target1" | "target2";

export interface CallProgress {
  key: CallProgressKey;
  label: string;
  /** Percent move from the call's buy level to `price`. */
  changePercent: number;
  tone: "good" | "warn" | "bad" | "info";
}

/**
 * Where a live price stands against a first call, in plain words. "Past the buy zone" means the stock has run more than `zonePercent`
 * above the call's buy level: someone who missed the call should wait for a pullback, not chase.
 */
export function callProgress(call: Pick<FirstCall, "buy" | "stop" | "target1" | "target2">, price: number, zonePercent = 5): CallProgress | null {
  if (!(call.buy > 0) || !(price > 0)) return null;
  const changePercent = Math.round(((price / call.buy) - 1) * 10000) / 100;
  if (call.stop != null && price <= call.stop) return { key: "stop", label: "At or under the call's stop", changePercent, tone: "bad" };
  if (call.target2 != null && price >= call.target2) return { key: "target2", label: "Target 2 reached", changePercent, tone: "good" };
  if (call.target1 != null && price >= call.target1) return { key: "target1", label: "Target 1 reached", changePercent, tone: "good" };
  if (changePercent > zonePercent) return { key: "past-zone", label: `More than ${zonePercent}% above the call: don't chase`, changePercent, tone: "warn" };
  return { key: "in-zone", label: changePercent < 0 ? "Below the call's buy level" : "Still near the call's buy level", changePercent, tone: "info" };
}

/** "12 Nov": a short day label for a YYYY-MM-DD date. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
}

/** Adds each pick's first call (or null) to a list of picks, leaving the picks themselves unchanged. */
export function attachFirstCalls<T extends { symbol: string }>(picks: ReadonlyArray<T>, calls: Readonly<Record<string, PickCall>>): (T & { firstCall: PickCall | null })[] {
  return picks.map((p) => ({ ...p, firstCall: calls[p.symbol] ?? null }));
}
