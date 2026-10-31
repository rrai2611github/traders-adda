import { isTradingDay } from "../market/marketHours.ts";
import { esc, grid2, pill } from "./modernCards.ts";
import { noteLine, px, spacer } from "./compactEmail.ts";
import { slimCard } from "./preOpenSections.ts";

/** The part of the Weekly Top 5 payload the email needs (the full payload satisfies it). */
export interface Top5EmailInput {
  breadth50: number | null;
  size: { key: "full" | "quarter" | "paper"; label: string; detail: string };
  qualifying: number;
  picks: Array<{
    symbol: string;
    rs: number;
    sector: string | null;
    scanners: number | null;
    close: number;
    stop: number;
    target: number;
    riskPercent: number;
  }>;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** True on the first NSE trading day of the IST week: Monday, or Tuesday when Monday is a holiday, and so on. */
export function isFirstTradingDayOfWeek(now: number): boolean {
  if (!isTradingDay(now)) return false;
  const weekday = new Date(now + IST_OFFSET_MS).getUTCDay(); // 0 Sun .. 6 Sat
  for (let back = 1; back < weekday; back += 1) {
    if (isTradingDay(now - back * DAY_MS)) return false;
  }
  return true;
}

const SIZE_PILL = {
  full: ["#dcfce7", "#15803d"],
  quarter: ["#fef3c7", "#b45309"],
  paper: ["#fee2e2", "#b91c1c"],
} as const;

const SIZE_NOTE = {
  full: ["#f0fdf4", "#bbf7d0", "#14532d"],
  quarter: ["#fffbeb", "#fde68a", "#713f12"],
  paper: ["#fef2f2", "#fecaca", "#7f1d1d"],
} as const;

const CAVEAT = "Ranked by relative strength from every liquid NSE stock that is in a stacked uptrend near its 52-week high. Buy near the last close and skip it if the stock opens more than 5% above. Stop is 2 × the average daily range below; hold while it closes above its 50-day average (the 3R level is only a point to book part profit). 10-year backtest: about +0.5R a trade with that exit, against +0.12R for a fixed 3R target. Research output, not advice.";

/** The email section: a size note first (the pick is only as good as the market), then one card per stock. */
export function weeklyTop5Block(top5: Top5EmailInput): { html: string; text: string[] } {
  const [bg, border, color] = SIZE_NOTE[top5.size.key];
  const [pillBg, pillFg] = SIZE_PILL[top5.size.key];
  const breadth = top5.breadth50 != null ? ` Breadth is ${Math.round(top5.breadth50)}%.` : "";
  const note = noteLine(`<b>${esc(top5.size.label)}.</b> ${esc(top5.size.detail)}${esc(breadth)}`, bg, border, color);
  const cards = top5.picks.length
    ? grid2(top5.picks.map((p, i) => slimCard({
      num: i + 1,
      symbol: p.symbol,
      status: pill(esc(top5.size.label), pillBg, pillFg),
      sub: `RS ${Math.round(p.rs)}${p.sector ? ` · ${esc(p.sector)}` : ""}${p.scanners != null ? ` · ${p.scanners} scanner${p.scanners === 1 ? "" : "s"}` : ""}`,
      priceLabel: "LAST CLOSE",
      price: px(p.close),
      change: null,
      cells: [
        ["Buy near", px(p.close), "skip if opens &gt; +5%", "#1d4ed8"],
        ["Stop loss", px(p.stop), `−${p.riskPercent.toFixed(1)}%${p.riskPercent > 6 ? " ⚠" : ""}`, p.riskPercent > 6 ? "#b45309" : "#b42318"],
        ["Part profit (3R)", px(p.target), null, "#12814c"],
      ],
    })))
    : noteLine("No stock passes every rule right now. Not picking is a valid answer.");
  const html = `${note}${spacer(10)}${cards}${spacer(2)}<div style="font:400 11px/1.5 sans-serif;color:#64748b">${esc(CAVEAT)}</div>`;
  const text = [
    `${top5.size.label.toUpperCase()}. ${top5.size.detail}${breadth}`,
    ...(top5.picks.length
      ? top5.picks.map((p, i) => `${i + 1}. ${p.symbol} · RS ${Math.round(p.rs)}${p.sector ? ` · ${p.sector}` : ""}${p.scanners != null ? ` · ${p.scanners} scanner${p.scanners === 1 ? "" : "s"}` : ""} · last close ${px(p.close)} · stop ${px(p.stop)} (−${p.riskPercent.toFixed(1)}%) · target ${px(p.target)}`)
      : ["No stock passes every rule right now."]),
    CAVEAT,
  ];
  return { html, text };
}
