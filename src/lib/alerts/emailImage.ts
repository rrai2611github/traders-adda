import sharp from "sharp";
import type { AlertTable, AlertTableRow } from "./scannerAlert";
import { paText } from "../screen/priceActionRating.ts";

const WIDTH = 2040;
const PAD = 40;
const TITLE_HEIGHT = 150;
const SUMMARY_HEIGHT = 72;
const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 100;
const FOOTER_PAD = 34;
const FONT = "Arial, DejaVu Sans, sans-serif";

interface Column {
  title: string;
  width: number;
  align?: "end";
  main: (row: AlertTableRow) => string;
  sub?: (row: AlertTableRow) => string;
  tone?: "blue" | "red" | "green";
}

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shorten = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

const COLUMNS: Column[] = [
  { title: "#", width: 55, main: (r) => String(r.n) },
  { title: "Scanner", width: 235, main: (r) => shorten(r.source, 25) },
  { title: "Stock", width: 260, main: (r) => r.symbol, sub: (r) => shorten(r.name, 28) },
  { title: "Close", width: 150, align: "end", main: (r) => inr(r.close), sub: (r) => r.changePercent == null ? "—" : signed(r.changePercent) },
  { title: "Status", width: 250, main: (r) => r.statusLabel, sub: (r) => shorten(r.note, 31) },
  { title: "Buy above", width: 170, align: "end", main: (r) => inr(r.entry), sub: (r) => `skip > ${inr(r.buyZoneHigh)}`, tone: "blue" },
  { title: "Stop loss", width: 165, align: "end", main: (r) => inr(r.stop), sub: (r) => `−${r.riskPercent.toFixed(1)}%${r.riskPercent > 6 ? " · WIDE" : ""}`, tone: "red" },
  { title: "T1 (2R)", width: 150, align: "end", main: (r) => inr(r.target1), tone: "green" },
  { title: "T2 (3R)", width: 150, align: "end", main: (r) => inr(r.target2), tone: "green" },
  { title: "RS", width: 65, align: "end", main: (r) => String(r.rs ?? "—") },
  { title: "PA", width: 95, align: "end", main: (r) => paText(r.pa) },
  { title: "Osc", width: 80, align: "end", main: (r) => r.score?.toFixed(1) ?? "—" },
];

function text(x: number, y: number, value: string, options: {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: "start" | "end";
} = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${options.size ?? 20}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? "#111827"}" text-anchor="${options.anchor ?? "start"}">${escapeXml(value)}</text>`;
}

function statusStyle(row: AlertTableRow) {
  if (row.status === "buy") return { bg: "#dcf3e6", fg: "#12814c" };
  if (row.status === "watch") return { bg: "#fdf0cf", fg: "#8a5a00" };
  return { bg: "#eceff3", fg: "#4b5563" };
}

