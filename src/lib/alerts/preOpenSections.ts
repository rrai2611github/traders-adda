import type { IndexOutlook, MarketOutlook, OutlookDriver, OutlookLabel } from "../screen/marketOutlook.ts";
import type { BriefSection } from "../screen/morningBrief.ts";
import { BRAND, BRAND_FONT } from "./brand.ts";
import { esc, grid2 } from "./modernCards.ts";

/**
 * Compact card sections for the pre-open email: one outlook card (label, meter, GIFT Nifty
 * comparison, driver chips), index outlook cards, global cue chips, key-level tiles and slim
 * stock cards. Table-based with inline styles so they render in Outlook, Gmail and Apple Mail.
 */

const F = BRAND_FONT;
const SHADOW = "box-shadow:0 2px 10px rgba(15,23,42,0.07);";
const whole = (v: number) => Math.round(v).toLocaleString("en-IN");
const signed = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

export const LABEL_STYLE: Record<OutlookLabel, { bg: string; fg: string; solid: string; icon: string }> = {
  Bullish: { bg: "#dcfce7", fg: "#15803d", solid: "#16a34a", icon: "▲" },
  Bearish: { bg: "#fee2e2", fg: "#b91c1c", solid: "#dc2626", icon: "▼" },
  Neutral: { bg: "#e2e8f0", fg: "#475569", solid: "#64748b", icon: "◆" },
};

const card = (inner: string, pad = "14px", accent = "") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};${accent ? `border-top:3px solid ${accent};` : ""}border-radius:14px;background:#ffffff;margin-bottom:10px;${SHADOW}"><tr><td style="padding:${pad}">${inner}</td></tr></table>`;

