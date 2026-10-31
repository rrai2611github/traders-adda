import { isTradingDay } from "../market/marketHours.ts";
import type { AlertTable, AlertTableRow } from "./scannerAlert.ts";
import { HEALTHY_BREADTH_PERCENT } from "../screen/breadth.ts";
import { SWING_HOLDING, SWING_LABEL, SWING_RULES, isPlanFooterLine } from "./swingTrade.ts";
import { paText } from "../screen/priceActionRating.ts";
import { doNotBuyLine, watchText } from "./watchEmail.ts";
import { noteLine, px, screenerLine, spacer } from "./compactEmail.ts";
import { BRAND, BRAND_FONT, BRAND_STYLE, LOGO_CID, brandFooter, rulesCard } from "./brand.ts";
import type { MorningBrief } from "../screen/morningBrief.ts";
import { buildMarketOutlook, type MarketOutlook } from "../screen/marketOutlook.ts";
import { buildIndexEmailSection, shortLeadership, shortVix } from "./indexEmailFormat.ts";
import { blockRow, blueHeading, esc, grid2, pill } from "./modernCards.ts";
import { entryNoteHtml, entryNoteSuffix } from "./entryState.ts";
import { topPicksBlock, type TopPicksEmailInput } from "./topPicksEmail.ts";
import { weeklyTop5Block, type Top5EmailInput } from "./weeklyTop5Email.ts";
import { LABEL_STYLE, cueCards, indexOutlookTable, outlookHero, slimCard, type IndexRef } from "./preOpenSections.ts";
import {
  HIGH_BREAKOUT_RULES,
  highBreakoutsVisible,
  type HighBreakoutSection,
} from "../screen/highBreakout.ts";

/**
 * Pre-open briefing email.
 *
 * Unlike the hourly email, every stock number here comes from a completed
 * session, so the message states that the levels and ideas are final rather
 * than warning that they may still change.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SEND_FROM_MINUTES = 9 * 60; // 09:00 IST, the pre-open auction
const SEND_UNTIL_MINUTES = 9 * 60 + 15; // 09:15 IST, the open
const HIGH_BREAKOUT_TOP = 5;

/**
 * One slot per trading day, `YYYY-MM-DD:preopen`, valid only inside the
 * pre-open window. Returns null on weekends, holidays and outside the window,
 * so a restart during the day can never trigger a late send.
 */
