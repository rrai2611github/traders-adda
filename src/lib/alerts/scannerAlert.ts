import type { SectorHeatLine } from "../screen/sectorHeatmap.ts";
import type { EntryState } from "./entryState.ts";
import type { PriceSource } from "./liveOverlay.ts";
import type { BottomedOutPick } from "../screen/bottomedOut.ts";
import { ALERT_SCANNER_KEYS, SCANNERS, type ExtraPick, type ExtraSection, type ScannerKey, type ScannerPayload, type ScannerRow } from "../screen/chartinkScans.ts";
import type { BuyCheckKey, ScannerPlan } from "../screen/buyReady.ts";
import { BUY_READY_RULES } from "../screen/buyReady.ts";
import { HEALTHY_BREADTH_PERCENT } from "../screen/breadth.ts";
import { escapeHtml } from "./telegram.ts";
import { ALERT_BRAND } from "./brand.ts";
import { scannerBuyingStatus } from "../screen/buyingStatus.ts";
import { TRADE_STATUS, type TradeStatusKey } from "../screen/tradeStatus.ts";
import { paBrief, paText, type PaBrief } from "../screen/priceActionRating.ts";
import { EXTRA_SOURCES, extraPickStatus, todaysPicks } from "../screen/todaysPicks.ts";
import type { ConfluenceIdea } from "./hourlyConfluence.ts";

export { ALERT_BRAND };

const pickStatus = (key: TradeStatusKey): PickStatus => (key === "buy-ready" ? "buy" : key === "watch" ? "watch" : "weak");

export interface AlertPick {
  row: ScannerRow;
  scanners: ScannerKey[];
}

export interface BacktestLine {
  from: string;
  to: string;
  trades: number;
  winRate: number;
  avgR: number;
  costPercent?: number;
  /** The later out-of-sample half of the test period. */
  recent?: { from: string; trades: number; avgR: number };
}

/** Below this average gain per trade, the footer says plainly that there is no proven edge. */
export const PROVEN_EDGE_R = 0.1;

const signedR = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;

/** Plain-language backtest summary shared by the Telegram message, the hourly email and the pre-open email. */
export function backtestSentence(bt: BacktestLine): string {
  const cost = bt.costPercent != null ? ` after ${bt.costPercent}% costs` : " after costs";
  const recent = bt.recent ? ` (since ${bt.recent.from}: ${signedR(bt.recent.avgR)} over ${bt.recent.trades.toLocaleString("en-IN")} trades)` : "";
  const verdict = bt.avgR < PROVEN_EDGE_R
    ? " No proven edge yet: treat these as research ideas and keep position sizes small."
    : "";
  return `Backtest ${bt.from} → ${bt.to}, Buy ready rules with this T1/T2 exit plan: ${bt.trades.toLocaleString("en-IN")} trades · ` +
    `${bt.winRate}% winners · avg ${signedR(bt.avgR)} per trade${cost}${recent}.${verdict}`;
}

/**
 * One entry per stock across scanners, highest RS first. RS is the only score
 * that separated winners from losers in the backtest (RS 90+ −0.02R against
 * RS < 50 −0.19R); scanner overlap and oscillator score did not.
 */
export function alertPicks(payload: ScannerPayload, level: "buyReady" | "setupReady"): AlertPick[] {
  const bySymbol = new Map<string, AlertPick>();
  for (const key of ALERT_SCANNER_KEYS) {
    for (const row of payload.results[key]) {
      if (!row.readiness[level] || !row.readiness.plan) continue;
      const pick = bySymbol.get(row.symbol);
      if (pick) pick.scanners.push(key);
      else bySymbol.set(row.symbol, { row, scanners: [key] });
    }
  }
  return [...bySymbol.values()].sort((a, b) =>
    (b.row.rs ?? 0) - (a.row.rs ?? 0) || b.scanners.length - a.scanners.length);
}

const tier = (r: ScannerRow) => (r.readiness.buyReady ? 2 : r.readiness.setupReady ? 1 : 0);
/** Checks passed only orders stocks that fail some; ready stocks all pass the same set. */
const closeness = (r: ScannerRow) => (tier(r) ? 0 : r.readiness.passed);

