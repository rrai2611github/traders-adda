import { esc, pill } from "./modernCards.ts";
import { px, spacer } from "./compactEmail.ts";
import type { PickAnalysis, PickVerdict } from "../screen/pickAnalysis.ts";
import type { PickTag } from "../screen/topPicks.ts";
import type { NewsNote } from "../ai/newsCheck.ts";
import { setupStatus } from "../screen/setupGate.ts";
import { callProgress, shortDay, type PickCall } from "../radar/pickCalls.ts";
import { pickTerm } from "../screen/pickTerm.ts";

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
  /** The first call and time on the list; absent when the email was built without the track record. */
  firstCall?: PickCall | null;
}

export interface TopPicksEmailInput {
  breadth50: number | null;
  size: { key: "full" | "quarter" | "paper"; label: string; detail: string };
  /** The Nifty 50 against its 200-day average, when known. */
  nifty?: { above: boolean; percent: number } | null;
  picks: TopPickEmailItem[];
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const VERDICT: Record<PickVerdict, { label: string; bg: string; fg: string; bar: string }> = {
  buy: { label: "Buy plan ready", bg: "#dcfce7", fg: "#15803d", bar: "#16a34a" },
  paper: { label: "Paper trade", bg: "#fee2e2", fg: "#b91c1c", bar: "#ef4444" },
  wait: { label: "Wait", bg: "#fef3c7", fg: "#b45309", bar: "#f59e0b" },
  skip: { label: "Do not chase", bg: "#e2e8f0", fg: "#475569", bar: "#94a3b8" },
};

const CAVEAT = "Tested rule: buy a Blue sky or Multi-year breakout on the day it breaks out, only while 35%+ of stocks are above their 50-day average. Stop about 12% below, exit on a close under the 50-day average; targets only mark places to book part profit. 10-year test: about 46% a year, worst drop about 21%, about 45% of trades win; it only includes stocks listed today, so real results are likely lower. Check results dates before buying.";

const NEWS_COLOR = { clear: "#475569", watch: "#b45309", caution: "#b42318" } as const;
const NEWS_NOTE = "News check: an AI-written one-line summary of each stock's NSE announcements from the last 14 days. It can miss or misread a filing, so open the announcements before you trade.";

/** Cards shown on a day real buys are blocked; the rest are listed by name. */
const PAPER_DAY_CARDS = 3;

const buyable = (p: TopPickEmailItem) => p.tag === "ready" || p.tag === "broke";
const cell = (label: string, value: string, sub: string | null, color: string) => `<td width="33%" valign="top" style="padding-right:4px"><div style="font:700 9px ${FONT};letter-spacing:0.6px;text-transform:uppercase;color:#64748b">${label}</div><div style="font:800 14px/1.25 ${FONT};color:${color}">${value}</div>${sub ? `<div style="font:600 10px ${FONT};color:#64748b">${sub}</div>` : ""}</td>`;

const TAG_NAME: Record<string, string> = { ready: "Ready", broke: "Just broke out", watch: "Watch", extended: "Extended" };
/** Two decimals, so a first call reads exactly as it does on the Today page (the email's usual rounding would turn 381.25 into 381.3). */
const price2 = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedPercent = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/**
 * What the email says about a pick's history. A buyable pick with a saved call keeps that call's levels fixed (the levels in the card's
 * numbers move every day); one that has been on the list but has no buy call yet, or is new, says that today's levels are the first call.
 */
export function firstCallParts(p: TopPickEmailItem): { lines: string[]; hasCall: boolean } {
  const saved = p.firstCall ?? null;
  const call = saved?.call ?? null;
  if (!call) {
    const since = saved ? `On the list since ${shortDay(saved.onListSince)}${saved.firstTag && saved.firstTag !== p.tag ? ` (first as ${TAG_NAME[saved.firstTag] ?? saved.firstTag})` : ""}. ` : "New today. ";
    return { lines: [`${since}The levels above are the first call.`], hasCall: false };
  }
  const progress = callProgress(call, p.price);
  const levels = [`buy ${price2(call.buy)}`, call.stop != null ? `stop ${price2(call.stop)}` : null, call.target1 != null ? `T1 ${price2(call.target1)}` : null, call.target2 != null ? `T2 ${price2(call.target2)}` : null].filter(Boolean).join(" · ");
  const now = progress
    ? `Now ${signedPercent(progress.changePercent)} against the call${progress.key === "in-zone" ? "" : ` (${progress.label.toLowerCase()})`}${saved && saved.sessions > 0 ? ` · session ${saved.sessions}` : ""} · on the list since ${shortDay(saved!.onListSince)}`
    : `On the list since ${shortDay(saved!.onListSince)}`;
  return { lines: [`First call ${shortDay(call.day)} (${TAG_NAME[call.tag]}): ${levels}`, now], hasCall: true };
}

const TERM = pickTerm();
const FIRST_CALL_NOTE = `First call: the first Ready or Just-broke-out listing, its levels kept fixed while the stock stays on the list; the "today" levels move every day. ${TERM.label}: ${TERM.headline.split(": ")[1]} in the 10-year test, not a time limit.`;

/** One short card: name and verdict, the three numbers that matter, then a single line of reasons and cautions. */
function compactCard(p: TopPickEmailItem, index: number): string {
  const a = p.analysis;
  const v = VERDICT[a.verdict];
  const plan = a.plan;
  const history = firstCallParts(p);
  const today = history.hasCall ? " today" : "";
  const position = p.ext == null ? "" : `${Math.abs(p.ext).toFixed(1)}% ${p.ext <= 0 ? "under" : "past"} its level`;
  const cells = plan
    ? `${cell(`Buy${today}`, px(plan.buy), p.tag === "ready" ? "close above" : "near", "#1d4ed8")}${cell(`Stop${today}`, px(plan.stop), `−${plan.stopPercent}%`, "#b42318")}${plan.targets ? cell(`Target${today}`, px(plan.targets.t1), `+${plan.targets.t1Percent}% · T2 ${px(plan.targets.t2)}`, "#12814c") : cell("RS", String(Math.round(p.rs)), null, "#0f172a")}`
    : `${cell("Last close", px(p.price), null, "#0f172a")}${cell("Position", position || "—", null, "#0f172a")}${cell("RS", String(Math.round(p.rs)), null, "#0f172a")}`;
  const chips = [`<span style="color:#334155">RS ${Math.round(p.rs)}${position ? ` · ${esc(position)}` : ""}</span>`, ...a.chips.map((c) => `<span style="color:#12814c">✓ ${esc(c)}</span>`), ...a.flags.map((f) => `<span style="color:#b45309">⚠ ${esc(f)}</span>`)].join(" &nbsp; ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-left:4px solid ${v.bar};border-radius:10px;background:#ffffff;margin-bottom:8px"><tr><td style="padding:9px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font:800 14px ${FONT};color:#0f172a">${index}. ${esc(p.symbol)}</td>
      <td align="right">${pill(esc(a.status), v.bg, v.fg)} ${pill(esc(TERM.label), "#eef2ff", "#3730a3")}</td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr>${cells}</tr></table>
    ${chips ? `<div style="font:600 11px/1.5 ${FONT};padding-top:6px">${chips}</div>` : ""}
    <div style="font:600 11px/1.5 ${FONT};color:#1e3a8a;background:#eff6ff;border-radius:6px;padding:5px 8px;margin-top:6px">${history.lines.map((line, i) => (i === 0 && history.hasCall ? `<b>${esc(line)}</b>` : esc(line))).join("<br>")}</div>
    ${p.news ? `<div style="font:500 11px/1.45 ${FONT};color:${NEWS_COLOR[p.news.flag]};padding-top:4px"><b>News check:</b> ${esc(p.news.note)}</div>` : ""}
  </td></tr></table>`;
}

const waitText = (p: TopPickEmailItem) => `${p.symbol} (RS ${Math.round(p.rs)}): ${p.analysis.flags.length ? p.analysis.flags.join(", ") : "not buyable yet"}`;

/** What today is for, in one decision the email can lead with (and put in its subject). */
export interface EmailDecision {
  kind: "buy" | "paper" | "none";
  /** The big words at the top of the email, with no reasons and (on a no-buy day) no stock names. */
  title: string;
  /** The one reason, in small type under the title. */
  detail: string;
  /** Title and detail as one sentence, for the plain-text version. */
  headline: string;
  /** A few words for the subject line. */
  subjectBit: string;
}

export function emailDecision(input: TopPicksEmailInput): EmailDecision {
  const candidates = input.picks.filter(buyable);
  const names = candidates.slice(0, 4).map((p) => p.symbol).join(", ");
  const more = candidates.length > 4 ? ` and ${candidates.length - 4} more` : "";
  const gate = setupStatus(input.breadth50, input.nifty ?? null);
  const make = (kind: EmailDecision["kind"], title: string, detail: string, subjectBit: string): EmailDecision => ({ kind, title, detail, headline: `${title}. ${detail}`, subjectBit });
  if (!candidates.length) {
    return make("none", "No new buys today", "No stock is at a breakout level right now.", "No new buys today");
  }
  // The stock names are in Top picks right below, so a no-buy day does not repeat them here.
  if (!gate.allowed) {
    return make("paper", "Do not buy today", `Market check not passed: ${gate.reason}.`, "No new buys (market weak)");
  }
  return make("buy", `Buy candidates today: ${names}${more}`, `Market check passed: ${gate.reason}.`, `Buy candidates: ${candidates.slice(0, 3).map((p) => p.symbol).join(", ")}`);
}

const DECISION_COLORS = {
  buy: ["#f0fdf4", "#86efac", "#14532d", "#16a34a"],
  paper: ["#fef2f2", "#fecaca", "#7f1d1d", "#ef4444"],
  none: ["#fffbeb", "#fde68a", "#713f12", "#f59e0b"],
} as const;

/** The bar at the top of an email: a tiny label, the decision in big words, and the one reason in small type. */
export function decisionBarHtml(decision: EmailDecision): string {
  const [bg, border, color, bar] = DECISION_COLORS[decision.kind];
  return `<div style="background:${bg};border:1px solid ${border};border-left:5px solid ${bar};border-radius:10px;padding:9px 14px"><div style="font:800 9.5px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${color};opacity:0.75">Today's action</div><div style="font:800 18px/1.3 ${FONT};color:${color};padding-top:1px">${esc(decision.title)}</div><div style="font:500 12.5px/1.5 ${FONT};color:${color};padding-top:2px;opacity:0.9">${esc(decision.detail)}</div></div>`;
}

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
  const buy = input.picks.filter(buyable);
  const waits = input.picks.filter((p) => !buyable(p));
  const blocked = !setupStatus(input.breadth50, input.nifty ?? null).allowed;
  // On a day real buys are blocked every card says "paper trade", so show the first few and list the rest by name.
  const shown = blocked ? buy.slice(0, PAPER_DAY_CARDS) : buy;
  const rest = buy.slice(shown.length);
  const restText = rest.length ? `Also on the list (paper only): ${rest.map((p) => `${p.symbol} (RS ${Math.round(p.rs)})`).join(", ")}.` : "";
  const cards = shown.length ? shown.map((p, i) => compactCard(p, i + 1)).join("") : "";
  const restHtml = restText ? `<div style="font:400 12px/1.5 ${FONT};color:#475569;padding:2px 0 6px">${esc(restText)}</div>` : "";
  const waitHtml = waits.length
    ? `<div style="font:400 12px/1.5 ${FONT};color:#475569;padding:2px 0 4px"><b>Strong, but wait:</b> ${esc(waits.map(waitText).join(" · "))}</div>`
    : "";
  const hasNews = input.picks.some((p) => p.news);
  const html = `${cards}${restHtml}${waitHtml}${spacer(2)}<div style="font:400 11px/1.5 ${FONT};color:#64748b">${esc(CAVEAT)}${shown.length ? ` ${esc(FIRST_CALL_NOTE)}` : ""}${hasNews ? ` ${esc(NEWS_NOTE)}` : ""}</div>`;
  const text = [
    ...shown.map((p, i) => {
      const a = p.analysis;
      const levels = a.plan ? `buy ${px(a.plan.buy)} · stop ${px(a.plan.stop)} (−${a.plan.stopPercent}%)` : `last ${px(p.price)}`;
      const position = p.ext == null ? "" : ` · ${Math.abs(p.ext).toFixed(1)}% ${p.ext <= 0 ? "under" : "past"} its level`;
      const notes = [...a.chips.map((c) => `+ ${c}`), ...a.flags.map((f) => `! ${f}`)].join(", ");
      const target = a.plan?.targets ? ` · target ${px(a.plan.targets.t1)} (+${a.plan.targets.t1Percent}%) / ${px(a.plan.targets.t2)} (+${a.plan.targets.t2Percent}%)` : "";
      const history = firstCallParts(p);
      const todays = history.hasCall ? "today's levels: " : "";
      return `${i + 1}. ${p.symbol} · ${a.status.toUpperCase()} · RS ${Math.round(p.rs)} · ${todays}${levels}${target}${position} · ${TERM.label.toUpperCase()}${notes ? ` · ${notes}` : ""}${p.news ? ` · NEWS CHECK (${p.news.flag}): ${p.news.note}` : ""}
   ${history.lines.join(" | ")}`;
    }),
    ...(restText ? [restText] : []),
    ...(waits.length ? [`Strong, but wait: ${waits.map(waitText).join(" · ")}`] : []),
    CAVEAT,
    ...(shown.length ? [FIRST_CALL_NOTE] : []),
    ...(hasNews ? [NEWS_NOTE] : []),
  ];
  return { html, text };
}