/** A horizontal bar of coloured zones with a dark dot at `pos` (same scale as the zones). */
function zoneBar(zones: Array<[number, number, string]>, min: number, max: number, pos: number, height = 10): string {
  const span = max - min;
  const pc = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const dot = 3.2;
  const at = Math.min(Math.max(pc(pos), dot / 2), 100 - dot / 2);
  const left = at - dot / 2, right = at + dot / 2;
  const segs: Array<[number, number, string]> = [];
  for (const [from, to, color] of zones) {
    const a = pc(from), b = pc(to);
    if (b <= left || a >= right) segs.push([a, b, color]);
    else {
      if (a < left) segs.push([a, left, color]);
      segs.push([Math.max(a, left), Math.min(b, right), "DOT"]);
      if (b > right) segs.push([right, b, color]);
    }
  }
  const cells = segs.filter(([a, b]) => b - a > 0.05).map(([a, b, c]) =>
    `<td width="${(b - a).toFixed(2)}%" bgcolor="${c === "DOT" ? "#0f172a" : c}" style="background:${c === "DOT" ? "#0f172a" : c};${c === "DOT" ? "border-radius:6px;" : ""}font-size:0;line-height:${height}px">&nbsp;</td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden"><tr height="${height}">${cells}</tr></table>`;
}

/** One driver as a chip: arrow, label and value, tinted by its contribution, with the points on the right. */
function chip(d: OutlookDriver): string {
  const color = d.points > 0 ? "#15803d" : d.points < 0 ? "#b91c1c" : "#64748b";
  const bg = d.points > 0 ? "#ecfdf3" : d.points < 0 ? "#fef2f2" : "#f1f5f9";
  const line = d.points > 0 ? "#bbf7d0" : d.points < 0 ? "#fecaca" : "#e2e8f0";
  const icon = d.points > 0 ? "▲" : d.points < 0 ? "▼" : "•";
  const pts = `${d.points > 0 ? "+" : d.points < 0 ? "−" : ""}${Math.abs(d.points)}`;
  return `<span style="display:inline-block;margin:0 5px 5px 0;border:1px solid ${line};background:${bg};border-radius:9px;padding:4px 8px;font:600 12px/1.3 ${F};color:#1e293b"><span style="color:${color};font-weight:800">${icon}</span> ${esc(d.label)} <span style="color:${BRAND.muted};font-weight:500">${esc(d.detail)}</span> <b style="color:${color}">${pts}</b></span>`;
}

const chips = (drivers: OutlookDriver[]) => drivers.map(chip).join("");

/** The outlook in one card: label and conviction, score meter, GIFT Nifty comparison and the driver chips. */
export function outlookHero(o: MarketOutlook): string {
  const s = LABEL_STYLE[o.label];
  const m = o.maxScore;
  const bar = zoneBar([[-m, -3, "#fecaca"], [-3, 3, "#e2e8f0"], [3, m, "#bbf7d0"]], -m, m, o.score);
  const g = o.gift;
  let giftHtml: string;
  if (!g) {
    giftHtml = `<div style="margin-top:12px;font:600 12px/1.5 ${F};color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 11px">GIFT Nifty is unavailable this morning, so the outlook uses the global tape, trend and breadth only.</div>`;
  } else {
    const tile = (label: string, value: string, sub: string, color: string) => `<td width="33%" style="padding:0 3px;vertical-align:top"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 9px">
      <div style="font:800 9px ${F};letter-spacing:0.8px;color:${BRAND.muted}">${label}</div>
      <div style="font:800 17px ${F};color:${color};padding-top:2px;white-space:nowrap">${value}</div>
      <div style="font:600 10px ${F};color:${BRAND.muted}">${sub}</div></div></td>`;
    const gapColor = g.gapPercent > 0 ? "#15803d" : g.gapPercent < 0 ? "#b91c1c" : BRAND.ink;
    const toneColor = g.tonePercent == null ? BRAND.ink : g.tonePercent > 0 ? "#15803d" : g.tonePercent < 0 ? "#b91c1c" : BRAND.ink;
    const verdict: Record<string, [string, string, string]> = {
      confirms: ["#f0fdf4", "#bbf7d0", "#166534"], diverges: ["#fffbeb", "#fde68a", "#92400e"], "flat-vs-move": ["#fffbeb", "#fde68a", "#92400e"],
      leads: ["#eff6ff", "#bfdbfe", "#1e40af"], flat: ["#f1f5f9", "#e2e8f0", "#475569"],
    };
    const [bg, border, fg] = verdict[g.verdict];
    const at = new Date(g.quote.asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
    giftHtml = `<div style="margin-top:12px;border-top:1px solid #eef2f6;padding-top:10px">
      <div style="font:800 10px ${F};letter-spacing:1.2px;color:${BRAND.muted};padding-bottom:6px">GIFT NIFTY VS GLOBAL CUES</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -3px;width:calc(100% + 6px)"><tr>
        ${tile("NIFTY CLOSE", whole(g.niftyClose), "last session", BRAND.ink)}
        ${tile("GIFT NIFTY", whole(g.quote.price), `${signed(g.gapPoints, 0)} pts · ${signed(g.gapPercent)}%`, gapColor)}
        ${tile("GLOBAL TONE", g.tonePercent == null ? "—" : `${signed(g.tonePercent)}%`, "overnight tape", toneColor)}</tr></table>
      <div style="margin-top:8px;background:${bg};border:1px solid ${border};border-radius:10px;padding:8px 11px;font:600 12px/1.5 ${F};color:${fg}">${esc(g.text)}${g.levelNote ? ` <span style="font-weight:500">${esc(g.levelNote)}</span>` : ""}</div>
      <div style="font:400 10px/1.5 ${F};color:${BRAND.muted};padding-top:5px">${esc(g.quote.source)} · ${at} IST · unofficial feed, verify before trading.</div></div>`;
  }
  return card(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><span style="font:800 28px/1.1 ${F};color:${s.solid};letter-spacing:-0.8px">${s.icon} ${o.label}</span></td>
      <td align="right"><span style="display:inline-block;border-radius:999px;padding:3px 10px;font:800 10px ${F};letter-spacing:0.6px;background:${s.bg};color:${s.fg}">${o.conviction.toUpperCase()} CONVICTION</span></td></tr></table>
    <div style="padding-top:9px">${bar}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:3px"><tr>
      <td style="font:700 10px ${F};color:#b91c1c">Bearish −${m}</td><td align="center" style="font:800 11px ${F};color:${BRAND.ink}">Score ${o.score > 0 ? "+" : o.score < 0 ? "−" : ""}${Math.abs(o.score)}</td><td align="right" style="font:700 10px ${F};color:#15803d">+${m} Bullish</td></tr></table>
    <div style="font:500 13px/1.5 ${F};color:#334155;padding:9px 0 7px 0">${esc(o.summary)}</div>
    <div>${chips(o.drivers)}</div>${giftHtml}`, "16px", s.solid);
}

export interface IndexRef {
  support: number | null;
  resistance: number | null;
  pivot?: number | null;
  note: string;
}

/** One slim card per index: label, score, driver chips and a single line of reference levels. */
export function indexOutlookCards(indexes: IndexOutlook[], refs: Record<string, IndexRef | undefined>): string {
  const cards = indexes.map((ix) => {
    const s = LABEL_STYLE[ix.label];
    const ref = refs[ix.key];
    const neutral = ix.drivers.filter((d) => d.points === 0);
    const levels = ref && (ref.support != null || ref.resistance != null)
      ? `<div style="font:600 12px ${F};color:#334155;padding-top:6px;border-top:1px solid #eef2f6;margin-top:3px"><span style="color:#15803d">S ${ref.support != null ? whole(ref.support) : "—"}</span>${ref.pivot != null ? ` · <span>P ${whole(ref.pivot)}</span>` : ""} · <span style="color:#b91c1c">R ${ref.resistance != null ? whole(ref.resistance) : "—"}</span></div>`
      : "";
    return card(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td><span style="font:800 16px ${F};color:${BRAND.ink}">${esc(ix.name)}</span></td>
        <td align="right"><span style="display:inline-block;border-radius:999px;padding:3px 9px;font:800 10px ${F};letter-spacing:0.6px;background:${s.bg};color:${s.fg}">${s.icon} ${ix.label.toUpperCase()}</span></td></tr></table>
      <div style="font:600 11px ${F};color:${BRAND.muted};padding:2px 0 6px 0">Score ${ix.score > 0 ? "+" : ix.score < 0 ? "−" : ""}${Math.abs(ix.score)} · ${ix.conviction.toLowerCase()} conviction</div>
      <div>${ix.drivers.length ? `${chips(ix.drivers.filter((d) => d.points !== 0))}${neutral.length ? `<span style="display:inline-block;margin:0 5px 5px 0;border:1px solid #e2e8f0;background:#f8fafc;border-radius:9px;padding:4px 8px;font:600 12px/1.3 ${F};color:${BRAND.muted}">• ${neutral.map((d) => esc(d.label)).join(", ")} neutral</span>` : ""}` : `<span style="font:500 12px ${F};color:${BRAND.muted}">No inputs available.</span>`}</div>
      ${levels}`, "12px 14px", s.solid);
  });
  return grid2(cards);
}