export function preOpenSlotKey(now = Date.now()): string | null {
  // A calendar check, not a phase check: MARKET_FORCE_LIVE pins the phase to
  // OPEN, which would otherwise silence this email permanently in development.
  if (!isTradingDay(now)) return null;
  const shifted = new Date(now + IST_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (minutes < SEND_FROM_MINUTES || minutes >= SEND_UNTIL_MINUTES) return null;
  return `${shifted.toISOString().slice(0, 10)}:preopen`;
}

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const whole = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;

const FONT = BRAND_FONT;
const MUTED = BRAND.muted;
const LINE = BRAND.line;
const AMBER = "#b45309";

export interface PreOpenEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildPreOpenEmail(
  brief: MorningBrief,
  table: AlertTable,
  regimeLine: string,
  generatedAt: number,
  highBreakouts: HighBreakoutSection | null = null,
  outlook: MarketOutlook | null = null,
  top5: Top5EmailInput | null = null,
  topPicks: TopPicksEmailInput | null = null,
  briefing: { lines: string[]; ai: boolean } | null = null,
): PreOpenEmail {
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(generatedAt);

  // Callers without GIFT Nifty or index inputs still get an outlook from the overnight tape and pivots.
  const o = outlook ?? buildMarketOutlook({ gift: null, bias: brief.bias, cues: [], levels: brief.levels, indexes: {} });
  // The latest price on every stock; before the open that is the last traded price, and the email says so.
  const ps = table.priceSource;
  const priceWord = ps && !ps.live ? "Last price" : "CMP";
  const priceNote = ps?.refreshed
    ? `Prices fetched ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(ps.at)} IST from ${ps.label}${ps.live ? " (live)" : " (market not open: last traded prices)"}.`
    : "";
  const rows = table.rows.slice(0, 10);
  const watchRows = (table.watch ?? []).slice(0, 5);
  // The shared footer repeats the risk and advice caveats this email states in its own words.
  const footerLines = table.footer.filter(
    (line) => !/no sure shots|investment advice/i.test(line) && !isPlanFooterLine(line),
  );
  const biasPercent = brief.bias.score != null ? ` (${signed(brief.bias.score)}%)` : "";
  const pickCount = rows.length
    ? `${rows.length} swing Buy ready`
    : `no Buy ready stocks${watchRows.length ? ` · ${watchRows.length} on watch` : ""}`;
  const giftBit = o.gift ? ` · GIFT ${signed(o.gift.gapPercent)}%` : "";
  const subject = `Traders Adda pre-open · ${o.label} outlook${giftBit} · ${brief.bias.label}${biasPercent} · ${pickCount}${
    highBreakouts && highBreakoutsVisible(table.breadth) && highBreakouts.breakouts.length
      ? ` · ${highBreakouts.breakouts.length} 52W breakout${highBreakouts.breakouts.length === 1 ? "" : "s"}`
      : ""
  } · ${brief.sessionLabel}`;

  const indexContext = brief.indexContext;
  const indexSection = indexContext ? buildIndexEmailSection({ context: indexContext }, generatedAt) : null;

  // Reference levels per index: pivots where the session range is known, else the completed-session analysis.
  const levelByKey = new Map(brief.levels.map((l) => [l.key, l]));
  const refFor = (key: string, levelKey: string): IndexRef | undefined => {
    const l = levelByKey.get(levelKey);
    if (l) return { support: l.support1, resistance: l.resistance1, pivot: l.pivot, note: "S1 / pivot / R1 from the last session's range" };
    const a = indexContext?.analysis?.[key];
    return a ? { support: a.nearbySupport?.price ?? null, resistance: a.nearbyResistance?.price ?? null, note: "Nearest completed-session references" } : undefined;
  };
  const refs: Record<string, IndexRef | undefined> = {
    NIFTY50: refFor("NIFTY50", "nifty"), BANKNIFTY: refFor("BANKNIFTY", "banknifty"),
    NIFTYIT: refFor("NIFTYIT", "-"), NIFTYMIDCAP: refFor("NIFTYMIDCAP", "-"),
  };

  const top5Block = top5 && !topPicks ? weeklyTop5Block(top5) : null;
  const picksBlock = topPicks ? topPicksBlock(topPicks) : null;
  /** One plan per stock: a stock already in Top picks is not given a second, different buy and stop further down. */
  const topSet = new Set((topPicks?.picks ?? []).filter((p) => p.tag === "ready" || p.tag === "broke").map((p) => p.symbol));
  const SEE_TOP = "Trade plan: see Top picks above";
  // Recipients get a short heads-up for the first two weeks, and the older scanner sections are labelled for what they are.
  const NEW_FORMAT_NOTICE_UNTIL = Date.parse("2026-11-02T00:00:00+05:30");
  const newFormatNotice = picksBlock && generatedAt < NEW_FORMAT_NOTICE_UNTIL
    ? "New in this email: the Top picks section follows a rule that was tested on ten years of prices (Blue sky and Multi-year breakouts, bought on the breakout day, only while the market check passes). The older scanner ideas further down are a separate rule set with a stricter 50% breadth gate."
    : "";
  const scannerNote = picksBlock ? "Scanner ideas below are an older, separate rule set with its own stricter 50% breadth gate. The tested setup is the Top picks section above." : "";
  const heading = (title: string, right = "") => blueHeading(title, right);
  const block = blockRow;

  const gate = highBreakoutsVisible(table.breadth);
  const statusPill = (row: AlertTableRow) =>
    row.status === "buy" ? pill(esc(row.statusLabel), "#dcfce7", "#15803d") : pill(esc(row.statusLabel), "#e0f2fe", "#0369a1");
  const rowCard = (row: AlertTableRow, n: number, entryLabel: string, entrySub: string) => {
    const wide = row.riskPercent > 6;
    return slimCard({
      num: n, symbol: row.symbol, status: statusPill(row), sub: `${screenerLine(row.source)}${row.rs != null ? ` · RS ${row.rs}` : ""}${entryNoteHtml(row.entryState)}`,
      price: px(row.close), priceLabel: priceWord.toUpperCase(), change: row.changePercent,
      cells: topSet.has(row.symbol)
        ? [["Trade plan", "See Top picks", "same stock · the tested plan", "#475569"]]
        : [
          [entryLabel, px(row.entry), entrySub, "#1d4ed8"],
          ["Stop loss", px(row.stop), `−${row.riskPercent.toFixed(1)}%${wide ? " ⚠" : ""}`, wide ? AMBER : "#b42318"],
          ["Target", px(row.target1), `T2 ${px(row.target2)}`, "#12814c"],
        ],
    });
  };
  const ideaCards = rows.length
    ? grid2(rows.map((row, i) => rowCard(row, i + 1, "Buy above", `skip &gt; ${px(row.buyZoneHigh)}`)))
    : noteLine(
        `🛡️ <b>No stock is Buy ready on yesterday's close.</b> Treat today as a watchlist day, not an entry day.`,
        "#fffbeb",
        "#fde68a",
        "#713f12",
      );
  const watchCards = watchRows.length
    ? `${doNotBuyLine(table)}${spacer(10)}${grid2(watchRows.map((row, i) => rowCard(row, i + 1, "Trigger", `close ${px(row.close)}`)))}`
    : "";

  const hb = highBreakouts;
  const hbVisible = hb != null && gate;
  const hbPicks = hbVisible ? hb.breakouts.slice(0, HIGH_BREAKOUT_TOP) : [];
  const hbBreadth = table.breadth != null ? `${table.breadth.toFixed(0)}%` : "unavailable";
  const hbNote = hb
    ? `Jaynesh Kasliwal's "near 52-week high" screen: ${hb.screened} liquid stocks pass it. A breakout here means a close above the 20-day high on at least ${HIGH_BREAKOUT_RULES.minVolumeRatio}× average volume, with a 65-day return above Nifty's${hb.niftyReturn65Percent != null ? ` (${signed(hb.niftyReturn65Percent, 1)}%)` : ""}.`
    : "";
  const hbHiddenLine = hb && !hbVisible
    ? `Hidden today: market breadth is ${hbBreadth}, below ${HEALTHY_BREADTH_PERCENT}%. ${hb.breakouts.length} stock${hb.breakouts.length === 1 ? "" : "s"} broke out, but these breakouts lost money in weak markets in our backtest, so none are listed.`
    : "";
  const HB_CAVEAT = `Experimental and separate from Buy ready. In our 2-year backtest only tight bases (≤ ${HIGH_BREAKOUT_RULES.tightBasePercent}%) with the 21-EMA exit made money (+0.09R a trade), and only in 2026.`;
  const HB_PLAN = `Swing plan: buy near the open, stop ${HIGH_BREAKOUT_RULES.stopPercent}% below your fill, exit at the next open after a daily close below the 21 EMA; 60-session time limit.`;
  const hbCards = grid2(hbPicks.map((p, i) => slimCard({
    num: i + 1, symbol: p.symbol,
    status: pill(`${p.tightBase ? "Tight base" : "Wide base"} ${p.baseRangePercent.toFixed(0)}%`, p.tightBase ? "#dcfce7" : "#fef3c7", p.tightBase ? "#15803d" : "#b45309"),
    sub: `${p.rs != null ? `RS ${p.rs} · ` : ""}${signed(p.fromHighPercent, 1)}% from 52W high`, price: px(p.close), priceLabel: "CLOSE", change: null,
    cells: [
      ["Broke", px(p.baseHigh), null, "#1d4ed8"],
      ["Volume", `${p.volumeRatio.toFixed(1)}×`, "avg volume", "#0f172a"],
      ["Exit below", px(p.ema21), "21 EMA close", "#12814c"],
    ],
  })));
  const hbSection = !hb
    ? ""
    : !hbVisible
      ? noteLine(esc(hbHiddenLine))
      : hbPicks.length
        ? `${noteLine(`${esc(HB_CAVEAT)} ${esc(HB_PLAN)}`, "#fffbeb", "#fde68a", "#7a4d00")}${spacer(10)}${hbCards}`
        : noteLine("No stock broke out with volume on the last session.");

  const unavailableLine = brief.unavailable.length
    ? `<div style="padding-top:5px;color:${AMBER}">Unavailable this morning: ${esc(brief.unavailable.join(", "))}.</div>`
    : "";

  const style = LABEL_STYLE[o.label];
  const gapText = o.gift ? `${signed(o.gift.gapPercent)}%` : "—";
  const kpi = (value: string, label: string, color: string) => `<td class="kpi" width="33%" style="padding:0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0e1a2e;border:1px solid #223350;border-radius:16px"><tr><td style="padding:10px 12px 9px 12px">
    <div class="kpiv" style="font:800 26px/1 ${FONT};color:${color};letter-spacing:-1px">${value}</div>
    <div class="kpil" style="font:600 10px ${FONT};letter-spacing:1px;text-transform:uppercase;color:#8ea0bd;padding-top:5px">${label}</div></td></tr></table></td>`;
  const headerHtml = `<tr><td style="background:${BRAND.green};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="pad" bgcolor="${BRAND.canvas}" style="background:${BRAND.canvas};background-image:linear-gradient(135deg,#020814 0%,#0a2233 55%,#0c3a2c 100%);padding:18px 22px 16px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;padding-right:12px"><div style="font:800 11px ${FONT};letter-spacing:2px;color:${BRAND.green}">● PRE-OPEN BRIEF</div>
        <div class="hero" style="font:800 24px/1.2 ${FONT};color:#ffffff;letter-spacing:-0.6px;padding-top:6px">${esc(o.label)} outlook for today</div>
        <div style="font:400 13px/1.5 ${FONT};color:#94a3b8;padding-top:5px">${esc(time)} IST · based on ${esc(brief.sessionLabel)}</div></td>
      <td width="96" align="right" style="vertical-align:middle"><img class="logo" src="cid:${LOGO_CID}" width="96" alt="Traders Adda" style="display:block;width:96px;height:auto;border:0"></td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr><td style="background:${style.solid}22;border:1px solid ${style.solid}66;border-radius:12px;padding:8px 12px">
      <div style="font:800 12px ${FONT};letter-spacing:1.2px;color:${style.bg}">${style.icon} OUTLOOK: ${o.label.toUpperCase()} · ${o.conviction.toUpperCase()} CONVICTION</div>
      <div style="font:500 13px ${FONT};color:#cbd5e1;padding-top:3px">${esc(brief.bias.label)}${biasPercent} · breadth ${table.breadth ?? "—"}%</div></td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px -4px 0 -4px;width:calc(100% + 8px)"><tr>
      ${kpi(gapText, "GIFT Nifty gap", o.gift ? (o.gift.gapPercent > 0.15 ? "#4ade80" : o.gift.gapPercent < -0.15 ? "#f87171" : "#ffffff") : "#94a3b8")}
      ${kpi(`${table.breadth ?? "—"}%`, "Market breadth", table.healthy ? BRAND.green : "#fbbf24")}
      ${kpi(String(rows.length || watchRows.length), rows.length ? "Buy ready" : "Watching", rows.length ? BRAND.green : "#93c5fd")}
    </tr></table>
  </td></tr>`;

  const leadership = indexContext
    ? `<div style="font:500 12px/1.5 ${FONT};color:#334155;padding-top:2px">${esc(shortLeadership(indexContext.leadership))} · ${esc(shortVix(indexContext.volatility))}</div>`
    : "";
  const preheader = `${o.label} outlook${giftBit} · ${brief.bias.label}${biasPercent} · ${pickCount} · ${regimeLine}`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(table.brand)} pre-open brief</title>
${BRAND_STYLE}
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page}">
<tr><td align="center" class="outer" style="padding:24px 10px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" class="container" style="width:100%;max-width:620px;background:#ffffff;border-radius:20px;overflow:hidden;border-collapse:separate">

  ${headerHtml}

  <tr><td class="pad" style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:6px 22px;font:400 11px/1.5 ${FONT};color:#14532d">
    <b>✓ Levels and ideas are final</b> — from the ${esc(brief.sessionLabel)} close.${regimeLine ? ` <span style="color:#3f6212">${esc(regimeLine)}</span>` : ""}${priceNote ? ` <span style="color:#3f6212">${esc(priceNote)}</span>` : ""}
  </td></tr>

