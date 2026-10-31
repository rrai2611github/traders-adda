import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sectorData from "@/lib/market/data/sectors.json";
import type { AlertTable } from "../alerts/scannerAlert.ts";
import type { TopPickEmailItem } from "../alerts/topPicksEmail.ts";
import type { Top5Pick } from "../screen/weeklyTop5.ts";
import { historyLastDay } from "../backtest/historyRefresh.ts";
import { istDateKey } from "../market/marketHours.ts";
import { groupLabel, recordMentions, scoreEntry, summarise, type Bar, type EmailKind, type GroupSummary, type Mention, type RadarEntry, type Score } from "./radar.ts";

const DIR = join(process.cwd(), ".cache");
const FILE = join(DIR, "email-picks.json");
const BACKUPS = join(DIR, "backups");
const HISTORY = join(DIR, "history10y");
const KEEP_BACKUPS = 30;
const MAX_ROWS = 600;

const sectorOf = (symbol: string): string | null => (sectorData.sectors as Record<string, string>)[symbol] ?? null;

/** The last email that was recorded, so the page can show that recording is working. */
export interface LastRecorded { at: number; email: EmailKind; listed: number; added: number }

function readMeta(): LastRecorded | null {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { last?: LastRecorded };
    return parsed.last && Number.isFinite(parsed.last.at) ? parsed.last : null;
  } catch {
    return null;
  }
}

function readAll(): RadarEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { entries?: RadarEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Written to a temporary file first, so a crash cannot leave half a file behind; one backup copy a day, the newest 30 kept. */
function writeAll(entries: RadarEntry[], day: string, last: LastRecorded) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, last, entries }, null, 1));
  renameSync(tmp, FILE);
  try {
    mkdirSync(BACKUPS, { recursive: true });
    copyFileSync(FILE, join(BACKUPS, `email-picks-${day}.json`));
    const dated = readdirSync(BACKUPS).filter((n) => /^email-picks-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const old of dated.slice(0, Math.max(0, dated.length - KEEP_BACKUPS))) unlinkSync(join(BACKUPS, old));
  } catch (error) {
    console.error("[radar] backup failed:", error instanceof Error ? error.message : error);
  }
}

const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);

/** Every stock one email listed, in the order the email showed them. */
export function mentionsFromEmail(table: AlertTable, topPicks: ReadonlyArray<TopPickEmailItem> | null, top5: ReadonlyArray<Top5Pick> | null): Mention[] {
  const out: Mention[] = [];
  const base = (symbol: string, name: string | null | undefined) => ({ symbol, name: name || symbol, sector: sectorOf(symbol) });
  (topPicks ?? []).forEach((p, i) => {
    const plan = p.analysis?.plan;
    out.push({ ...base(p.symbol, p.name), sector: p.sector ?? sectorOf(p.symbol), list: "top-picks", tag: p.tag, price: p.price, rs: num(p.rs), buy: plan?.buy ?? null, stop: plan?.stop ?? null, target1: plan?.targets?.t1 ?? null, target2: plan?.targets?.t2 ?? null, rank: i + 1 });
  });
  // The pre-open email shows the Weekly Top 5 block only when it has no Top picks list, so only then was it given out.
  (topPicks ? [] : top5 ?? []).forEach((p, i) => {
    out.push({ ...base(p.symbol, p.name), sector: p.sector ?? sectorOf(p.symbol), list: "weekly-top5", tag: null, price: p.close, rs: num(p.rs), buy: p.close, stop: p.stop, target1: p.target, target2: null, rank: i + 1 });
  });
  table.rows.slice(0, 10).forEach((r, i) => {
    out.push({ ...base(r.symbol, r.name), list: "buy-list", tag: null, price: r.close, rs: num(r.rs), buy: r.entry, stop: r.stop, target1: r.target1, target2: r.target2, rank: i + 1 });
  });
  (table.watch ?? []).slice(0, 5).forEach((r, i) => {
    out.push({ ...base(r.symbol, r.name), list: "watch", tag: null, price: r.close, rs: num(r.rs), buy: r.entry, stop: r.stop, target1: r.target1, target2: r.target2, rank: i + 1 });
  });
  (table.bullConfluence ?? []).forEach((c, i) => {
    out.push({ ...base(c.symbol, c.name), list: "confluence", tag: null, price: c.price, rs: num(c.rs), buy: c.plan?.entry ?? null, stop: c.plan?.stop ?? null, target1: c.plan?.target1 ?? null, target2: c.plan?.target2 ?? null, rank: i + 1 });
  });
  (table.bottomedOut ?? []).forEach((b, i) => {
    out.push({ ...base(b.symbol, b.name), list: "bottomed", tag: null, price: b.close, rs: null, buy: null, stop: null, target1: null, target2: null, rank: i + 1 });
  });
  return out;
}