/** Global cues as chip rows, one row per group: green helps India, red hurts. */
export function cueCards(sections: BriefSection[]): string {
  const macro = sections.filter((s) => ["Rates", "Currency", "India"].includes(s.title));
  const merged: BriefSection[] = [
    ...sections.filter((s) => !macro.includes(s)),
    ...(macro.length ? [{ title: "Macro", source: "", lines: macro.flatMap((s) => s.lines) }] : []),
  ];
  const rows = merged.map((section, i) => {
    const pills = section.lines.map((line) => {
      const effect = line.inverseTone ? -line.changePercent : line.changePercent;
      const color = effect > 0 ? "#15803d" : effect < 0 ? "#b91c1c" : "#64748b";
      const bg = effect > 0 ? "#ecfdf3" : effect < 0 ? "#fef2f2" : "#f1f5f9";
      return `<span style="display:inline-block;margin:0 5px 5px 0;border-radius:9px;padding:4px 8px;font:600 12px/1.3 ${F};background:${bg};color:#1e293b;white-space:nowrap">${esc(line.label)} <b style="color:${color}">${signed(line.changePercent)}%</b></span>`;
    }).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${i ? "border-top:1px solid #eef2f6;" : ""}"><tr>
      <td width="76" style="padding:7px 8px 2px 0;vertical-align:top;font:800 10px ${F};letter-spacing:0.8px;color:${BRAND.muted}">${esc(section.title.toUpperCase())}</td>
      <td style="padding:5px 0 0 0">${pills}</td></tr></table>`;
  });
  return card(rows.join(""), "8px 14px");
}

/** One row of three tiles: close and change, then S1 / pivot / R1 for each index. */
export function levelCards(levels: Array<{ label: string; close: number; changePercent: number; pivot: number; support1: number; resistance1: number; zone: string }>): string {
  const w = (100 / Math.max(1, levels.length)).toFixed(1);
  const tiles = levels.map((l) => `<td width="${w}%" style="padding:0 3px;vertical-align:top"><div style="border:1px solid ${BRAND.line};border-radius:12px;background:#ffffff;padding:10px;${SHADOW}">
    <div style="font:800 13px ${F};color:${BRAND.ink}">${esc(l.label)}</div>
    <div style="font:700 12px ${F};color:${l.changePercent >= 0 ? "#15803d" : "#b91c1c"}">${whole(l.close)} <span style="font-weight:800">${signed(l.changePercent)}%</span></div>
    <div style="font:600 12px/1.6 ${F};color:#334155;padding-top:6px;border-top:1px solid #eef2f6;margin-top:6px"><span style="color:#15803d">S1 ${whole(l.support1)}</span><br><span>Pivot ${whole(l.pivot)}</span><br><span style="color:#b91c1c">R1 ${whole(l.resistance1)}</span></div>
    <div style="font:600 10px ${F};color:${BRAND.muted};padding-top:5px">Range ${esc(l.zone)}</div></div></td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -3px 4px -3px;width:calc(100% + 6px)"><tr>${tiles}</tr></table>`;
}

export interface SlimCard {
  num: number;
  symbol: string;
  /** Pill HTML next to the symbol. */
  status: string;
  /** Muted line under the symbol (HTML, already escaped). */
  sub: string;
  priceLabel?: string;
  price: string;
  change?: number | null;
  /** Three values under the header: label, value, small line, colour. */
  cells: Array<[string, string, string | null, string]>;
}

/** A slim stock card: number, symbol, pill and price on top, then three inline values. */
export function slimCard(c: SlimCard): string {
  const changeColor = c.change == null ? BRAND.muted : c.change >= 0 ? "#12814c" : "#b42318";
  const cell = ([label, value, small, color]: SlimCard["cells"][number]) => `<td width="${(100 / c.cells.length).toFixed(1)}%" style="vertical-align:top;padding-right:4px">
    <div style="font:700 9px ${F};letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.muted}">${label}</div>
    <div style="font:800 14px ${F};color:${color};white-space:nowrap;padding-top:1px">${value}</div>
    ${small ? `<div style="font:600 10px ${F};color:${BRAND.muted};white-space:nowrap">${small}</div>` : ""}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:14px;background:#ffffff;margin-bottom:10px;${SHADOW}"><tr><td style="padding:11px 13px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="28" style="vertical-align:top"><div style="width:22px;height:22px;border-radius:7px;background:#0f172a;color:#22c55e;font:800 11px/22px ${F};text-align:center">${c.num}</div></td>
      <td style="vertical-align:top"><div style="font:800 15px ${F};color:${BRAND.ink}">${esc(c.symbol)} ${c.status}</div>
        <div style="font:500 11px/1.4 ${F};color:${BRAND.muted};padding-top:1px">${c.sub}</div></td>
      <td align="right" style="vertical-align:top;white-space:nowrap"><div style="font:800 9px ${F};letter-spacing:0.8px;color:${BRAND.muted}">${c.priceLabel ?? "CMP"}</div>
        <div style="font:800 15px ${F};color:${BRAND.ink}">${c.price}</div>
        ${c.change != null ? `<div style="font:800 11px ${F};color:${changeColor}">${signed(c.change)}%</div>` : ""}</td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-top:1px solid #eef2f6"><tr><td colspan="${c.cells.length}" style="height:7px;font-size:0;line-height:0">&nbsp;</td></tr><tr>${c.cells.map(cell).join("")}</tr></table>
  </td></tr></table>`;
}

/**
 * The index outlook as one compact table card: a row per index with its label, score and support / pivot / resistance, and the
 * drivers that moved the score on a single line underneath. Replaces a tall card per index.
 */
export function indexOutlookTable(indexes: IndexOutlook[], refs: Record<string, IndexRef | undefined>): string {
  const rows = indexes.map((ix, i) => {
    const s = LABEL_STYLE[ix.label];
    const ref = refs[ix.key];
    const score = `${ix.score > 0 ? "+" : ix.score < 0 ? "−" : ""}${Math.abs(ix.score)}`;
    const levels = ref && (ref.support != null || ref.resistance != null)
      ? `<span style="color:#15803d">S ${ref.support != null ? whole(ref.support) : "—"}</span>${ref.pivot != null ? ` · P ${whole(ref.pivot)}` : ""} · <span style="color:#b91c1c">R ${ref.resistance != null ? whole(ref.resistance) : "—"}</span>`
      : `<span style="color:${BRAND.muted}">—</span>`;
    const moved = ix.drivers.filter((d) => d.points !== 0).slice(0, 4);
    const driverLine = moved.length
      ? moved.map((d) => `<span style="color:${d.points > 0 ? "#15803d" : "#b91c1c"}">${d.points > 0 ? "▲" : "▼"}</span> ${esc(d.label)} <b style="color:${d.points > 0 ? "#15803d" : "#b91c1c"}">${d.points > 0 ? "+" : "−"}${Math.abs(d.points)}</b>`).join(" &nbsp; ")
      : ix.drivers.length ? "All inputs neutral" : "No inputs available";
    return `<tr><td style="padding:9px 0 ${i === indexes.length - 1 ? "0" : "9px"} 0;${i ? "border-top:1px solid #eef2f6;" : ""}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font:800 13px ${F};color:${BRAND.ink}"><span>${esc(ix.name)}</span> <span style="font:600 10px ${F};color:${BRAND.muted}">· ${ix.conviction.toLowerCase()} conviction</span></td>
        <td align="right" width="1"><span style="display:inline-block;border-radius:999px;padding:2px 8px;font:800 10px ${F};letter-spacing:0.5px;background:${s.bg};color:${s.fg};white-space:nowrap">${s.icon} ${ix.label.toUpperCase()} ${score}</span></td></tr></table>
      <div style="font:600 12px/1.5 ${F};color:#334155;padding-top:3px">${levels}</div>
      <div style="font:500 11px/1.5 ${F};color:#475569;padding-top:4px">${driverLine}</div></td></tr>`;
  });
  return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`, "6px 14px 12px 14px");
}