/**
 * The best hit of one scanner: Buy ready first, then ready-except-breadth, then
 * (for the rest) most checks passed, then highest RS. A stock already shown for
 * an earlier scanner is skipped when another candidate of the same quality exists.
 */
export function topScannerPick(rows: ScannerRow[], shown: ReadonlySet<string>): ScannerRow | null {
  const ranked = rows
    .filter((r) => r.passesFloor && r.readiness.plan)
    .sort((a, b) => tier(b) - tier(a) || closeness(b) - closeness(a) || (b.rs ?? -1) - (a.rs ?? -1));
  if (!ranked.length) return null;
  const best = ranked[0];
  return ranked.find((r) => !shown.has(r.symbol) && tier(r) === tier(best) && closeness(r) === closeness(best)) ?? best;
}

const CHECK_SHORT: Record<BuyCheckKey, string> = {
  breadth: "breadth",
  liquid: "liquidity",
  rs: `RS < ${BUY_READY_RULES.minRs}`,
  score: `oscillator < ${BUY_READY_RULES.minScore}`,
  trend: "below 50/200 DMA",
  notExtended: "extended from 21 EMA",
  risk: `SL > ${BUY_READY_RULES.maxRiskPercent}%`,
  pattern: "pattern check",
};

const RULE = "━━━━━━━━━━━━━━━━";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
const dateLabel = (t: number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(t);

/** "SKY GOLD AND DIAMONDS LIMITED" → "Sky Gold And Diamonds". */
export function shortName(name: string): string {
  const trimmed = name.replace(/\s+(limited|ltd\.?)$/i, "").trim();
  // Single-word upper-case names are usually acronyms (NTPC, ITC).
  if (trimmed !== trimmed.toUpperCase() || !trimmed.includes(" ")) return trimmed;
  return trimmed.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function stockLine(symbol: string, name: string, close: number, change: number | null): string {
  return `<b>${escapeHtml(symbol)}</b> · ${escapeHtml(shortName(name))} · ${inr(close)}${change != null ? ` (${pct(change, 2)})` : ""}`;
}

function planLines(p: ScannerPlan): string[] {
  const vs = (v: number) => pct(((v - p.entry) / p.entry) * 100);
  return [
    `▶️ Buy above <b>${inr(p.entry)}</b> <i>(skip above ${inr(p.buyZoneHigh)})</i>`,
    `🛑 SL <b>${inr(p.stop)}</b> (−${p.riskPercent.toFixed(1)}%)${p.riskPercent > BUY_READY_RULES.maxRiskPercent ? " ⚠️ wide, size down" : ""}`,
    `🎯 T1 <b>${inr(p.target1)}</b> (${vs(p.target1)}) · T2 <b>${inr(p.target2)}</b> (${vs(p.target2)})`,
  ];
}

const metrics = (rs: number | null, score: number | null, pa: PaBrief | null) =>
  [rs != null ? `RS ${rs}` : null, pa ? `PA ${paText(pa)}` : null, score != null ? `Osc ${score.toFixed(1)}/15` : null].filter(Boolean).join(" · ");

function scannerBlock(n: number, key: ScannerKey, rows: ScannerRow[], pick: ScannerRow, healthy: boolean): string {
  const liquid = rows.filter((r) => r.passesFloor);
  const ready = liquid.filter((r) => r.readiness.buyReady).length;
  const setup = liquid.filter((r) => r.readiness.setupReady).length;
  const hits = plural(liquid.length, "hit");
  const counts = healthy ? `${ready} buy-ready / ${hits}` : `${setup} ready (ex-breadth) / ${hits}`;
  const head = `<b>${n}. ${escapeHtml(SCANNERS[key].menuLabel)}</b> · <i>${counts}</i>`;
  const r = pick.readiness;
  const failed = r.checks.filter((c) => !c.pass && c.key !== "breadth").map((c) => CHECK_SHORT[c.key]);
  const status = statusLine(scannerBuyingStatus(r).key, failed);
  return [
    head,
    stockLine(pick.symbol, pick.name, pick.close, pick.changePercent),
    `${status}${metrics(pick.rs, pick.score, paBrief(pick.paRating)) ? ` · ${metrics(pick.rs, pick.score, paBrief(pick.paRating))}` : ""}`,
    ...planLines(r.plan!),
  ].join("\n");
}

/** Labels of the Buy ready checks an RPCI/Oscillator pick fails; picks from an older cache without the gate count as unchecked. */
function extraFailures(pick: ExtraPick): string[] {
  return pick.failed ? pick.failed.map((k) => CHECK_SHORT[k]) : ["checks unavailable"];
}

/** Prefers a pick that passes the Buy ready checks and was not already shown for another scanner. */
function extraPick(section: ExtraSection | undefined, shown: ReadonlySet<string>): ExtraPick | null {
  const list = section?.top ?? [];
  const gated = list.filter((p) => !extraFailures(p).length);
  const pool = [...gated, ...list.filter((p) => extraFailures(p).length)];
  return pool.find((p) => !shown.has(p.symbol)) ?? pool[0] ?? null;
}

function statusLine(key: TradeStatusKey, failed: string[]): string {
  const meta = TRADE_STATUS[key];
  const why = key === "watch" ? ": waiting for market breadth"
    : key === "extended" ? ": past the buy zone, don't chase"
    : key === "avoid" ? `: fails ${escapeHtml(failed.join(", "))}`
    : "";
  return `${meta.emoji} <b>${meta.label}</b>${why}`;
}

function extraBlock(n: number, title: string, section: ExtraSection | undefined, pick: ExtraPick, healthy: boolean): string {
  const head = `<b>${n}. ${title}</b> · <i>${plural(section?.total ?? 0, "set-up")}</i>`;
  const status = statusLine(extraPickStatus(pick, healthy), extraFailures(pick));
  return [
    head,
    stockLine(pick.symbol, pick.name, pick.close, pick.changePercent),
    `${status}${metrics(pick.rs, pick.score, pick.pa ?? null) ? ` · ${metrics(pick.rs, pick.score, pick.pa ?? null)}` : ""}`,
    `ℹ️ ${escapeHtml(pick.note)}`,
    ...planLines(pick.plan),
  ].join("\n");
}

/** Telegram HTML message, picks numbered 1, 2, 3…: the top stock of every scanner plus RPCI and Oscillator, for the latest completed session. */
export function buildScannerAlert(payload: ScannerPayload, backtest: BacktestLine | null): string {
  const breadth = payload.breadth.percent;
  const healthy = breadth != null && breadth >= HEALTHY_BREADTH_PERCENT;
  const day = payload.candleTimestamp ? dateLabel(payload.candleTimestamp) : payload.sessionDateKey;
  const today = todaysPicks(payload);

  const header = [
    `📊 <b>${escapeHtml(ALERT_BRAND)} · Daily Scanner Picks</b>`,
    `🗓 ${day} · ${payload.scanned.toLocaleString("en-IN")} NSE stocks scanned`,
    `🌡 Market breadth <b>${breadth ?? "—"}%</b> ${healthy ? "✅ healthy" : `⚠️ weak (below ${HEALTHY_BREADTH_PERCENT}%)`}`,
    healthy
      ? `🟢 Buy ready: <b>${today.buyReadyTotal}</b> ${today.buyReadyTotal === 1 ? "stock" : "stocks"} across the email sources`
      : `🔵 No new buys. <b>${today.watchTotal}</b> strong ${today.watchTotal === 1 ? "stock" : "stocks"} waiting for the market.`,
  ].join("\n");

  const shown = new Set<string>();
  const picks: string[] = [];
  const empty: string[] = [];
  for (const key of ALERT_SCANNER_KEYS) {
    const pick = topScannerPick(payload.results[key], shown);
    if (!pick) { empty.push(SCANNERS[key].menuLabel); continue; }
    shown.add(pick.symbol);
    picks.push(scannerBlock(picks.length + 1, key, payload.results[key], pick, healthy));
  }
  for (const { key, label: title } of EXTRA_SOURCES) {
    const section = payload.extras?.[key];
    const pick = extraPick(section, shown);
    if (!pick) { empty.push(title); continue; }
    shown.add(pick.symbol);
    picks.push(extraBlock(picks.length + 1, title, section, pick, healthy));
  }
  const blocks: string[] = [header, RULE, ...picks];
  if (!picks.length) blocks.push("No scanner produced a liquid stock with a valid plan today.");
  if (empty.length) blocks.push(`▫️ <i>No pick today: ${empty.map(escapeHtml).join(", ")}</i>`);
  blocks.push(RULE);

  const footer: string[] = [];
  if (backtest) footer.push(`📈 ${escapeHtml(backtestSentence(backtest))}`);
  footer.push(
    "📝 Buy only if price trades above the trigger; skip gap-ups past the limit. Book half at T1, trail SL to cost.",
    "⚠️ No sure shots. Risk ≤1% of capital per trade.",
    "<i>Rule-based personal alert, not investment advice. Check the chart before acting.</i>",
  );
  blocks.push(footer.join("\n"));
  return blocks.join("\n\n");
}

export type PickStatus = "buy" | "watch" | "weak";

export interface AlertTableRow {
  n: number;
  source: string;
  symbol: string;
  name: string;
  close: number;
  changePercent: number | null;
  status: PickStatus;
  /** "Buy ready", "Wait: breadth", "6/8 checks". */
  statusLabel: string;
  /** Why it is not Buy ready, or the set-up description for RPCI/Oscillator. */
  note: string;
  entry: number;
  buyZoneHigh: number;
  stop: number;
  riskPercent: number;
  target1: number;
  target2: number;
  rs: number | null;
  /** Price Action rating, display only. */
  pa: PaBrief | null;
  score: number | null;
  /** Bullish scanner families agreeing (hourly email only), display only: never ranks or gates. */
  confluence?: RowConfluence | null;
  /** The close the plan was built on, kept when `close` is replaced by the latest price. */
  signalClose?: number;
  /** Where the latest price sits against the trigger and skip level. */
  entryState?: EntryState;
}

export interface RowConfluence {
  bull: number;
  of: number;
  conflict: boolean;
}

export interface AlertTable {
  brand: string;
  day: string;
  scanned: number;
  breadth: number | null;
  healthy: boolean;
  summary: string;
  rows: AlertTableRow[];
  /**
   * Customer emails only: Today's Picks watch list (ready except breadth or a
   * risk flag). Shown in a separate "do not buy yet" section, never as a buy.
   */
  watch?: AlertTableRow[];
  /** Hourly email only: top bullish-confluence stocks, context only, never a buy. */
  bullConfluence?: ConfluenceIdea[];
  /** Hourly email only: deep-base bottomed-out stocks (early-base when no deep base exists), experimental research list, never a buy. */
  bottomedOut?: BottomedOutPick[];
  /** Hourly email only: sector heat (1-day move and share above the 50-day line), hottest first. */
  sectorHeat?: SectorHeatLine[];
  /** Where and when the prices in this email were fetched. */
  priceSource?: PriceSource;
  empty: string[];
  footer: string[];
}

export interface AlertTableOptions {
  /**
   * Keeps only Buy ready rows: every check passes, market breadth included.
   * RPCI/Oscillator picks must pass the same checks. Used by customer emails,
   * so on a weak-breadth day they carry no stock at all.
   */
  recommendationsOnly?: boolean;
}

/**
 * Table rows for the email and the image. With `recommendationsOnly` (customer
 * emails) the rows are exactly Today's Picks (`todaysPicks`), so the app page
 * and the email always show the same stocks in the same order. Without it, the
 * personal digest shows the top stock of every source, whatever its status.
 */
export function buildAlertTable(
  payload: ScannerPayload,
  backtest: BacktestLine | null,
  options: AlertTableOptions = {},
): AlertTable {
  const breadth = payload.breadth.percent;
  const healthy = breadth != null && breadth >= HEALTHY_BREADTH_PERCENT;
  const shown = new Set<string>();
  const rows: AlertTableRow[] = [];
  const empty: string[] = [];
  const planFields = (p: ScannerPlan) => ({
    entry: p.entry, buyZoneHigh: p.buyZoneHigh, stop: p.stop, riskPercent: p.riskPercent, target1: p.target1, target2: p.target2,
  });
  const today = todaysPicks(payload);
  const watch: AlertTableRow[] = [];
  if (options.recommendationsOnly) {
    for (const pick of today.watch) {
      watch.push({
        n: watch.length + 1,
        source: pick.sources.join(" + "),
        symbol: pick.symbol,
        name: shortName(pick.name),
        close: pick.close,
        changePercent: pick.changePercent,
        status: "watch",
        statusLabel: TRADE_STATUS.watch.label,
        note: [pick.sector, healthy ? "A risk flag is open; wait for it to clear" : null].filter(Boolean).join(" · ") || "Waiting for the market",
        ...planFields(pick.plan),
        rs: pick.rs,
        pa: pick.pa,
        score: pick.score,
      });
    }
    for (const pick of today.picks) {
      rows.push({
        n: rows.length + 1,
        source: pick.sources.join(" + "),
        symbol: pick.symbol,
        name: shortName(pick.name),
        close: pick.close,
        changePercent: pick.changePercent,
        status: "buy",
        statusLabel: TRADE_STATUS["buy-ready"].label,
        note: pick.note ?? "All checks pass",
        ...planFields(pick.plan),
        rs: pick.rs,
        pa: pick.pa,
        score: pick.score,
      });
    }
    empty.push(...today.quiet);
  } else {
    for (const key of ALERT_SCANNER_KEYS) {
      const pick = topScannerPick(payload.results[key], shown);
      if (!pick) { empty.push(SCANNERS[key].menuLabel); continue; }
      shown.add(pick.symbol);
      const r = pick.readiness;
      const status = scannerBuyingStatus(r);
      const failed = r.checks.filter((c) => !c.pass && c.key !== "breadth").map((c) => CHECK_SHORT[c.key]);
      rows.push({
        n: rows.length + 1,
        source: SCANNERS[key].menuLabel,
        symbol: pick.symbol,
        name: shortName(pick.name),
        close: pick.close,
        changePercent: pick.changePercent,
        status: pickStatus(status.key),
        statusLabel: status.label,
        note: failed.length ? `Fails: ${failed.join(", ")}` : r.buyReady ? "All checks pass" : "Passes all but market breadth",
        ...planFields(r.plan!),
        rs: pick.rs,
        pa: paBrief(pick.paRating),
        score: pick.score,
      });
    }
    for (const { key, label: title } of EXTRA_SOURCES) {
      const section = payload.extras?.[key];
      const pick = extraPick(section, shown);
      if (!pick) { empty.push(title); continue; }
      shown.add(pick.symbol);
      const failed = extraFailures(pick);
      const status2 = extraPickStatus(pick, healthy);
      rows.push({
        n: rows.length + 1,
        source: title,
        symbol: pick.symbol,
        name: shortName(pick.name),
        close: pick.close,
        changePercent: pick.changePercent,
        status: pickStatus(status2),
        statusLabel: TRADE_STATUS[status2].label,
        note: failed.length ? `Fails: ${failed.join(", ")} · ${pick.note}` : pick.note,
        ...planFields(pick.plan),
        rs: pick.rs,
        pa: pick.pa ?? null,
        score: pick.score,
      });
    }
  }
  const footer: string[] = [];
  if (backtest) footer.push(backtestSentence(backtest));
  footer.push(
    "Buy only above the trigger; skip if it opens above the limit. Book half at T1, trail SL to cost. SL marked ⚠ is wider than 6%: size down.",
    "No sure shots. Risk no more than 1% of capital per trade.",
    "Automated, rule-based research output — not investment advice. Markets carry risk; please do your own diligence.",
  );
  return {
    brand: ALERT_BRAND,
    day: payload.candleTimestamp ? dateLabel(payload.candleTimestamp) : payload.sessionDateKey,
    scanned: payload.scanned,
    breadth,
    healthy,
    summary: healthy
      ? `Buy ready: ${today.buyReadyTotal} stock${today.buyReadyTotal === 1 ? "" : "s"} across the email sources${today.buyReadyTotal > today.picks.length ? `; top ${today.picks.length} by RS shown` : ""}.`
      : `No new buys: market breadth is below ${HEALTHY_BREADTH_PERCENT}%. ${today.watchTotal} strong stock${today.watchTotal === 1 ? "" : "s"} waiting for the market.`,
    rows,
    ...(options.recommendationsOnly ? { watch } : {}),
    empty,
    footer,
  };
}
