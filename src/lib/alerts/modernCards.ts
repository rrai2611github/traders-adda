import { BRAND, BRAND_FONT } from "./brand.ts";

/**
 * Card components for the hourly email's modern layout: one card per stock with
 * a header (symbol, status, price) and three level boxes, bar rows for sector
 * heat, and tinted section headings. Table-based with inline styles so they
 * render in Outlook, Gmail and Apple Mail; rounded corners and tints are
 * progressive, the layout holds without them.
 */

const F = BRAND_FONT;

export const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TONE = {
  blue: { bg: "#eff6ff", fg: "#1d4ed8", line: "#bfdbfe" },
  red: { bg: "#fef2f2", fg: "#b42318", line: "#fecaca" },
  green: { bg: "#f0fdf4", fg: "#12814c", line: "#bbf7d0" },
  slate: { bg: "#f1f5f9", fg: "#0f172a", line: "#e2e8f0" },
  amber: { bg: "#fffbeb", fg: "#b45309", line: "#fde68a" },
} as const;
export type Tone = keyof typeof TONE;

/** A small status pill. */
export const pill = (text: string, bg: string, fg: string) =>
  `<span style="display:inline-block;border-radius:999px;padding:2px 8px;font:800 9px ${F};letter-spacing:0.6px;text-transform:uppercase;vertical-align:2px;white-space:nowrap;background:${bg};color:${fg}">${text}</span>`;

export interface LevelBox {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
}

/** One tinted box: tiny label, bold value, optional small line. */
const levelBox = (box: LevelBox, width: string) => {
  const t = TONE[box.tone];
  return `<td width="${width}" style="padding:0 3px;vertical-align:top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.bg};border:1px solid ${t.line};border-radius:10px"><tr><td style="padding:8px 9px">
    <div style="font:700 9px ${F};letter-spacing:0.9px;text-transform:uppercase;color:${t.fg};opacity:0.85">${box.label}</div>
    <div class="lv" style="font:800 15px ${F};color:${t.fg};padding-top:3px;white-space:nowrap">${box.value}</div>
    ${box.sub ? `<div style="font:600 10px ${F};color:${BRAND.muted};padding-top:2px;white-space:nowrap">${box.sub}</div>` : ""}
  </td></tr></table></td>`;
};

export interface StockCardInput {
  symbol: string;
  /** Pill shown next to the symbol (already built with `pill`). */
  status?: string;
  /** Small line under the symbol (HTML, already escaped). */
  sub?: string;
  /** Current market price text, e.g. "₹812". */
  price?: string;
  /** Day change, as a number in percent. */
  change?: number | null;
  boxes?: LevelBox[];
  /** A last line inside the card (HTML, already escaped). */
  foot?: string;
  muted?: boolean;
  /** Rank shown in a dark square before the symbol. */
  num?: number;
  /** Label above the price; "CMP" unless the number is a close. */
  priceLabel?: string;
}

const changeText = (change: number) => `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(2)}%`;