/** Builds an SVG first so the layout is deterministic and testable. */
export function buildEmailTableSvg(table: AlertTable, generatedAt: number): string {
  const rows = table.rows.slice(0, 10);
  const generated = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(generatedAt);
  const footer = [
    "Intraday preview: today’s candle is incomplete. Picks may change before the close.",
    "Buy only above the trigger; skip past the limit. No sure shots. Risk ≤1% of capital per trade.",
    "Automated, rule-based research output — not investment advice.",
  ];
  const height = TITLE_HEIGHT + SUMMARY_HEIGHT + HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT + FOOTER_PAD * 2 + footer.length * 30;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`,
    `<rect width="${WIDTH}" height="${TITLE_HEIGHT}" fill="#0f2d5c"/>`,
    text(PAD, 58, table.brand, { size: 42, weight: 700, fill: "#ffffff" }),
    text(PAD, 105, `Buy ready Picks · ${generated} IST`, { size: 24, fill: "#dbe7f8" }),
    text(PAD, 135, `${table.scanned.toLocaleString("en-IN")} NSE stocks scanned`, { size: 20, fill: "#b9cae5" }),
    `<rect x="${WIDTH - 350}" y="40" width="310" height="52" rx="26" fill="${table.healthy ? "#dcf3e6" : "#fdf0cf"}"/>`,
    text(WIDTH - 195, 74, `Market breadth ${table.breadth ?? "—"}% · ${table.healthy ? "HEALTHY" : "WEAK"}`, {
      size: 21,
      weight: 700,
      fill: table.healthy ? "#12814c" : "#8a5a00",
      anchor: "end",
    }),
    `<rect x="0" y="${TITLE_HEIGHT}" width="${WIDTH}" height="${SUMMARY_HEIGHT}" fill="#fff7e1"/>`,
    text(PAD, TITLE_HEIGHT + 44, shorten(table.summary, 145), { size: 23, weight: 700, fill: "#7a4d00" }),
  ];

  let y = TITLE_HEIGHT + SUMMARY_HEIGHT;
  parts.push(`<rect x="${PAD}" y="${y}" width="${WIDTH - PAD * 2}" height="${HEADER_HEIGHT}" fill="#e8effb"/>`);
  let x = PAD;
  for (const column of COLUMNS) {
    const tx = column.align === "end" ? x + column.width - 10 : x + 10;
    parts.push(text(tx, y + 36, column.title.toUpperCase(), {
      size: 16,
      weight: 700,
      fill: "#334155",
      anchor: column.align,
    }));
    x += column.width;
  }
  y += HEADER_HEIGHT;

  if (!rows.length) {
    parts.push(text(PAD + 12, y + 58, "No scanner produced a liquid stock with a valid plan in this refresh.", { size: 22, fill: "#6b7280" }));
    y += ROW_HEIGHT;
  }
  for (const [index, row] of rows.entries()) {
    if (index % 2 === 1) parts.push(`<rect x="${PAD}" y="${y}" width="${WIDTH - PAD * 2}" height="${ROW_HEIGHT}" fill="#f7f9fc"/>`);
    x = PAD;
    for (const column of COLUMNS) {
      const main = column.main(row);
      const sub = column.sub?.(row);
      const tx = column.align === "end" ? x + column.width - 10 : x + 10;
      let fill = "#111827";
      if (column.tone === "blue") fill = "#1f5fbf";
      if (column.tone === "red") fill = "#b42318";
      if (column.tone === "green") fill = "#12814c";
      if (column.title === "Status") {
        const status = statusStyle(row);
        const pillWidth = Math.min(column.width - 20, Math.max(105, main.length * 11 + 26));
        parts.push(`<rect x="${x + 10}" y="${y + 13}" width="${pillWidth}" height="32" rx="16" fill="${status.bg}"/>`);
        parts.push(text(x + 23, y + 36, main, { size: 17, weight: 700, fill: status.fg }));
      } else {
        parts.push(text(tx, y + (sub ? 39 : 59), main, {
          size: column.title === "Stock" ? 23 : 21,
          weight: 700,
          fill,
          anchor: column.align,
        }));
      }
      if (sub) {
        const subFill = column.title === "Stop loss" && row.riskPercent > 6 ? "#b45309" : "#6b7280";
        parts.push(text(tx, y + 72, sub, { size: 16, fill: subFill, anchor: column.align }));
      }
      x += column.width;
    }
    parts.push(`<line x1="${PAD}" y1="${y + ROW_HEIGHT - 1}" x2="${WIDTH - PAD}" y2="${y + ROW_HEIGHT - 1}" stroke="#e5e7eb"/>`);
    y += ROW_HEIGHT;
  }

  y += FOOTER_PAD;
  for (const [index, line] of footer.entries()) {
    parts.push(text(PAD, y + index * 30, line, {
      size: 18,
      weight: index === 1 ? 700 : 400,
      fill: index === 1 ? "#374151" : "#6b7280",
    }));
  }
  parts.push("</svg>");
  return parts.join("");
}

export async function renderEmailTablePng(table: AlertTable, generatedAt = Date.now()): Promise<Buffer> {
  return sharp(Buffer.from(buildEmailTableSvg(table, generatedAt)))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}