${briefing && briefing.lines.length ? `
  ${heading("Today at a glance", briefing.ai ? "written by AI from the facts below" : "")}
  ${block(noteLine(briefing.lines.map((l) => `• ${esc(l)}`).join("<br>"), "#f8fafc", "#e2e8f0", "#0f172a"))}` : ""}

  ${heading("Market outlook", "GIFT Nifty vs global cues")}
  ${block(outlookHero(o))}

  ${heading("Index outlook", "Score, support, pivot and resistance · pivots, not OI walls")}
  ${block(`${indexOutlookTable(o.indexes, refs)}${leadership}`)}

  ${brief.cues.length ? `${heading("Global cues", "Green helps India, red hurts")}
  ${block(cueCards(brief.cues))}` : ""}

${picksBlock && topPicks ? `
  ${heading("Top picks", `${topPicks.picks.filter((p) => p.tag === "ready" || p.tag === "broke").length} to watch or buy`)}
  ${block(`${newFormatNotice ? `${noteLine(esc(newFormatNotice), "#eff6ff", "#bfdbfe", "#1e3a8a")}${spacer(8)}` : ""}${picksBlock.html}`)}` : ""}

${top5Block && top5 ? `
  ${heading("Weekly Top 5", `${top5.picks.length} of ${top5.qualifying} qualify · ${SWING_LABEL}`)}
  ${block(top5Block.html)}` : ""}

