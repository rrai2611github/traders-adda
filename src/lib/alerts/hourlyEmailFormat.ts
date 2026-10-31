import { getMarketStatus, isTradingDay } from "../market/marketHours.ts";
import type { AlertTable, AlertTableRow } from "./scannerAlert.ts";
import { SWING_HOLDING, SWING_LABEL, SWING_RULES, isPlanFooterLine } from "./swingTrade.ts";
import { paText } from "../screen/priceActionRating.ts";
import { FONT, WATCH_CRITERIA, WATCH_TITLE, doNotBuyLine, watchReason, type ListedStock } from "./watchEmail.ts";
import { confluenceLabel, esc, mainSource, noteLine, px, signed, spacer, stockMeta } from "./compactEmail.ts";
import { BRAND, BRAND_STYLE, brandFooter, brandHeader, rulesCard } from "./brand.ts";
import { buildIndexEmailSection, type IndexEmailInput } from "./indexEmailFormat.ts";
import { iconBadge, pill, sectorBars, stockCard, type LevelBox, type Tone } from "./modernCards.ts";
import type { SectorHeatLine } from "../screen/sectorHeatmap.ts";
import type { BottomedOutPick } from "../screen/bottomedOut.ts";
import { entryNoteHtml, entryNoteSuffix } from "./entryState.ts";
import type { ConfluenceIdea } from "./hourlyConfluence.ts";
import { decisionBarHtml, emailDecision, topPicksBlock, type TopPicksEmailInput } from "./topPicksEmail.ts";