export function stockCard(c: StockCardInput): string {
  const boxes = c.boxes ?? [];
  const width = boxes.length ? (100 / boxes.length).toFixed(2) : "100";
  const changeColor = c.change == null ? BRAND.muted : c.change >= 0 ? "#12814c" : "#b42318";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:14px;background:#ffffff;margin-bottom:10px"><tr><td style="padding:13px 12px 12px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${c.num != null ? `<td width="30" style="vertical-align:top"><div style="width:24px;height:24px;border-radius:8px;background:#0f172a;color:#22c55e;font:800 12px/24px ${F};text-align:center">${c.num}</div></td>` : ""}
      <td style="vertical-align:top;padding-left:3px">
        <div style="font:800 16px ${F};color:${c.muted ? "#94a3b8" : BRAND.ink};letter-spacing:-0.2px">${c.muted ? `<s>${esc(c.symbol)}</s>` : esc(c.symbol)} ${c.status ?? ""}</div>
        ${c.sub ? `<div style="font:500 11px/1.45 ${F};color:${BRAND.muted};padding-top:3px">${c.sub}</div>` : ""}
      </td>
      ${c.price ? `<td style="vertical-align:top;text-align:right;white-space:nowrap;padding-right:3px">
        <div style="font:800 10px ${F};letter-spacing:1px;color:${BRAND.muted}">${c.priceLabel ?? "CMP"}</div>
        <div style="font:800 17px ${F};color:${BRAND.ink}">${c.price}</div>
        ${c.change != null ? `<div style="font:800 12px ${F};color:${changeColor}">${changeText(c.change)}</div>` : ""}
      </td>` : ""}
    </tr></table>
    ${boxes.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px"><tr>${boxes.map((b) => levelBox(b, `${width}%`)).join("")}</tr></table>` : ""}
    ${c.foot ? `<div style="font:500 11px/1.5 ${F};color:${BRAND.muted};padding:8px 3px 0 3px">${c.foot}</div>` : ""}
  </td></tr></table>`;
}

export interface SectorBar {
  sector: string;
  changePercent: number;
  above50Percent: number | null;
  advancing: number;
  total: number;
}

/** Sector heat as rows with a green/red bar scaled to the biggest move shown. */
export function sectorBars(rows: SectorBar[]): string {
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.changePercent)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:14px;background:#ffffff"><tr><td style="padding:6px 12px">
    ${rows.map((r, i) => {
      const up = r.changePercent >= 0;
      const w = Math.max(4, Math.round((Math.abs(r.changePercent) / max) * 100));
      const color = up ? "#22c55e" : "#ef4444";
      const text = `${up ? "+" : "−"}${Math.abs(r.changePercent).toFixed(2)}%`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${i ? `border-top:1px solid #eef2f6;` : ""}"><tr>
        <td width="44%" style="padding:9px 8px 9px 0;vertical-align:middle"><div style="font:700 12px/1.3 ${F};color:${BRAND.ink}">${esc(r.sector)}</div><div style="font:500 10px ${F};color:${BRAND.muted};padding-top:2px">${r.advancing}/${r.total} up${r.above50Percent == null ? "" : ` · ${Math.round(r.above50Percent)}% above 50D`}</div></td>
        <td width="34%" style="vertical-align:middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;border-radius:6px"><tr><td width="${w}%" height="8" bgcolor="${color}" style="background:${color};border-radius:6px;font-size:0;line-height:8px">&nbsp;</td><td style="font-size:0;line-height:8px">&nbsp;</td></tr></table></td>
        <td width="22%" align="right" style="vertical-align:middle;font:800 13px ${F};color:${up ? "#12814c" : "#b42318"};white-space:nowrap">${text}</td>
      </tr></table>`;
    }).join("")}
  </td></tr></table>`;
}

/** A tinted icon badge for a section heading. */
export const iconBadge = (icon: string, tone: Tone | "navy") =>
  tone === "navy"
    ? `<div style="width:26px;height:26px;border-radius:9px;background:${BRAND.canvas};color:${BRAND.green};font:800 12px/26px ${F};text-align:center">${icon}</div>`
    : `<div style="width:26px;height:26px;border-radius:9px;background:${TONE[tone].bg};border:1px solid ${TONE[tone].line};color:${TONE[tone].fg};font:800 12px/24px ${F};text-align:center">${icon}</div>`;

/** Two cards per row on desktop; the .c2 cells stack on phones (rule lives in BRAND_STYLE). */
export function grid2(items: string[]): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(`<tr><td class="c2" width="50%" valign="top" style="padding:0 6px 0 0">${items[i]}</td><td class="c2" width="50%" valign="top" style="padding:0 0 0 6px">${items[i + 1] ?? ""}</td></tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`;
}

/** Section heading: blue left border, bold title, optional muted text on the right. */
export const blueHeading = (title: string, right = "") =>
  `<tr><td class="pad" style="padding:18px 22px 8px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="border-left:4px solid #2563eb;padding-left:10px;font:700 16px ${F};color:${BRAND.ink};letter-spacing:-0.2px">${title}</td>
    ${right ? `<td align="right" style="font:700 12px/1.35 ${F};color:${BRAND.muted};padding-left:10px">${right}</td>` : ""}</tr></table></td></tr>`;

export const blockRow = (html: string) => `<tr><td class="pad" style="padding:0 22px">${html}</td></tr>`;