/**
 * Saves the stocks an email that has just gone to the recipients listed. It never throws: a problem here must not turn a sent email
 * into an error, so a failure is only logged. Test emails are never recorded (callers only use this after a real send).
 */
export function recordEmailedStocks(email: EmailKind, table: AlertTable, topPicks: ReadonlyArray<TopPickEmailItem> | null, top5: ReadonlyArray<Top5Pick> | null, now = Date.now()): number {
  try {
    const day = istDateKey(now);
    const mentions = mentionsFromEmail(table, topPicks, top5);
    const { entries, added } = recordMentions(readAll(), mentions, { day, at: now, email, breadth50: num(table.breadth) });
    writeAll(entries, day, { at: now, email, listed: mentions.length, added });
    return added;
  } catch (error) {
    console.error("[radar] could not record the emailed stocks:", error instanceof Error ? error.message : error);
    return 0;
  }
}

function loadBars(symbol: string): Bar[] {
  try {
    const rows = (JSON.parse(readFileSync(join(HISTORY, `${encodeURIComponent(symbol)}.json`), "utf8")) as { c: number[][] }).c;
    return rows.map((r) => ({ date: new Date(r[0] + 19_800_000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4] }));
  } catch {
    return [];
  }
}

export interface RadarRow { entry: RadarEntry; score: Score }

export interface RadarView {
  /** Latest trading day in the price files. */
  lastDay: string | null;
  total: number;
  /** The most recent email that was recorded; null before the first one. */
  lastRecorded: LastRecorded | null;
  firstDay: string | null;
  rows: RadarRow[];
  overall: GroupSummary | null;
  /** One row per list (Top picks split by tag). */
  groups: GroupSummary[];
  /** Top picks and the older Buy ready list split by the market check at the time of the email. */
  byMarket: GroupSummary[];
}

export function radarView(): RadarView {
  const entries = readAll();
  const nifty = loadBars("NIFTY50");
  const cache = new Map<string, Bar[]>();
  const bars = (symbol: string) => cache.get(symbol) ?? (cache.set(symbol, loadBars(symbol)), cache.get(symbol)!);
  const all: RadarRow[] = entries.map((entry) => ({ entry, score: scoreEntry(entry, bars(entry.symbol), nifty) }));
  const everything = summarise(all, () => ({ key: "all", label: "All emailed stocks" }))[0] ?? null;
  const groups = summarise(all, (e) => ({ key: `${e.list}|${e.tag ?? ""}`, label: groupLabel(e) }));
  // The 35% market check is the buy rule, so the useful split is: email sent with it open, or closed.
  const buyable = all.filter((r) => r.entry.list === "top-picks" && (r.entry.tag === "ready" || r.entry.tag === "broke"));
  const byMarket = summarise(buyable, (e) => (e.breadth50 == null ? { key: "unknown", label: "Ready or just broke out · market check unknown" } : e.breadth50 >= 35 ? { key: "open", label: "Ready or just broke out · market check open (35%+)" } : { key: "closed", label: "Ready or just broke out · market check closed (under 35%)" }));
  const sorted = [...all].sort((a, b) => b.entry.firstAt - a.entry.firstAt).slice(0, MAX_ROWS);
  return {
    lastDay: historyLastDay(),
    total: entries.length,
    lastRecorded: readMeta(),
    firstDay: entries.length ? entries.reduce((min, e) => (e.firstDay < min ? e.firstDay : min), entries[0].firstDay) : null,
    rows: sorted,
    overall: everything,
    groups,
    byMarket,
  };
}