const SESSION_START_MINUTES = 9 * 60 + 15;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Hourly slots start at the NSE open: 09:15, 10:15, ... 15:15. */
export function emailSlotKey(now = Date.now()): string | null {
  const market = getMarketStatus(now);
  if (!market.isLive || !isTradingDay(now) || process.env.MARKET_FORCE_LIVE === "1") return null;
  const shifted = new Date(now + IST_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (minutes < SESSION_START_MINUTES || minutes >= 930) return null;
  const slot = Math.floor((minutes - SESSION_START_MINUTES) / 60);
  if (slot < 0) return null;
  return `${market.serverTimeIst.slice(0, 10)}:${slot}`;
}

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** What the last email (or, for the day's first hourly, the pre-open brief) listed. */
export interface HourlyBaseline {
  buy: ListedStock[];
  watch: ListedStock[];
  /** Bullish-confluence symbols in the last email; absent for the day's first hourly. */
  confluence?: string[];
  /** Deep-base bottomed-out symbols in the last email. */
  bottomed?: string[];
  /** Symbols in the tested-setup (Top picks) section of the last email, for the "new since" line. */
  setup?: string[];
}

export interface HourlyChanges {
  /** Buy ready now but not in the last email; not independently verified trigger-cross timing. */
  newBuys: AlertTableRow[];
  /** Still Buy ready since the last email; named in one line, not repeated. */
  stillBuy: AlertTableRow[];
  /** Were Buy ready, no longer are (price fell back or a check failed). */
  lostBuy: ListedStock[];
  /** New on the strong-stocks watch list. */
  addedWatch: AlertTableRow[];
  /** Left the watch list (and did not turn Buy ready). */
  droppedWatch: ListedStock[];
  /** On the watch list in both emails. */
  sameWatch: AlertTableRow[];
}

export function hourlyChanges(table: AlertTable, previous: HourlyBaseline | null): HourlyChanges {
  const rows = table.rows.slice(0, 10);
  const watch = (table.watch ?? []).slice(0, 5);
  const prevBuy = new Set((previous?.buy ?? []).map((s) => s.symbol));
  const prevWatch = new Set((previous?.watch ?? []).map((s) => s.symbol));
  const buyNow = new Set(rows.map((r) => r.symbol));
  const watchNow = new Set(watch.map((r) => r.symbol));
  return {
    newBuys: rows.filter((r) => !prevBuy.has(r.symbol)),
    stillBuy: rows.filter((r) => prevBuy.has(r.symbol)),
    lostBuy: (previous?.buy ?? []).filter((s) => !buyNow.has(s.symbol)),
    addedWatch: watch.filter((r) => !prevWatch.has(r.symbol) && !prevBuy.has(r.symbol)),
    droppedWatch: (previous?.watch ?? []).filter((s) => !watchNow.has(s.symbol) && !buyNow.has(s.symbol)),
    sameWatch: watch.filter((r) => prevWatch.has(r.symbol) || prevBuy.has(r.symbol)),
  };
}

export const hasHourlyChanges = (c: HourlyChanges) =>
  c.newBuys.length + c.lostBuy.length + c.addedWatch.length + c.droppedWatch.length > 0;

/** Row status against the last email, shown in its own column. */
type RowStatus = "new" | "added" | "same" | "wasBuy" | "removed";
const STATUS_PILL: Record<RowStatus, [string, string, string]> = {
  new: ["New", "#dcfce7", "#15803d"],
  added: ["Added", "#dcfce7", "#15803d"],
  same: ["Unchanged", "#f1f5f9", "#475569"],
  wasBuy: ["Was buy", "#fef3c7", "#92400e"],
  removed: ["Removed", "#fee2e2", "#b91c1c"],
};
export const CONFLUENCE_SECTION_NOTE =
  "The 10 strongest stocks where two or more scanner families are bullish and none bearish (families, then RS + price action). The plan applies only if it triggers; trade only Buy ready setups.";

const cmpText = (price: number, change: number | null) => `CMP ${inr(price)}${change != null ? ` (${signed(change)}%)` : ""}`;


export const SECTOR_HEAT_NOTE = "Average 1-day move of each sector's liquid stocks. Context only.";

const sectorText = (line: SectorHeatLine) =>
  `${line.sector}: ${signed(line.changePercent)}% avg move · ${line.above50Percent == null ? "—" : `${Math.round(line.above50Percent)}%`} above 50D · ${line.advancing}/${line.total} advancing`;

export const HOURLY_SECTOR_LIMIT = 5;

export const BOTTOMED_SECTION_NOTE =
  "50%+ below the 52-week high, higher low, back above the 20 EMA. Backtest about +0.1R (thin edge). Experimental, not a buy.";

/** Footnote for the "n/5 scanners" tags: what they count and that they are not a signal. */
export const CONFLUENCE_NOTE = "n/5 scanners = scanner families bullish on the stock. Context only; it never changes the list.";

/**
 * The hourly email repeats the full Buy ready (top 10) and watch (top 5) lists
 * every hour, each row with a Status against the last email (or the pre-open
 * brief for the day's first slot), plus Removed rows for stocks that dropped,
 * so a reader who missed earlier emails still has everything. A separate
 * Bullish confluence top-10 research list follows; it is never a buy signal.
 */
export function buildHourlyEmail(
  table: AlertTable,
  generatedAt: number,
  previous: HourlyBaseline | null = null,
  indexes?: IndexEmailInput,
  setup: TopPicksEmailInput | null = null,
): { subject: string; html: string; text: string; hasChanges: boolean } {
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(generatedAt);
  const ch = hourlyChanges(table, previous);
  const changed = hasHourlyChanges(ch);
  const sessionNote = getMarketStatus(generatedAt).isLive
    ? "Intraday preview: today's daily candle is incomplete. This can change before the close."
    : "Market closed: showing last available session data, not a current intraday reading.";
  const indexSection = indexes ? buildIndexEmailSection(indexes, generatedAt) : null;
  // The tested setup (Blue sky + Multi-year breakouts, same list as the dashboard's Top picks), with what is new since the last email.
  const setupBlock = setup ? topPicksBlock(setup) : null;
  const decision = setup ? emailDecision(setup) : null;
  const setupNow = (setup?.picks ?? []).filter((p) => p.tag === "ready" || p.tag === "broke").map((p) => p.symbol);
  /** One plan per stock: a stock already in Top picks is not given a second, different buy and stop further down. */
  const topSet = new Set(setupNow);
  const SEE_TOP = "Trade plan: see Top picks above";
  const setupNew = previous?.setup ? setupNow.filter((s) => !previous.setup!.includes(s)) : [];
  const setupDropped = previous?.setup ? previous.setup.filter((s) => !setupNow.includes(s)) : [];
  const setupChangeLine = !previous?.setup
    ? ""
    : setupNew.length || setupDropped.length
      ? `Since the last update: ${setupNew.length ? `new ${setupNew.join(", ")}` : "no new stocks"}${setupDropped.length ? `; no longer listed ${setupDropped.join(", ")}` : ""}.`
      : "No change in this list since the last update.";
  const scannerNote = setupBlock ? "The older scanner ideas below use a separate, stricter rule set." : "";
  const watchChanges = ch.addedWatch.length + ch.droppedWatch.length;
  const subject = `Traders Adda hourly · ${
    ch.newBuys.length
      ? `${ch.newBuys.length} new swing Buy ready`
      : changed
        ? "watch list changed"
        : indexSection ? "index update · stock lists unchanged" : "no change"
  }${ch.newBuys.length && watchChanges ? ` · ${watchChanges} watch ${watchChanges === 1 ? "change" : "changes"}` : ""}${setupNow.length ? ` · ${setupNow.length} on the tested setup${setupNew.length ? ` (${setupNew.length} new)` : ""}` : ""} · ${time} IST`;
  const planFooter = table.footer.filter((line) => !isPlanFooterLine(line));
  const footerLines = [SWING_HOLDING, ...planFooter.filter((line) => !/no sure shots/i.test(line))];
  const since = previous ? "since the last update" : "today";
  const ps = table.priceSource;
  // Where prices came from is not news to a reader; only stale prices (a failed refresh, or stocks with no live quote) are worth a line.
  const priceSourceText = !ps ? "" : !ps.refreshed
    ? "Live price refresh failed: prices are from the latest scan, up to about a minute old."
    : ps.covered < ps.total ? `${ps.total - ps.covered} of ${ps.total} stocks kept their scan price (no live quote).` : "";
  const hasConfluence = [...table.rows.slice(0, 10), ...(table.watch ?? []).slice(0, 5)].some((row) => row.confluence);

  const heading = (icon: string, title: string, right = "", tone: Tone | "navy" = "navy") => `<tr><td class="pad" style="padding:26px 26px 10px 26px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="34" style="vertical-align:middle">${iconBadge(icon, tone)}</td>
      <td style="vertical-align:middle;font:800 16px ${FONT};color:${BRAND.ink};letter-spacing:-0.3px">${title}</td>
      ${right ? `<td style="vertical-align:middle;text-align:right;font:700 11px/1.35 ${FONT};color:${BRAND.muted};padding-left:10px">${right}</td>` : ""}
    </tr></table>
  </td></tr>`;
  const block = (html: string) => `<tr><td class="pad" style="padding:0 26px">${html}</td></tr>`;
  const line = (label: string, html: string) =>
    `<tr><td class="pad" style="padding:6px 26px 0 26px;font:400 12px/1.5 ${FONT};color:#334155"><b style="color:${BRAND.ink}">${label}</b> ${html}</td></tr>`;

  // Full lists every hour, each row with its status against the last email, so a reader
  // who missed earlier emails still sees everything that is live now.
  const prevBuy = new Set((previous?.buy ?? []).map((s) => s.symbol));
  const prevWatch = new Set((previous?.watch ?? []).map((s) => s.symbol));
  const buyNow = table.rows.slice(0, 10);
  const watchNow = (table.watch ?? []).slice(0, 5);
  const buyStatus = (row: AlertTableRow): RowStatus => (prevBuy.has(row.symbol) ? "same" : "new");
  const watchStatus = (row: AlertTableRow): RowStatus =>
    prevWatch.has(row.symbol) ? "same" : prevBuy.has(row.symbol) ? "wasBuy" : "added";

  const statusPill = (status: RowStatus) => pill(...STATUS_PILL[status]);
  const tradeBoxes = (row: AlertTableRow, entryLabel: string, entrySub: string): LevelBox[] => {
    const wide = row.riskPercent > 6;
    return [
      { label: entryLabel, value: px(row.entry), sub: entrySub, tone: "blue" },
      { label: "Stop loss", value: px(row.stop), sub: `−${row.riskPercent.toFixed(1)}%${wide ? " ⚠" : ""}`, tone: wide ? "amber" : "red" },
      { label: "Target", value: px(row.target1), sub: `T2 ${px(row.target2)}`, tone: "green" },
    ];
  };
  const rowCard = (row: AlertTableRow, status: RowStatus, entryLabel: string, entrySub: string) => stockCard({
    symbol: row.symbol, status: statusPill(status), sub: `${stockMeta(row)}${entryNoteHtml(row.entryState)}${topSet.has(row.symbol) ? ` · <b>${SEE_TOP}</b>` : ""}`, price: px(row.close), change: row.changePercent,
    boxes: topSet.has(row.symbol) ? [] : tradeBoxes(row, entryLabel, entrySub),
  });
  const removedCard = (stock: ListedStock, why: string) => stockCard({
    symbol: stock.symbol, muted: true, status: statusPill("removed"), sub: `${esc(mainSource(stock.source))} · ${esc(why)}`,
  });
  const buyTable = [
    ...buyNow.map((row) => rowCard(row, buyStatus(row), "Buy above", `skip &gt; ${px(row.buyZoneHigh)}`)),
    ...ch.lostBuy.map((stock) => removedCard(stock, "no longer Buy ready · do not enter")),
  ].join("");
  const watchTable = [
    ...watchNow.map((row) => rowCard(row, watchStatus(row), "Trigger", `close ${px(row.close)}`)),
    ...ch.droppedWatch.map((stock) => removedCard(stock, "dropped off the watch list")),
  ].join("");

  const ideas = table.bullConfluence;
  const prevIdeas = new Set(previous?.confluence ?? []);
  const ideaStatus = (idea: ConfluenceIdea): RowStatus => (prevIdeas.has(idea.symbol) ? "same" : "new");
  const droppedIdeas = (previous?.confluence ?? []).filter((symbol) => !ideas?.some((idea) => idea.symbol === symbol));
  const confluenceTable = ideas?.length
    ? ideas.map((idea) => stockCard({
      symbol: idea.symbol, status: statusPill(ideaStatus(idea)), sub: esc(idea.name), price: px(idea.price), change: idea.changePercent,
      boxes: idea.plan && !topSet.has(idea.symbol) ? [
        { label: "Buy above", value: px(idea.plan.entry), tone: "blue" },
        { label: "Stop loss", value: px(idea.plan.stop), sub: `−${idea.plan.riskPercent.toFixed(1)}%`, tone: "red" },
        { label: "Target", value: px(idea.plan.target1), sub: `T2 ${px(idea.plan.target2)}`, tone: "green" },
      ] : [],
      foot: `<b style="color:${idea.families.length >= 3 ? "#15803d" : "#16a34a"}">${idea.families.length}/${idea.of}</b> ${esc(idea.families.join(" · "))} · RS ${idea.rs ?? "—"} · PA ${idea.pa ?? "—"}${entryNoteHtml(idea.entryState)}${topSet.has(idea.symbol) ? ` · <b>${SEE_TOP}</b>` : ""}`,
    })).join("")
    : "";

  const bottomed = table.bottomedOut;
  const prevBottomed = new Set(previous?.bottomed ?? []);
  const bottomedStatus = (pick: BottomedOutPick): RowStatus => (prevBottomed.has(pick.symbol) ? "same" : "new");
  const droppedBottomed = (previous?.bottomed ?? []).filter((symbol) => !bottomed?.some((pick) => pick.symbol === symbol));
  const showBottomed = !!bottomed;
  /** No deep base today: the list holds early-base stocks, which lost money in the backtest, so they are labelled watch-only. */
  const bottomedEarly = !!bottomed?.length && bottomed.every((pick) => pick.tier === "early");
  const bottomedName = bottomedEarly ? "early base" : "deep base";
  const sectors = table.sectorHeat?.length ? table.sectorHeat : null;
  const bottomedTable = bottomed?.length
    ? bottomed.map((pick) => stockCard({
      symbol: pick.symbol, status: statusPill(bottomedStatus(pick)), sub: `${esc(pick.name)} · RS ${pick.rs ?? "—"}`, price: px(pick.close), change: null,
      boxes: [
        { label: "Base low", value: px(pick.lowPrice), sub: `${pick.lowAgeSessions} sessions ago`, tone: "slate" },
        { label: "Stop loss", value: px(pick.stop), sub: "−8%", tone: "red" },
        { label: "Target", value: px(pick.target), sub: "+16%", tone: "green" },
      ],
      foot: `<b style="color:#b42318">−${pick.fromHighPercent.toFixed(0)}%</b> from 52-week high · +${pick.offLowPercent.toFixed(0)}% off the low${pick.rsiDivergence ? " · RSI divergence" : ""}`,
    })).join("")
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<title>${esc(table.brand)} hourly update</title>
${BRAND_STYLE}</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page}"><tr><td align="center" class="outer" style="padding:24px 10px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="container" style="width:100%;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border-collapse:separate">
  ${brandHeader({
    kicker: indexSection ? "Hourly index update · full stock lists" : "Hourly update · full stock lists",
    title: ch.newBuys.length
      ? `${ch.newBuys.length} new swing ${ch.newBuys.length === 1 ? "setup is" : "setups are"} Buy ready`
      : changed
        ? "Watch list changed"
        : indexSection ? "Index update · stock lists unchanged" : "No change this hour",
    subtitle: `${time} IST · changes ${since}`,
    stats: [
      { label: "Breadth", value: `${table.breadth ?? "—"}%`, color: table.healthy ? BRAND.green : "#fbbf24" },
      { label: "New buys", value: String(ch.newBuys.length), color: ch.newBuys.length ? BRAND.green : "#ffffff" },
      { label: "Watch changes", value: String(watchChanges), color: "#93c5fd" },
    ],
  })}
${decision ? `${spacer(10)}${block(decisionBarHtml(decision))}${spacer(4)}` : ""}
${indexSection ? `${heading("↔", "Hourly index analysis", "Latest available · provisional")}${block(indexSection.html)}` : ""}
${setupBlock ? `
  ${heading("✓", "Tested setup — Top picks now", `${setupNow.length} to watch or buy`, "green")}
  ${block(`${setupChangeLine ? `${noteLine(esc(setupChangeLine), "#eff6ff", "#bfdbfe", "#1e3a8a")}${spacer(8)}` : ""}${setupBlock.html}`)}
  ${block(noteLine(esc(scannerNote), "#f8fafc", "#e2e8f0", "#475569"))}` : ""}
${sectors ? `
  ${heading("▦", "Sector heat", `top ${sectors.length} · hottest first`, "amber")}
  ${block(sectorBars(sectors))}` : ""}
${buyNow.length || ch.lostBuy.length ? `
  ${heading("↗", "Buy ready now", `${buyNow.length} ${buyNow.length === 1 ? "stock" : "stocks"} · ${ch.newBuys.length} new · ${SWING_LABEL}`, "green")}
  ${block(buyTable)}
  ${buyNow.length ? `<tr><td class="pad" style="padding:12px 26px 0 26px">${rulesCard("How to trade these swing setups", SWING_RULES)}</td></tr>` : ""}` : ""}
${watchNow.length || ch.droppedWatch.length ? `
  ${heading("◉", "Strong stocks on watch — do not buy yet", `${watchNow.length} ${watchNow.length === 1 ? "stock" : "stocks"} · ${watchChanges} ${watchChanges === 1 ? "change" : "changes"}`, "amber")}
  ${block(`${decision?.kind === "paper" ? "" : `${doNotBuyLine(table)}${spacer(8)}`}${watchTable}<div style="font:400 10px/1.5 ${FONT};color:${BRAND.muted};padding-top:6px">Filters: ${esc(WATCH_CRITERIA)}</div>`)}` : ""}
${ideas ? `
  ${heading("≋", "Bullish confluence — where the scanners agree", `${ideas.length} ${ideas.length === 1 ? "stock" : "stocks"} · not a buy`, "blue")}
  ${block(`${
    confluenceTable || `<div style="font:400 12px ${FONT};color:${BRAND.muted}">No liquid stock has two or more scanner families agreeing right now.</div>`}`)}
  ${droppedIdeas.length ? line("Dropped out of the list:", esc(droppedIdeas.join(", "))) : ""}` : ""}
${showBottomed ? `
  ${heading("▼", `Bottomed out — ${bottomedName}`, `${bottomed!.length} ${bottomed!.length === 1 ? "stock" : "stocks"} · ${bottomedEarly ? "no deep base today · watch only" : "experimental"} · not a buy`, "red")}
  ${block(`${
    bottomedTable || `<div style="font:400 12px ${FONT};color:${BRAND.muted}">No bottomed-out stock right now.</div>`}`)}
  ${droppedBottomed.length ? line("No longer on the list:", esc(droppedBottomed.join(", "))) : ""}` : ""}
${hasConfluence ? `<tr><td class="pad" style="padding:8px 26px 0 26px;font:400 10px/1.5 ${FONT};color:${BRAND.muted}">${esc(CONFLUENCE_NOTE)}</td></tr>` : ""}
${changed ? "" : `
  <tr><td class="pad" style="padding:22px 26px 0 26px">${noteLine(indexSection
    ? `🛡️ <b>Stock lists unchanged ${since}.</b>`
    : `🛡️ <b>Nothing new ${since}.</b> The morning plan stands.`, "#f0fdf4", "#bbf7d0", "#14532d")}</td></tr>`}
  <tr><td class="pad" style="padding:16px 26px 22px 26px">
    ${priceSourceText ? noteLine(esc(priceSourceText), "#fefce8", "#fde68a", "#713f12") : ""}
  </td></tr>
  ${brandFooter(footerLines, `© ${new Date(generatedAt).getFullYear()} ${table.brand}`)}
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `${table.brand} · Hourly update — full lists, status ${since}`,
    `${time} IST · Breadth ${table.breadth ?? "—"}%`,
    ...(decision ? [`TODAY'S ACTION: ${decision.headline}`] : []),
    sessionNote,
    ...(priceSourceText ? [priceSourceText] : []),
    `${SWING_LABEL}s, not intraday: ${SWING_HOLDING}`,
    ...(indexSection ? ["", "HOURLY INDEX ANALYSIS — LATEST AVAILABLE / PROVISIONAL", ...indexSection.text] : []),
    ...(setupBlock ? ["", "TESTED SETUP — TOP PICKS NOW", ...(setupChangeLine ? [setupChangeLine] : []), ...setupBlock.text, scannerNote] : []),
    ...(sectors ? ["", `SECTOR HEAT — TOP ${sectors.length}, HOTTEST FIRST`, ...sectors.map(sectorText)] : []),
    ...(buyNow.length || ch.lostBuy.length
      ? [
          "",
          `BUY READY NOW (${buyNow.length} · ${ch.newBuys.length} new)`,
          ...buyNow.flatMap((row, i) => [
            `${i + 1}. [${STATUS_PILL[buyStatus(row)][0]}] ${row.symbol} · ${cmpText(row.close, row.changePercent)}${entryNoteSuffix(row.entryState)} · ${SWING_LABEL} · ${row.source} · ${row.statusLabel}`,
            `   ${topSet.has(row.symbol) ? SEE_TOP : `Buy > ${inr(row.entry)} (skip > ${inr(row.buyZoneHigh)}) · SL ${inr(row.stop)} (−${row.riskPercent.toFixed(1)}%) · T1 ${inr(row.target1)} · T2 ${inr(row.target2)}`} · RS ${row.rs ?? "—"} · PA ${paText(row.pa)} · Osc ${row.score?.toFixed(1) ?? "—"}${confluenceLabel(row) ? ` · ${confluenceLabel(row)}` : ""}`,
          ]),
          ...ch.lostBuy.map((stock) => `- [Removed] ${stock.symbol} · no longer Buy ready, do not enter`),
          ...(buyNow.length ? ["", "HOW TO TRADE THESE SWING SETUPS", ...SWING_RULES.map((rule, i) => `${i + 1}. ${rule}`)] : []),
        ]
      : []),
    ...(watchNow.length || ch.droppedWatch.length
      ? [
          "",
          `${WATCH_TITLE.toUpperCase()} (${watchNow.length} · ${watchChanges} ${watchChanges === 1 ? "change" : "changes"})`,
          watchReason(table),
          ...watchNow.map((row, i) =>
            `${i + 1}. [${STATUS_PILL[watchStatus(row)][0]}] ${row.symbol} · ${cmpText(row.close, row.changePercent)}${entryNoteSuffix(row.entryState)} · ${row.source} · ${topSet.has(row.symbol) ? SEE_TOP : `trigger ${inr(row.entry)} · SL ${inr(row.stop)} (−${row.riskPercent.toFixed(1)}%) · T1 ${inr(row.target1)} · T2 ${inr(row.target2)}`} · RS ${row.rs ?? "—"}${confluenceLabel(row) ? ` · ${confluenceLabel(row)}` : ""}`),
          ...ch.droppedWatch.map((stock) => `- [Removed] ${stock.symbol} · dropped off the watch list`),
          `Filters: ${WATCH_CRITERIA}`,
        ]
      : []),
    ...(ideas
      ? [
          "",
          `BULLISH CONFLUENCE — WHERE THE SCANNERS AGREE (${ideas.length}, NOT A BUY)`,
          ...(ideas.length
            ? ideas.map((idea, i) =>
              `${i + 1}. [${STATUS_PILL[ideaStatus(idea)][0]}] ${idea.symbol} · ${idea.families.length}/${idea.of} families (${idea.families.join(", ")}) · ${idea.scanners.join(", ")} · ${cmpText(idea.price, idea.changePercent)}${entryNoteSuffix(idea.entryState)} · RS ${idea.rs ?? "—"} · PA ${idea.pa ?? "—"}${topSet.has(idea.symbol) ? ` · ${SEE_TOP}` : idea.plan ? ` · Buy > ${inr(idea.plan.entry)} · SL ${inr(idea.plan.stop)} (−${idea.plan.riskPercent.toFixed(1)}%) · T1 ${inr(idea.plan.target1)} · T2 ${inr(idea.plan.target2)}` : ""}`)
            : ["No liquid stock has two or more scanner families agreeing right now."]),
          ...(droppedIdeas.length ? [`Dropped out of the list: ${droppedIdeas.join(", ")}`] : []),
        ]
      : []),
    ...(showBottomed
      ? [
          "",
          `BOTTOMED OUT — ${bottomedName.toUpperCase()} (${bottomed!.length} · ${bottomedEarly ? "NO DEEP BASE TODAY, WATCH ONLY" : "EXPERIMENTAL"}, NOT A BUY)`,
          ...(bottomed!.length
            ? bottomed!.map((pick, i) =>
              `${i + 1}. [${STATUS_PILL[bottomedStatus(pick)][0]}] ${pick.symbol} · CMP ${inr(pick.close)} · −${pick.fromHighPercent.toFixed(0)}% from high · low ${inr(pick.lowPrice)} (${pick.lowAgeSessions} sessions ago, +${pick.offLowPercent.toFixed(0)}% off) · SL ${inr(pick.stop)} · T ${inr(pick.target)} · RS ${pick.rs ?? "—"}`)
            : ["No bottomed-out stock right now."]),
          ...(droppedBottomed.length ? [`No longer on the list: ${droppedBottomed.join(", ")}`] : []),
        ]
      : []),
    ...(hasConfluence ? ["", CONFLUENCE_NOTE] : []),
    ...(changed ? [] : ["", indexSection
      ? `Stock lists unchanged ${since}.`
      : `Nothing new ${since}. The morning plan stands.`]),
    "",
    ...planFooter,
  ].join("\n");
  return { subject, html, text, hasChanges: changed };
}