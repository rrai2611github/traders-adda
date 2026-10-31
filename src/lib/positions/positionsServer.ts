import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner } from "@/lib/alerts/personal";
import sectorData from "@/lib/market/data/sectors.json";
import { historyLastDay } from "../backtest/historyRefresh.ts";
import {
  actionLines, assessHolding, backupsToDelete, closedTrades, fillSummary, holdingsCsv, istToday, NEEDS_ACTION, parseNewHolding, parseSale, sectorConcentration, summariseJournal,
  type Assessment, type Candle, type ClosedTrade, type FillSummary, type Holding, type Journal, type SectorCrowd,
} from "./positions.ts";

const DIR = join(process.cwd(), ".cache");
const FILE = join(DIR, "positions.json");
const NOTE_FILE = join(DIR, "positions-note.json");
const HISTORY = join(DIR, "history10y");
const MAX_HOLDINGS = 500;
const BACKUPS = join(DIR, "backups");
const KEEP_BACKUPS = 30;

function readAll(): Holding[] {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { holdings?: Holding[] };
    return Array.isArray(parsed.holdings) ? parsed.holdings : [];
  } catch {
    return [];
  }
}

/** Written to a temporary file first, so a crash cannot leave half a file behind. */
function writeAll(holdings: Holding[]) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, holdings }, null, 1));
  renameSync(tmp, FILE);
  backUp();
}

/** One copy a day (the day's last save), the newest 30 kept. A backup problem never blocks a save. */
function backUp() {
  try {
    mkdirSync(BACKUPS, { recursive: true });
    copyFileSync(FILE, join(BACKUPS, `positions-${istToday()}.json`));
    for (const old of backupsToDelete(readdirSync(BACKUPS), KEEP_BACKUPS)) unlinkSync(join(BACKUPS, old));
  } catch (error) {
    console.error("[positions] backup failed:", error instanceof Error ? error.message : error);
  }
}

/** The whole record as a spreadsheet file. */
export function positionsCsv(): string {
  return holdingsCsv(readAll());
}

/** The last 80 daily candles for a stock from the saved price files; empty if the stock has no file. */
export function recentCandles(symbol: string): Candle[] {
  try {
    const rows = (JSON.parse(readFileSync(join(HISTORY, `${encodeURIComponent(symbol)}.json`), "utf8")) as { c: number[][] }).c;
    return rows.slice(-80).map((r) => ({ date: new Date(r[0] + 19_800_000).toISOString().slice(0, 10), low: r[3], close: r[4] }));
  } catch {
    return [];
  }
}

/** The saved sector of a stock (scripts/build-sectors.mjs rebuilds the file); null when unknown. */
export const sectorOf = (symbol: string): string | null => (sectorData.sectors as Record<string, string>)[symbol] ?? null;

export interface PositionsView {
  /** Latest trading day in the price files. */
  lastDay: string | null;
  open: Array<{ holding: Holding; assessment: Assessment; sector: string | null }>;
  /** Sectors holding more open positions than the limit. */
  crowded: SectorCrowd[];
  /** How close the real buys were to the planned prices, over every position that had a plan. */
  fills: FillSummary;
  closed: ClosedTrade[];
  journal: Journal;
  /** Money in open positions at the last close, their gain or loss, and what is lost if every stop is hit from here. */
  exposure: { invested: number; openPnl: number; ifAllStopsHit: number };
}

export function positionsView(now = Date.now()): PositionsView {
  const all = readAll();
  const open = all
    .filter((h) => !h.sold)
    .sort((a, b) => b.buyDate.localeCompare(a.buyDate))
    .map((holding) => ({ holding, assessment: assessHolding(holding, recentCandles(holding.symbol), now), sector: sectorOf(holding.symbol) }));
  const closed = closedTrades(all);
  let invested = 0;
  let openPnl = 0;
  let ifAllStopsHit = 0;
  for (const { holding: h, assessment: a } of open) {
    const last = a.last ?? h.buyPrice;
    invested += last * h.qty;
    openPnl += a.pnl ?? 0;
    ifAllStopsHit += Math.min(0, (h.stop - last) * h.qty);
  }
  return { lastDay: historyLastDay(), open, crowded: sectorConcentration(open.map((o) => ({ symbol: o.holding.symbol, sector: o.sector }))), fills: fillSummary(all), closed: closed.slice(0, 200), journal: summariseJournal(closed), exposure: { invested, openPnl, ifAllStopsHit } };
}

export type Result = { ok: true; view: PositionsView } | { ok: false; error: string; status: number };

export function addHolding(input: Record<string, unknown>, now = Date.now()): Result {
  const parsed = parseNewHolding(input, now);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const all = readAll();
  if (all.length >= MAX_HOLDINGS) return { ok: false, error: "Too many saved positions. Remove old closed ones first.", status: 400 };
  writeAll([...all, { id: crypto.randomUUID(), ...parsed.value }]);
  return { ok: true, view: positionsView(now) };
}

export function markSold(id: unknown, input: Record<string, unknown>, now = Date.now()): Result {
  const all = readAll();
  const holding = all.find((h) => h.id === id);
  if (!holding) return { ok: false, error: "That position was not found.", status: 404 };
  const parsed = parseSale(input, holding, now);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  writeAll(all.map((h) => (h.id === id ? { ...h, sold: parsed.value } : h)));
  return { ok: true, view: positionsView(now) };
}

export function removeHolding(id: unknown, now = Date.now()): Result {
  const all = readAll();
  if (!all.some((h) => h.id === id)) return { ok: false, error: "That position was not found.", status: 404 };
  writeAll(all.filter((h) => h.id !== id));
  return { ok: true, view: positionsView(now) };
}

export const hasOpenPositions = () => readAll().some((h) => !h.sold);

function lastKey(): string | null {
  try { return JSON.parse(readFileSync(NOTE_FILE, "utf8")).key ?? null; } catch { return null; }
}

/**
 * After the close, once the price files are fresh: emails the owner (PERSONAL_ALERT_EMAIL only, never the group list) when an open
 * position has hit its stop or closed under its 50-day average. Silent when every position is fine. Once per day per set of alerts.
 */
export async function sendPositionsNoteIfDue(now = Date.now()): Promise<void> {
  const view = positionsView(now);
  const lines = actionLines(view.open);
  if (lines.length === 0 || !view.lastDay) return;
  const key = `${view.lastDay}|${view.open.filter((i) => NEEDS_ACTION.has(i.assessment.status)).map((i) => `${i.holding.id}:${i.assessment.status}`).sort().join(",")}`;
  if (lastKey() === key) return;
  const count = view.open.filter((i) => NEEDS_ACTION.has(i.assessment.status)).length;
  const sent = await notifyOwner(`My positions · ${count} need${count === 1 ? "s" : ""} a decision · ${view.lastDay}`, lines);
  if (!sent) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(NOTE_FILE, JSON.stringify({ key }));
}
