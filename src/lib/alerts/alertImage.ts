import type { AlertTable, AlertTableRow, PickStatus } from "./scannerAlert.ts";
import { paText } from "../screen/priceActionRating.ts";

/**
 * Renders the daily picks as one table image (PNG) and plain text, for sharing
 * by hand where the Telegram API cannot be reached.
 */

export const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export const alertToPlainText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ""));

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
const vsEntry = (r: AlertTableRow, v: number) => signed(((v - r.entry) / r.entry) * 100);
const WIDE_RISK = 6;

export interface Column {
  title: string;
  width: number;
  align?: "right";
  main: (r: AlertTableRow) => string;
  sub?: (r: AlertTableRow) => string;
  color?: (r: AlertTableRow) => string;
}

const GREEN = "#12814c";
const RED = "#b42318";
const BLUE = "#1f5fbf";
const INK = "#111827";
const MUTED = "#6b7280";

export const COLUMNS: Column[] = [
  { title: "#", width: 64, main: (r) => String(r.n) },
  { title: "Scanner", width: 250, main: (r) => r.source },
  { title: "Stock", width: 290, main: (r) => r.symbol, sub: (r) => r.name },
  { title: "Close", width: 160, align: "right", main: (r) => inr(r.close), sub: (r) => (r.changePercent != null ? signed(r.changePercent, 2) : ""), color: () => INK },
  { title: "Status", width: 270, main: (r) => r.statusLabel, sub: (r) => r.note },
  { title: "Buy above", width: 180, align: "right", main: (r) => inr(r.entry), sub: (r) => `skip > ${inr(r.buyZoneHigh)}`, color: () => BLUE },
  { title: "Stop loss", width: 180, align: "right", main: (r) => inr(r.stop), sub: (r) => `−${r.riskPercent.toFixed(1)}%${r.riskPercent > WIDE_RISK ? " ⚠ wide" : ""}`, color: () => RED },
  { title: "Target 1 (2R)", width: 170, align: "right", main: (r) => inr(r.target1), sub: (r) => vsEntry(r, r.target1), color: () => GREEN },
  { title: "Target 2 (3R)", width: 170, align: "right", main: (r) => inr(r.target2), sub: (r) => vsEntry(r, r.target2), color: () => GREEN },
  { title: "RS", width: 64, align: "right", main: (r) => (r.rs != null ? String(r.rs) : "—") },
  { title: "PA", width: 100, align: "right", main: (r) => paText(r.pa) },
  { title: "Osc /15", width: 100, align: "right", main: (r) => (r.score != null ? r.score.toFixed(1) : "—") },
];

const STATUS_STYLE: Record<PickStatus, { bg: string; fg: string }> = {
  buy: { bg: "#dcf3e6", fg: GREEN },
  watch: { bg: "#fdf0cf", fg: "#8a5a00" },
  weak: { bg: "#eceff3", fg: "#4b5563" },
};

/** Plain-text table (monospace-friendly) for pasting into a chat. */
export function alertTableToText(t: AlertTable): string {
  const lines = [
    `📊 ${t.brand} · Daily Scanner Picks`,
    `🗓 ${t.day} · ${t.scanned.toLocaleString("en-IN")} NSE stocks · Breadth ${t.breadth ?? "—"}% ${t.healthy ? "✅" : "⚠️"}`,
    t.summary,
    "",
  ];
  for (const r of t.rows) {
    lines.push(
      `${r.n}. ${r.symbol} (${r.source}) · ${r.statusLabel}`,
      `   Buy > ${inr(r.entry)} · SL ${inr(r.stop)} (−${r.riskPercent.toFixed(1)}%)${r.riskPercent > WIDE_RISK ? " ⚠" : ""} · T1 ${inr(r.target1)} · T2 ${inr(r.target2)}`,
    );
  }
  if (t.empty.length) lines.push("", `No pick today: ${t.empty.join(", ")}`);
  lines.push("", ...t.footer);
  return lines.join("\n");
}