${scannerNote ? `  ${block(noteLine(esc(scannerNote), "#f8fafc", "#e2e8f0", "#475569"))}
` : ""}  ${heading("Swing trades — Buy ready", rows.length ? `${rows.length} ${rows.length === 1 ? "stock" : "stocks"} · ${SWING_LABEL}` : SWING_LABEL)}
  ${block(ideaCards)}
  <tr><td class="pad" style="padding:6px 22px 0 22px;font:400 11px/1.5 ${FONT};color:${MUTED}">${esc(SWING_HOLDING)}</td></tr>
${rows.length ? `
  <tr><td class="pad" style="padding:12px 22px 0 22px">${rulesCard("How to trade these swing setups", SWING_RULES)}</td></tr>` : ""}
${watchCards ? `
  ${heading("Strong stocks on watch", `${watchRows.length} ${watchRows.length === 1 ? "stock" : "stocks"} · do not buy yet`)}
  ${block(watchCards)}` : ""}
${hbSection ? `
  ${heading("52-week-high breakouts", hbPicks.length ? `${hbPicks.length} ${hbPicks.length === 1 ? "stock" : "stocks"} · experimental` : "experimental")}
  ${block(hbSection)}` : ""}

  <tr><td class="pad" style="padding:18px 22px 20px 22px">
    <div style="border-top:1px solid ${LINE};padding-top:10px;font:400 11px/1.6 ${FONT};color:${MUTED}">
      The outlook adds point scores from GIFT Nifty, the overnight tape, completed-session trend and breadth; it describes conditions and is not a forecast. GIFT Nifty comes from an unofficial feed (${o.gift ? esc(o.gift.quote.source) : "unavailable today"}). Key levels are classic floor pivots from the last session's range, not option-chain OI. ${hbNote ? esc(hbNote) : ""}
      ${unavailableLine}
    </div>
  </td></tr>

  ${brandFooter([...footerLines.filter((line) => !/no sure shots/i.test(line)), "Automated, rule-based research output — not investment advice. Markets carry risk; please do your own diligence."], `${table.brand} · Sent before the 09:15 IST open`)}

