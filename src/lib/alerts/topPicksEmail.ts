import { esc, pill } from "./modernCards.ts";
import { noteLine, px, spacer } from "./compactEmail.ts";
import type { PickAnalysis, PickVerdict } from "../screen/pickAnalysis.ts";
import type { PickTag } from "../screen/topPicks.ts";
import type { NewsNote } from "../ai/newsCheck.ts";
import { setupStatus } from "../screen/setupGate.ts";

/** What the email needs of one analysed pick (the full AnalysedPick satisfies it). */
export interface TopPickEmailItem {
  symbol: string;
  name: string | null;
  sector: string | null;
  tag: PickTag;
  rs: number;
  price: number;
  /** The AI news check's note, when the check ran. */
  news?: NewsNote | null;
  /** Percent under (negative) or past (positive) the breakout level. */
  ext: number | null;
  analysis: PickAnalysis;
}

export interface TopPicksEmailInput {
  breadth50: number | null;
  size: { key: "full" | "quarter" | "paper"; label: string; detail: string };
  /** The Nifty 50 against its 200-day average, when known. */
  nifty?: { above: boolean; percent: number } | null;
  picks: TopPickEmailItem[];
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SIZE_NOTE = {
  full: ["#f0fdf4", "#bbf7d0", "#14532d"],
  quarter: ["#fffbeb", "#fde68a", "#713f12"],
  paper: ["#fef2f2", "#fecaca", "#7f1d1d"],
} as const;
const VERDICT: Record<PickVerdict, { label: string; bg: string; fg: string; bar: string }> = {
  buy: { label: "Buy plan ready", bg: "#dcfce7", fg: "#15803d", bar: "#16a34a" },
  paper: { label: "Paper trade", bg: "#fee2e2", fg: "#b91c1c", bar: "#ef4444" },
  wait: { label: "Wait", bg: "#fef3c7", fg: "#b45309", bar: "#f59e0b" },
  skip: { label: "Do not chase", bg: "#e2e8f0", fg: "#475569", bar: "#94a3b8" },
};

const CAVEAT = "The tested rule: buy a Blue sky or Multi-year breakout on the day it breaks out, only while at least 35% of stocks are above their 50-day average. Stop about 12% below the buy price, with a smaller position so the money at risk stays the same. Exit when it closes under its 50-day average, not when it first goes up; targets are only places to book part profit. Hold at most 10 positions and add at most 3 a day. 10-year backtest of this approach: about 46% a year with a worst drop of about 21%; only about 45% of trades win. The history only includes stocks listed today, so real results are likely lower. Check results dates before buying. Research output, not advice.";

const NEWS_COLOR = { clear: "#475569", watch: "#b45309", caution: "#b42318" } as const;
const NEWS_NOTE = "News check: an AI-written one-line summary of each stock's NSE announcements from the last 14 days. It can miss or misread a filing, so open the announcements before you trade.";

const buyable = (p: TopPickEmailItem) => p.tag === "ready" || p.tag === "broke";
const cell = (label: string, value: string, sub: string | null, color: string) => `<td width="33%" valign="top" style="padding-right:4px"><div style="font:700 9px ${FONT};letter-spacing:0.6px;text-transform:uppercase;color:#64748b">${label}</div><div style="font:800 14px/1.25 ${FONT};color:${color}">${value}</div>${sub ? `<div style="font:600 10px ${FONT};color:#64748b">${sub}</div>` : ""}</td>`;

/** One short card: name and verdict, the three numbers that matter, then a single line of reasons and cautions. */
function compactCard(p: TopPickEmailItem, index: number): string {
  const a = p.analysis;
  const v = VERDICT[a.verdict];
  const plan = a.plan;
  const position = p.ext == null ? "" : `${Math.abs(p.ext).toFixed(1)}% ${p.ext <= 0 ? "under" : "past"} its level`;
  const cells = plan
    ? `${cell("Buy", px(plan.buy), p.tag === "ready" ? "close above" : "near", "#1d4ed8")}${cell("Stop", px(plan.stop), `−${plan.stopPercent}%`, "#b42318")}${plan.targets ? cell("Target", px(plan.targets.t1), `+${plan.targets.t1Percent}% · T2 ${px(plan.targets.t2)}`, "#12814c") : cell("RS", String(Math.round(p.rs)), null, "#0f172a")}`
    : `${cell("Last close", px(p.price), null, "#0f172a")}${cell("Position", position || "—", null, "#0f172a")}${cell("RS", String(Math.round(p.rs)), null, "#0f172a")}`;
  const chips = [`<span style="color:#334155">RS ${Math.round(p.rs)}${position ? ` · ${esc(position)}` : ""}</span>`, ...a.chips.map((c) => `<span style="color:#12814c">✓ ${esc(c)}</span>`), ...a.flags.map((f) => `<span style="color:#b45309">⚠ ${esc(f)}</span>`)].join(" &nbsp; ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-left:4px solid ${v.bar};border-radius:10px;background:#ffffff;margin-bottom:8px"><tr><td style="padding:9px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font:800 14px ${FONT};color:#0f172a">${index}. ${esc(p.symbol)}</td>
      <td align="right">${pill(esc(a.status), v.bg, v.fg)}</td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr>${cells}</tr></table>
    ${chips ? `<div style="font:600 11px/1.5 ${FONT};padding-top:6px">${chips}</div>` : ""}
    ${p.news ? `<div style="font:500 11px/1.45 ${FONT};color:${NEWS_COLOR[p.news.flag]};padding-top:4px"><b>News check:</b> ${esc(p.news.note)}</div>` : ""}
  </td></tr></table>`;
}

const waitText = (p: TopPickEmailItem) => `${p.symbol} (RS ${Math.round(p.rs)}): ${p.analysis.flags.length ? p.analysis.flags.join(", ") : "not buyable yet"}`;

/** The one line that tells you what today is for. */
export function todayLine(input: TopPicksEmailInput): string {
  const candidates = input.picks.filter(buyable);
  const names = candidates.slice(0, 4).map((p) => p.symbol).join(", ");
  const more = candidates.length > 4 ? ` and ${candidates.length - 4} more` : "";
  const gate = setupStatus(input.breadth50, input.nifty ?? null);
  if (!candidates.length) return `No stock is under its breakout level or just through it. Market check: ${gate.reason}. Not picking is a valid answer.`;
  if (!gate.allowed) return `Market check not passed: ${gate.reason}. Paper trade only, no real buys. Watch ${names}${more}.`;
  return `Market check passed: ${gate.reason}. Candidates: ${names}${more}.`;
}

/** The email section: the market note, one short card per buyable stock, one line for the stocks to wait on. */
export function topPicksBlock(input: TopPicksEmailInput): { html: string; text: string[] } {
  const [bg, border, color] = SIZE_NOTE[setupStatus(input.breadth50, input.nifty ?? null).allowed ? "full" : "paper"];
  const note = noteLine(`<b>${esc(todayLine(input))}</b>`, bg, border, color);
  const buy = input.picks.filter(buyable);
  const waits = input.picks.filter((p) => !buyable(p));
  const cards = buy.length ? buy.map((p, i) => compactCard(p, i + 1)).join("") : "";
  const waitHtml = waits.length
    ? `<div style="font:400 12px/1.5 ${FONT};color:#475569;padding:2px 0 4px"><b>Strong, but wait:</b> ${esc(waits.map(waitText).join(" · "))}</div>`
    : "";
  const hasNews = input.picks.some((p) => p.news);
  const html = `${note}${spacer(8)}${cards}${waitHtml}${spacer(2)}<div style="font:400 11px/1.5 ${FONT};color:#64748b">${esc(CAVEAT)}${hasNews ? ` ${esc(NEWS_NOTE)}` : ""}</div>`;
  const text = [
    todayLine(input),
    ...buy.map((p, i) => {
      const a = p.analysis;
      const levels = a.plan ? `buy ${px(a.plan.buy)} · stop ${px(a.plan.stop)} (−${a.plan.stopPercent}%)` : `last ${px(p.price)}`;
      const position = p.ext == null ? "" : ` · ${Math.abs(p.ext).toFixed(1)}% ${p.ext <= 0 ? "under" : "past"} its level`;
      const notes = [...a.chips.map((c) => `+ ${c}`), ...a.flags.map((f) => `! ${f}`)].join(", ");
      const target = a.plan?.targets ? ` · target ${px(a.plan.targets.t1)} (+${a.plan.targets.t1Percent}%) / ${px(a.plan.targets.t2)} (+${a.plan.targets.t2Percent}%)` : "";
      return `${i + 1}. ${p.symbol} · ${a.status.toUpperCase()} · RS ${Math.round(p.rs)} · ${levels}${target}${position}${notes ? ` · ${notes}` : ""}${p.news ? ` · NEWS CHECK (${p.news.flag}): ${p.news.note}` : ""}`;
    }),
    ...(waits.length ? [`Strong, but wait: ${waits.map(waitText).join(" · ")}`] : []),
    CAVEAT,
    ...(hasNews ? [NEWS_NOTE] : []),
  ];
  return { html, text };
}