const FONT = `"Segoe UI", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
const font = (size: number, bold = false, italic = false) => `${italic ? "italic " : ""}${bold ? "700" : "400"} ${size}px ${FONT}`;

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Word-wraps to at most `maxLines` lines. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines = 3): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length, fit(ctx, lines.slice(maxLines - 1).join(" "), max));
  return lines;
}

/** One PNG with every pick as a table row. */
export async function renderAlertTableImage(t: AlertTable): Promise<Blob> {
  const PAD = 40;
  const CELL_PAD = 12;
  const tableWidth = COLUMNS.reduce((s, c) => s + c.width, 0);
  const width = tableWidth + PAD * 2;
  const BAND = 132;
  const SUMMARY = 64;
  const HEAD = 52;
  const ROW = 86;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.font = font(19);
  const footerLines = [
    ...(t.empty.length ? [`No pick today: ${t.empty.join(", ")}`] : []),
    ...t.footer,
  ].flatMap((line) => wrapLines(ctx, line, tableWidth, 2));
  const height = BAND + SUMMARY + HEAD + Math.max(1, t.rows.length) * ROW + 28 + footerLines.length * 30 + PAD;

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  // Title band.
  ctx.fillStyle = "#0f2d5c";
  ctx.fillRect(0, 0, width, BAND);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(44, true);
  ctx.fillText(t.brand, PAD, 50);
  ctx.font = font(24);
  ctx.fillStyle = "#c9d7f0";
  ctx.fillText(`Daily Scanner Picks · ${t.day} · ${t.scanned.toLocaleString("en-IN")} NSE stocks scanned`, PAD, 98);
  const pill = `Market breadth ${t.breadth ?? "—"}% · ${t.healthy ? "healthy" : "weak"}`;
  ctx.font = font(24, true);
  const pw = ctx.measureText(pill).width + 36;
  ctx.fillStyle = t.healthy ? "#dcf3e6" : "#fdf0cf";
  roundRect(ctx, width - PAD - pw, 44, pw, 48, 24);
  ctx.fillStyle = t.healthy ? GREEN : "#8a5a00";
  ctx.fillText(pill, width - PAD - pw + 18, 68);

  // Summary line.
  ctx.font = font(23, true);
  ctx.fillStyle = t.healthy ? GREEN : "#8a5a00";
  ctx.fillText(fit(ctx, t.summary, tableWidth), PAD, BAND + SUMMARY / 2);

  // Header row.
  let y = BAND + SUMMARY;
  ctx.fillStyle = "#e8effb";
  ctx.fillRect(PAD, y, tableWidth, HEAD);
  ctx.font = font(19, true);
  ctx.fillStyle = "#334155";
  let x = PAD;
  for (const c of COLUMNS) {
    const label = fit(ctx, c.title.toUpperCase(), c.width - CELL_PAD * 2);
    ctx.fillText(label, c.align === "right" ? x + c.width - CELL_PAD - ctx.measureText(label).width : x + CELL_PAD, y + HEAD / 2);
    x += c.width;
  }
  y += HEAD;

  if (!t.rows.length) {
    ctx.font = font(22, false, true);
    ctx.fillStyle = MUTED;
    ctx.fillText("No scanner produced a liquid stock with a valid plan today.", PAD + CELL_PAD, y + ROW / 2);
  }
  for (const [i, r] of t.rows.entries()) {
    if (i % 2 === 1) {
      ctx.fillStyle = "#f7f9fc";
      ctx.fillRect(PAD, y, tableWidth, ROW);
    }
    x = PAD;
    for (const c of COLUMNS) {
      const inner = c.width - CELL_PAD * 2;
      const left = (s: string) => (c.align === "right" ? x + c.width - CELL_PAD - ctx.measureText(s).width : x + CELL_PAD);
      if (c.title === "Status") {
        const st = STATUS_STYLE[r.status];
        ctx.font = font(19, true);
        const label = fit(ctx, c.main(r), inner - 24);
        const w = ctx.measureText(label).width + 24;
        ctx.fillStyle = st.bg;
        roundRect(ctx, x + CELL_PAD, y + 12, w, 32, 16);
        ctx.fillStyle = st.fg;
        ctx.fillText(label, x + CELL_PAD + 12, y + 28);
        ctx.font = font(16);
        ctx.fillStyle = MUTED;
        wrapLines(ctx, r.note, inner, 2).forEach((line, j) => ctx.fillText(line, x + CELL_PAD, y + 58 + j * 19));
      } else if (c.title === "Scanner") {
        ctx.font = font(20, true);
        ctx.fillStyle = INK;
        wrapLines(ctx, c.main(r), inner, 2).forEach((line, j, all) =>
          ctx.fillText(line, x + CELL_PAD, y + ROW / 2 + (j - (all.length - 1) / 2) * 26));
      } else {
        const main = c.main(r);
        const sub = c.sub?.(r) ?? "";
        ctx.font = font(c.title === "Stock" ? 23 : 22, true);
        ctx.fillStyle = c.color?.(r) ?? INK;
        const m = fit(ctx, main, inner);
        ctx.fillText(m, left(m), sub ? y + 30 : y + ROW / 2);
        if (sub) {
          ctx.font = font(17);
          ctx.fillStyle = c.title === "Close" && r.changePercent != null
            ? (r.changePercent > 0 ? GREEN : r.changePercent < 0 ? RED : MUTED)
            : c.title === "Stop loss" && r.riskPercent > WIDE_RISK ? "#b45309" : MUTED;
          const s = fit(ctx, sub, inner);
          ctx.fillText(s, left(s), y + 60);
        }
      }
      x += c.width;
    }
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(PAD, y + ROW - 1, tableWidth, 1);
    y += ROW;
  }

  // Footer.
  y += 28;
  ctx.font = font(19);
  ctx.fillStyle = MUTED;
  for (const line of footerLines) {
    ctx.fillText(line, PAD, y);
    y += 30;
  }

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image."))), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