</table>
</td></tr></table>
</body></html>`;

  const outlookText = [
    `MARKET OUTLOOK: ${o.label.toUpperCase()} (score ${signed(o.score, 0)} of ±${o.maxScore} · ${o.conviction.toLowerCase()} conviction)`,
    o.summary,
    ...o.drivers.map((d) => `  ${d.points > 0 ? "▲" : d.points < 0 ? "▼" : "•"} ${d.label} · ${d.detail} (${signed(d.points, 0)})`),
    "",
    "GIFT NIFTY VS GLOBAL CUES",
    ...(o.gift
      ? [
          `Nifty close ${whole(o.gift.niftyClose)} · GIFT Nifty ${whole(o.gift.quote.price)} (${signed(o.gift.gapPoints, 0)} pts, ${signed(o.gift.gapPercent)}%) · global tone ${o.gift.tonePercent == null ? "n/a" : `${signed(o.gift.tonePercent)}%`}`,
          o.gift.text,
          ...(o.gift.levelNote ? [o.gift.levelNote] : []),
          `Source: ${o.gift.quote.source}; unofficial feed, verify before trading.`,
        ]
      : ["GIFT Nifty is unavailable this morning; the outlook uses the global tape, trend and breadth only."]),
    "",
    "INDEX OUTLOOK",
    ...o.indexes.map((ix) => `${ix.name}: ${ix.label} (score ${signed(ix.score, 0)}, ${ix.conviction.toLowerCase()} conviction) — ${ix.summary}`),
    "",
  ];

  const text = [
    `${table.brand} · Pre-open brief · ${time} IST`,
    regimeLine,
    `Levels and ideas are final — from the completed session on ${brief.sessionLabel}.${priceNote ? ` ${priceNote}` : ""}`,
    "",
    ...(briefing && briefing.lines.length ? ["TODAY AT A GLANCE" + (briefing.ai ? " (written by AI from the facts in this email)" : ""), ...briefing.lines.map((l) => `- ${l}`), ""] : []),
    ...outlookText,
    "OPENING BIAS",
    `${brief.bias.label}${biasPercent}`,
    brief.bias.summary,
    "",
    "MACRO & GLOBAL CUES",
    ...brief.cues.map(
      (section) =>
        `${section.title}: ${section.lines.map((line) => `${line.label} ${line.value} (${signed(line.changePercent)}%)`).join(" · ")}`,
    ),
    "",
    "KEY LEVELS (previous-session pivots, not option OI)",
    ...brief.levels.map(
      (level) => `${level.label} ${level.zone} zone · pivot ${whole(level.pivot)} · S1 ${whole(level.support1)} · R1 ${whole(level.resistance1)}`,
    ),
    "",
    ...(indexContext ? [
      "INDEX OUTLOOK — COMPLETED DAILY / WEEKLY",
      ...(indexSection?.text ?? []),
      "",
    ] : []),
    ...(picksBlock ? ["TOP PICKS", ...(newFormatNotice ? [newFormatNotice] : []), ...picksBlock.text, ""] : []),
    ...(top5Block ? ["WEEKLY TOP 5", ...top5Block.text, ""] : []),
    ...(scannerNote ? [scannerNote] : []),
    "SWING TRADES — BUY READY",
    SWING_HOLDING,
    table.summary,
    ...(rows.length
      ? rows.flatMap((row) => [
          `${row.n}. ${row.symbol} · ${priceWord.toUpperCase()} ${inr(row.close)}${entryNoteSuffix(row.entryState)} · ${SWING_LABEL} · ${row.source} · ${row.statusLabel}`,
          `   ${topSet.has(row.symbol) ? SEE_TOP : `Buy > ${inr(row.entry)} (skip > ${inr(row.buyZoneHigh)}) · SL ${inr(row.stop)} (−${row.riskPercent.toFixed(1)}%)${row.riskPercent > 6 ? " ⚠ wide" : ""} · T1 ${inr(row.target1)} · T2 ${inr(row.target2)}`} · RS ${row.rs ?? "—"} · PA ${paText(row.pa)}`,
        ])
      : ["No stock is Buy ready on yesterday's close. Watchlist day, not an entry day."]),
    ...watchText(watchRows, table, null, topSet),
    ...(rows.length
      ? ["", "HOW TO TRADE THESE SWING SETUPS", ...SWING_RULES.map((rule, i) => `${i + 1}. ${rule}`)]
      : []),
    ...(hb
      ? [
          "",
          "52-WEEK-HIGH BREAKOUTS — EXPERIMENTAL",
          hbNote,
          ...(!hbVisible
            ? [hbHiddenLine]
            : hbPicks.length
              ? [
                  HB_CAVEAT,
                  HB_PLAN,
                  ...hbPicks.map(
                    (p, i) =>
                      `${i + 1}. ${p.symbol} · ${SWING_LABEL} · close ${inr(p.close)} broke ${inr(p.baseHigh)} · vol ${p.volumeRatio.toFixed(1)}× · ${p.tightBase ? "tight" : "wide"} base ${p.baseRangePercent.toFixed(0)}% · 21 EMA ${inr(p.ema21)} · RS ${p.rs ?? "—"}`,
                  ),
                ]
              : ["No stock broke out with volume on the last session."]),
        ]
      : []),
    "",
    ...footerLines,
    "The outlook adds point scores from GIFT Nifty, the overnight tape, trend and breadth; it describes conditions and is not a forecast.",
    ...(brief.unavailable.length ? [`Unavailable this morning: ${brief.unavailable.join(", ")}.`] : []),
    "No sure shots. Risk no more than 1% of capital per trade.",
    "Automated, rule-based research output — not investment advice. Markets carry risk; please do your own diligence.",
  ].join("\n");

  return { subject, html, text };
}
