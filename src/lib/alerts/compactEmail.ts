import type { AlertTableRow } from "./scannerAlert.ts";
import { BRAND, BRAND_FONT } from "./brand.ts";

/**
 * Compact, email-safe data tables shared by the pre-open and hourly emails:
 * one bordered table per section, a light header row and thin row dividers,
 * so a whole email fits in about two phone screens.
 */

const F = BRAND_FONT;
export const ROW_LINE = "#eef2f6";
export const GREEN = "#12814c";
export const RED = "#b42318";
export const AMBER = "#b45309";
export const BLUE = "#1d4ed8";

export const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Short price: whole rupees from ₹1,000, one decimal below. */
export const px = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: value >= 1000 ? 0 : 1 })}`;
export const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
export const pctFrom = (to: number, from: number) => (from > 0 ? `${signed((to / from - 1) * 100, 1)}%` : "");

export interface Column {
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
  /** Class added to the header and body cells of this column (e.g. "stc" hides it on phones). */
  className?: string;
}

/** A bordered table: header row of tiny uppercase labels, then the body rows. */
export function dataTable(columns: Column[], rows: string[][]): string {
  const cls = (c?: Column) => (c?.className ? ` class="${c.className}"` : "");
  const head = columns
    .map(
      (c) =>
        `<td${cls(c)}${c.width ? ` width="${c.width}"` : ""} style="padding:8px 10px;background:#f8fafc;border-bottom:1px solid ${BRAND.line};font:700 9px ${F};letter-spacing:0.9px;text-transform:uppercase;color:${BRAND.muted};text-align:${c.align ?? "left"};white-space:nowrap">${c.label}</td>`,
    )
    .join("");
  const body = rows
    .map(
      (cells, r) =>
        `<tr>${cells
          .map(
            (cell, i) =>
              `<td${cls(columns[i])} style="padding:9px 10px;${r < rows.length - 1 ? `border-bottom:1px solid ${ROW_LINE};` : ""}vertical-align:middle;text-align:${columns[i]?.align ?? "left"};font:400 13px ${F};color:${BRAND.ink}">${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dt" style="border:1px solid ${BRAND.line};border-radius:12px;border-collapse:separate;overflow:hidden;background:#ffffff"><tr>${head}</tr>${body}</table>`;
}

/** A bold value with a small muted or coloured line under it. */
export const twoLine = (value: string, sub = "", color: string = BRAND.ink, subColor: string = BRAND.muted) =>
  `<div class="lv" style="font:700 13px ${F};color:${color};white-space:nowrap">${value}</div>${
    sub ? `<div style="font:500 10px ${F};padding-top:2px;white-space:nowrap;color:${subColor}">${sub}</div>` : ""
  }`;

/** A small rounded tag; the text colour is the last style so tests can match it. */
export const tag = (text: string, bg: string, fg: string) =>
  `<span style="display:inline-block;margin-left:4px;border-radius:999px;padding:1px 7px;font:700 9px ${F};letter-spacing:0.3px;text-transform:uppercase;vertical-align:1px;white-space:nowrap;background:${bg};color:${fg}">${text}</span>`;

/** Stock cell: symbol (+ tags) on top, screener / meta line under it. */
export const stockCell = (symbol: string, sub: string, tags = "") =>
  `<div style="font:800 13px ${F};color:${BRAND.ink};white-space:nowrap">${esc(symbol)}${tags}</div><div style="font:500 10px/1.4 ${F};color:${BRAND.muted};padding-top:2px">${sub}</div>`;

export const mainSource = (source: string) => source.split(" + ")[0] || "Scanner";

/** "3/5 scanners" (or "scanners disagree") for a row's confluence; empty when not measured. */
export const confluenceLabel = (row: Pick<AlertTableRow, "confluence">) =>
  row.confluence ? (row.confluence.conflict ? "scanners disagree" : `${row.confluence.bull}/${row.confluence.of} scanners`) : "";

/** Meta line under a stock: screener, RS and, in the hourly email, confluence. */
export const stockMeta = (row: Pick<AlertTableRow, "source" | "rs" | "confluence">) => {
  const label = confluenceLabel(row);
  return `${screenerLine(row.source)}${row.rs != null ? ` · RS ${row.rs}` : ""}${label ? ` · ${esc(label)}` : ""}`;
};

/** Plain-text "SYMBOL (3/5 scanners)" lists. */
export const symbolsWithConfluence = (rows: Pick<AlertTableRow, "symbol" | "confluence">[]) =>
  rows.map((row) => { const label = confluenceLabel(row); return label ? `${row.symbol} (${label})` : row.symbol; }).join(", ");

/** Screener line for a row: main screener, then "+ other" ones. */
export const screenerLine = (source: string) => {
  const [main, ...others] = source.split(" + ");
  return `${esc(main || "Scanner")}${others.length ? ` <span style="color:#15803d">· Also in: ${esc(others.join(", "))}</span>` : ""}`;
};

/** Trade-level cells shared by Buy-ready and watch tables: entry, stop, T1 (T2 under it). */
export function levelCells(row: AlertTableRow, entrySub: string): string[] {
  const wide = row.riskPercent > 6;
  const stopPct = `−${row.riskPercent.toFixed(1)}%${wide ? " ⚠" : ""}`;
  return [
    twoLine(px(row.entry), entrySub, BLUE),
    twoLine(px(row.stop), stopPct, wide ? AMBER : RED, wide ? AMBER : RED),
    twoLine(px(row.target1), `T2 ${px(row.target2)}`, GREEN),
  ];
}

export const TRADE_COLUMNS = (entryLabel: string): Column[] => [
  { label: "Stock · screener" },
  { label: entryLabel, align: "right", width: "19%" },
  { label: "Stop loss", align: "right", width: "19%" },
  { label: "Target", align: "right", width: "19%" },
];

/** A one-line tinted note. */
export const noteLine = (html: string, bg = "#f8fafc", border: string = BRAND.line, color: string = BRAND.muted) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:10px"><tr><td style="padding:9px 12px;font:400 12px/1.5 ${F};color:${color}">${html}</td></tr></table>`;

export const spacer = (height = 8) => `<div style="height:${height}px;font-size:0;line-height:0">&nbsp;</div>`;
