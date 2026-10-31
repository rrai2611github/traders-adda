import type { AlertTable, AlertTableRow } from "./scannerAlert.ts";
import { HEALTHY_BREADTH_PERCENT } from "../screen/breadth.ts";
import { BRAND, BRAND_FONT } from "./brand.ts";
import { TRADE_COLUMNS, confluenceLabel, dataTable, esc, levelCells, mainSource, noteLine, pctFrom, px, spacer, stockCell, stockMeta, tag } from "./compactEmail.ts";

/**
 * "Strong stocks waiting for the market": one shared, email-safe block (inline
 * styles, tables only) for the pre-open and hourly emails, styled like a
 * screener-alert digest. Stocks are grouped by their main screener; each row
 * carries an Added / Unchanged pill against the previous email, and stocks that
 * dropped off are listed as Removed. Watch-only: full levels, but labelled
 * "do not buy" because the weak-market backtest is negative.
 */

export const WATCH_TITLE = "Strong stocks waiting for the market — do not buy";

export const FONT = BRAND_FONT;
const MUTED = BRAND.muted;

/** What the previous email listed, so this one can say Added / Removed. */
export interface ListedStock {
  symbol: string;
  name: string;
  source: string;
}

export const listedStocks = (rows: AlertTableRow[]): ListedStock[] =>
  rows.map((row) => ({ symbol: row.symbol, name: row.name, source: row.source }));

const inr = px;
const pct = pctFrom;

export function watchReason(table: Pick<AlertTable, "healthy" | "breadth">): string {
  if (table.healthy) return "They pass every check but a risk flag is open. Wait for it to clear.";
  const breadth = table.breadth != null ? `${table.breadth.toFixed(0)}%` : "unavailable";
  return `Weak market (breadth ${breadth}, needs ${HEALTHY_BREADTH_PERCENT}%+): wait.`;
}

const TAG = {
  added: ["#dcfce7", "#15803d", "Added"],
  same: ["#f1f5f9", "#475569", "Unchanged"],
  removed: ["#fee2e2", "#b91c1c", "Removed"],
} as const;
export const changeTag = (kind: keyof typeof TAG) => tag(TAG[kind][2], TAG[kind][0], TAG[kind][1]);

export const WATCH_CRITERIA = "RS 75+ · Chart grade A · Turnover ₹40 Cr+ · SL within 6% · Max 2 per sector";

/** The orange "do not buy yet" line above every watch table. */
export const doNotBuyLine = (table: Pick<AlertTable, "healthy" | "breadth">) =>
  noteLine(
    `<span style="display:inline-block;background:#ea580c;color:#ffffff;border-radius:4px;padding:1px 6px;font:800 9px ${FONT};letter-spacing:0.8px">DO NOT BUY YET</span>&nbsp; ${esc(watchReason(table))}`,
    "#fff7ed",
    "#fed7aa",
    "#9a3412",
  );

/** Table rows for watch stocks; `kind` adds an Added / Unchanged tag. */
export function watchTableRows(rows: AlertTableRow[], kindOf: (row: AlertTableRow) => keyof typeof TAG | null = () => null): string[][] {
  return rows.map((row) => {
    const kind = kindOf(row);
    return [
      stockCell(row.symbol, stockMeta(row), kind ? changeTag(kind) : ""),
      ...levelCells(row, `close ${px(row.close)}`),
    ];
  });
}

/** A struck-through row for a stock that dropped off the list. */
export const removedTableRow = (stock: ListedStock): string[] => [
  `<div style="font:800 13px ${FONT};color:#94a3b8;white-space:nowrap"><s>${esc(stock.symbol)}</s>${changeTag("removed")}</div><div style="font:500 10px ${FONT};color:#94a3b8;padding-top:2px">${esc(mainSource(stock.source))} · dropped off</div>`,
  `<span style="color:#cbd5e1">—</span>`,
  `<span style="color:#cbd5e1">—</span>`,
  `<span style="color:#cbd5e1">—</span>`,
];

/**
 * The watch list as one compact table. With `previous` (last email's list)
 * rows get Added / Unchanged tags and dropped stocks appear as Removed.
 */
export function watchHtml(
  rows: AlertTableRow[],
  table: Pick<AlertTable, "healthy" | "breadth">,
  previous: ListedStock[] | null = null,
): string {
  const now = new Set(rows.map((row) => row.symbol));
  const before = new Set((previous ?? []).map((stock) => stock.symbol));
  const removed = (previous ?? []).filter((stock) => !now.has(stock.symbol));
  if (!rows.length && !removed.length) return "";
  const body = [
    ...watchTableRows(rows, (row) => (previous ? (before.has(row.symbol) ? "same" : "added") : null)),
    ...removed.map(removedTableRow),
  ];
  return `${doNotBuyLine(table)}${spacer(8)}${dataTable(TRADE_COLUMNS("Trigger"), body)}
    <div style="font:400 10px/1.5 ${FONT};color:${MUTED};padding-top:6px">Filters: ${esc(WATCH_CRITERIA)}</div>`;
}
export function watchText(
  rows: AlertTableRow[],
  table: Pick<AlertTable, "healthy" | "breadth">,
  previous: ListedStock[] | null = null,
  /** Stocks whose trade plan is shown in Top picks; they are not given a second plan here. */
  samePlan: ReadonlySet<string> | null = null,
): string[] {
  const now = new Set(rows.map((row) => row.symbol));
  const before = new Set((previous ?? []).map((stock) => stock.symbol));
  const removed = (previous ?? []).filter((stock) => !now.has(stock.symbol));
  if (!rows.length && !removed.length) return [];
  return [
    "",
    WATCH_TITLE.toUpperCase(),
    watchReason(table),
    ...rows.map(
      (row) => samePlan?.has(row.symbol)
        ? `${row.n}. ${row.symbol}${row.note ? ` · ${row.note}` : ""} · ${row.source} · RS ${row.rs ?? "—"} · Trade plan: see Top picks above`
        : `${row.n}. ${row.symbol}${row.note ? ` · ${row.note}` : ""} · ${row.source} · trigger ${inr(row.entry)} · SL ${inr(row.stop)} (${pct(row.stop, row.entry)}) · T1 ${inr(row.target1)} (${pct(row.target1, row.entry)}) · T2 ${inr(row.target2)} (${pct(row.target2, row.entry)}) · RS ${row.rs ?? "—"}${confluenceLabel(row) ? ` · ${confluenceLabel(row)}` : ""}${previous ? ` · ${before.has(row.symbol) ? "Unchanged" : "Added"}` : ""}`,
    ),
    ...removed.map((stock) => `- ${stock.symbol} · Removed`),
  ];
}
