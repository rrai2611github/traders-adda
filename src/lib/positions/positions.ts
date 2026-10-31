/**
 * "My positions": the real trades the user has taken, watched against the same exit rules the backtest used (a stop 12% below the buy,
 * and a close under the 50-day average), plus a journal of closed trades. The app never places orders; the user enters what they did.
 */
export type ExitReason = "stop" | "fifty-day" | "own-call";

export interface Holding {
  id: string;
  symbol: string;
  qty: number;
  buyPrice: number;
  /** IST day, "2026-10-30". */
  buyDate: string;
  stop: number;
  /** The price the plan said to buy at (from a pick), so the real fill can be measured against it. */
  plannedPrice?: number;
  note?: string;
  sold?: { date: string; price: number; reason: ExitReason };
}

export interface Candle {
  /** IST day, "2026-10-30". */
  date: string;
  low: number;
  close: number;
}

export type Status = "stop-hit" | "exit-signal" | "close-to-stop" | "hold" | "no-data";

export interface Assessment {
  status: Status;
  last: number | null;
  lastDate: string | null;
  sma50: number | null;
  /** Gain or loss so far in units of the money risked (buy minus stop). */
  rNow: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  daysHeld: number;
  headline: string;
  action: string;
}

export const DEFAULT_STOP_PERCENT = 12;
/** "Close to the stop" begins when the last close is this near it. */
export const NEAR_STOP_PERCENT = 3;
export const EXIT_LABEL: Record<ExitReason, string> = { stop: "Stop was hit", "fifty-day": "Closed under 50-day average", "own-call": "My own call" };

const DAY = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const validDay = (s: unknown): s is string => typeof s === "string" && isoDay.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const istToday = (now = Date.now()) => new Date(now + 19_800_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));

/** The rules' stop: a fixed percent under the buy price, rounded to the 5-paise tick. */
export function ruleStop(buyPrice: number, percent = DEFAULT_STOP_PERCENT): number {
  return Math.round(buyPrice * (1 - percent / 100) * 20) / 20;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Checks a new position typed in by the user. Every field is untrusted. */
export function parseNewHolding(input: Record<string, unknown>, now = Date.now()): Parsed<Omit<Holding, "id">> {
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return fail("Enter the NSE symbol, like KPITTECH.");
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000_000) return fail("Quantity must be a whole number of shares, at least 1.");
  const buyPrice = Number(input.buyPrice);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || buyPrice > 1_000_000) return fail("Enter the price you paid per share.");
  const buyDate = input.buyDate == null || input.buyDate === "" ? istToday(now) : input.buyDate;
  if (!validDay(buyDate) || buyDate < "2000-01-01") return fail("Enter the buy date as a real date.");
  if (buyDate > istToday(now)) return fail("The buy date cannot be in the future.");
  const stop = input.stop == null || input.stop === "" ? ruleStop(buyPrice) : Number(input.stop);
  if (!Number.isFinite(stop) || stop <= 0) return fail("Enter a stop price above zero.");
  if (stop >= buyPrice) return fail("The stop must be below the price you paid.");
  const planned = input.plannedPrice == null || input.plannedPrice === "" ? null : Number(input.plannedPrice);
  if (planned != null && (!Number.isFinite(planned) || planned <= 0 || planned > 1_000_000)) return fail("The planned price is not a valid price.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  return { ok: true, value: { symbol, qty, buyPrice, buyDate, stop, ...(planned != null ? { plannedPrice: planned } : {}), ...(note ? { note } : {}) } };
}

/** Checks a sale typed in by the user against the position it closes. */
export function parseSale(input: Record<string, unknown>, holding: Holding, now = Date.now()): Parsed<NonNullable<Holding["sold"]>> {
  if (holding.sold) return fail("This position is already closed.");
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return fail("Enter the price you sold at.");
  const date = input.date == null || input.date === "" ? istToday(now) : input.date;
  if (!validDay(date)) return fail("Enter the sell date as a real date.");
  if (date < holding.buyDate) return fail("The sell date cannot be before the buy date.");
  if (date > istToday(now)) return fail("The sell date cannot be in the future.");
  const reason = input.reason;
  if (reason !== "stop" && reason !== "fifty-day" && reason !== "own-call") return fail("Say why you sold.");
  return { ok: true, value: { date, price, reason } };
}

/** Is the position still inside the rules? Daily candles, oldest first; the last one is the latest finished session. */
export function assessHolding(holding: Holding, candles: ReadonlyArray<Candle>, now = Date.now()): Assessment {
  const today = istToday(now);
  const daysHeld = daysBetween(holding.buyDate, today);
  const empty = (headline: string): Assessment => ({ status: "no-data", last: null, lastDate: null, sma50: null, rNow: null, pnl: null, pnlPercent: null, daysHeld, headline, action: "Check the price on your broker app." });
  const latest = candles.at(-1);
  if (!latest) return empty("No price history for this stock, so the exit rules cannot be checked.");

  const risk = holding.buyPrice - holding.stop;
  const last = latest.close;
  const rNow = (last - holding.buyPrice) / risk;
  const pnl = (last - holding.buyPrice) * holding.qty;
  const pnlPercent = ((last - holding.buyPrice) / holding.buyPrice) * 100;
  const closes = candles.slice(-50).map((c) => c.close);
  const sma50 = closes.length === 50 ? closes.reduce((a, b) => a + b, 0) / 50 : null;
  const base = { last, lastDate: latest.date, sma50, rNow, pnl, pnlPercent, daysHeld };

  const hit = candles.find((c) => c.date > holding.buyDate && c.low <= holding.stop);
  if (hit) {
    return { ...base, status: "stop-hit", headline: `Traded down to ${rupees(hit.low)} on ${hit.date}, through your ${rupees(holding.stop)} stop.`, action: "The rules say you are out. Sell if you have not, then mark it sold here." };
  }
  if (sma50 != null && latest.date > holding.buyDate && last < sma50) {
    return { ...base, status: "exit-signal", headline: `Closed at ${rupees(last)}, under its 50-day average of ${rupees(sma50)}.`, action: "The rules say sell at the next open, then mark it sold here." };
  }
  const nearStop = ((last - holding.stop) / last) * 100;
  if (nearStop <= NEAR_STOP_PERCENT) {
    return { ...base, status: "close-to-stop", headline: `Closed at ${rupees(last)}, only ${nearStop.toFixed(1)}% above your ${rupees(holding.stop)} stop.`, action: "No action yet. Do not move the stop down to avoid a loss." };
  }
  const above = sma50 != null ? `, above its 50-day average of ${rupees(sma50)}` : "";
  return { ...base, status: "hold", headline: `Closed at ${rupees(last)}${above}. Stop ${rupees(holding.stop)}.`, action: "Hold. The rules sell only on the stop or a close under the 50-day average." };
}

export const NEEDS_ACTION: ReadonlySet<Status> = new Set<Status>(["stop-hit", "exit-signal"]);

export interface ClosedTrade {
  holding: Holding;
  /** Money risked per share was buy minus stop. */
  r: number;
  pnl: number;
}

export function closedTrades(holdings: ReadonlyArray<Holding>): ClosedTrade[] {
  return holdings
    .filter((h): h is Holding & { sold: NonNullable<Holding["sold"]> } => h.sold != null)
    .map((h) => ({ holding: h, r: (h.sold.price - h.buyPrice) / (h.buyPrice - h.stop), pnl: (h.sold.price - h.buyPrice) * h.qty }))
    .sort((a, b) => b.holding.sold!.date.localeCompare(a.holding.sold!.date));
}

export interface Journal {
  count: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  totalPnl: number;
  byReason: Array<{ reason: ExitReason; label: string; n: number; avgR: number }>;
  /** Plain-language reading of the numbers. */
  lines: string[];
}

const MIN_JUDGE = 10;
const MIN_GROUP = 3;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}R`;

/** How the user's real trades went, and whether selling off the rules helped or hurt. */
export function summariseJournal(trades: ReadonlyArray<ClosedTrade>): Journal {
  const count = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const byReason = (["stop", "fifty-day", "own-call"] as const)
    .map((reason) => {
      const rs = trades.filter((t) => t.holding.sold!.reason === reason).map((t) => t.r);
      return { reason, label: EXIT_LABEL[reason], n: rs.length, avgR: rs.length ? avg(rs) : 0 };
    })
    .filter((g) => g.n > 0);
  const lines: string[] = [];
  if (count === 0) {
    return { count, wins, winRate: null, avgR: null, totalPnl: 0, byReason, lines: ["No closed trades yet. Mark a position as sold and it will appear here."] };
  }
  const winRate = (wins / count) * 100;
  const avgR = avg(trades.map((t) => t.r));
  if (count < MIN_JUDGE) {
    lines.push(`Only ${count} closed trade${count === 1 ? "" : "s"}. Under ${MIN_JUDGE}, luck looks like skill, so nothing here proves anything yet. Keep logging.`);
  } else {
    lines.push(`${wins} of ${count} trades made money (${winRate.toFixed(0)}%). The backtest won about 40%, so a win rate near that is normal: the profit comes from a few big winners, not from most trades.`);
    lines.push(avgR >= 0 ? `The average trade made ${signed(avgR)}.` : `The average trade lost ${signed(avgR).replace("−", "")}. A few more trades will show whether that is a rough patch or a pattern.`);
  }
  const own = trades.filter((t) => t.holding.sold!.reason === "own-call").map((t) => t.r);
  const rule = trades.filter((t) => t.holding.sold!.reason !== "own-call").map((t) => t.r);
  if (own.length >= MIN_GROUP && rule.length >= MIN_GROUP) {
    const ownAvg = avg(own);
    const ruleAvg = avg(rule);
    if (ownAvg < ruleAvg - 0.3) lines.push(`When you sold on your own call you averaged ${signed(ownAvg)} (${own.length} trades); when you sold by the rules, ${signed(ruleAvg)} (${rule.length}). Selling early is costing you: the plan only works if the winners are held.`);
    else if (ownAvg > ruleAvg + 0.3) lines.push(`Your own-call exits averaged ${signed(ownAvg)} against ${signed(ruleAvg)} for rule exits. That is a small sample, so do not rely on it yet.`);
  }
  return { count, wins, winRate, avgR, totalPnl: trades.reduce((a, t) => a + t.pnl, 0), byReason, lines };
}

/** The lines of the owner's end-of-day email: only positions that need a decision. Empty when nothing does. */
export function actionLines(items: ReadonlyArray<{ holding: Holding; assessment: Assessment }>): string[] {
  const due = items.filter((i) => NEEDS_ACTION.has(i.assessment.status));
  if (due.length === 0) return [];
  return [
    `${due.length} of your ${items.length} open position${items.length === 1 ? "" : "s"} ${due.length === 1 ? "needs" : "need"} a decision under the rules.`,
    ...due.map((i) => `${i.holding.symbol} (${i.holding.qty} shares bought at ${rupees(i.holding.buyPrice)}): ${i.assessment.headline} ${i.assessment.action}`),
    "The app never sells for you. Open My positions to mark a sale once you have placed it.",
  ];
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Free text starting with = + - @ or a tab would run as a formula when the file is opened in a spreadsheet; a leading apostrophe stops that. */
const csvText = (value: string): string => csvCell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/** Every position, open and closed, as a spreadsheet file: the user's own copy of their records. */
export function holdingsCsv(holdings: ReadonlyArray<Holding>): string {
  const header = ["Symbol", "Shares", "Buy date", "Buy price", "Stop", "Status", "Sell date", "Sell price", "Why sold", "Profit or loss (Rs)", "Result in R", "Planned price", "Paid vs plan (%)", "Note"];
  const rows = [...holdings]
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate))
    .map((h) => {
      const sold = h.sold;
      const r = sold ? (sold.price - h.buyPrice) / (h.buyPrice - h.stop) : null;
      const pnl = sold ? (sold.price - h.buyPrice) * h.qty : null;
      return [
        csvText(h.symbol), h.qty, h.buyDate, h.buyPrice, h.stop, sold ? "Closed" : "Open",
        sold?.date ?? "", sold?.price ?? "", sold ? csvText(EXIT_LABEL[sold.reason]) : "",
        pnl == null ? "" : Math.round(pnl * 100) / 100, r == null ? "" : Math.round(r * 100) / 100,
        h.plannedPrice ?? "", fillSlippagePercent(h) == null ? "" : Math.round(fillSlippagePercent(h)! * 100) / 100, csvText(h.note ?? ""),
      ].map(String); // text cells above are already escaped once by csvText; numbers and dates need no escaping
    });
  return [header.map(csvCell).join(","), ...rows.map((row) => row.join(","))].join("\r\n") + "\r\n";
}

/** Names of daily backup files to delete so only the newest `keep` remain. Names sort by their date. */
export function backupsToDelete(names: ReadonlyArray<string>, keep = 30): string[] {
  const dated = names.filter((n) => /^positions-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  return dated.slice(0, Math.max(0, dated.length - keep));
}

/** Most open positions in one sector. In the 10-year test a cap of 3 never hurt either half and trimmed the worst drop a little (a cap of 1 hurt). */
export const SECTOR_LIMIT = 3;

export interface SectorCrowd {
  sector: string;
  count: number;
  symbols: string[];
}

/** Sectors holding more open positions than the limit, biggest first. Positions with no known sector are never counted. */
export function sectorConcentration(items: ReadonlyArray<{ symbol: string; sector: string | null }>, limit = SECTOR_LIMIT): SectorCrowd[] {
  const bySector = new Map<string, string[]>();
  for (const { symbol, sector } of items) if (sector) bySector.set(sector, [...(bySector.get(sector) ?? []), symbol]);
  return [...bySector]
    .filter(([, symbols]) => symbols.length > limit)
    .map(([sector, symbols]) => ({ sector, count: symbols.length, symbols }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

/** How far above (positive) or below the planned price the real buy was, in percent; null when there was no plan. */
export function fillSlippagePercent(h: Pick<Holding, "buyPrice" | "plannedPrice">): number | null {
  return h.plannedPrice && h.plannedPrice > 0 ? ((h.buyPrice - h.plannedPrice) / h.plannedPrice) * 100 : null;
}

export interface FillSummary {
  /** Positions that had a planned price. */
  count: number;
  /** Average of how far above the plan the buys were, in percent (positive = paid more than planned). */
  avgPercent: number | null;
}

/** The user's own execution: how close the real fills were to the plan. The reality check on the Backtest page assumed 1% worse. */
export function fillSummary(holdings: ReadonlyArray<Holding>): FillSummary {
  const slips = holdings.map(fillSlippagePercent).filter((v): v is number => v != null);
  return { count: slips.length, avgPercent: slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : null };
}

export interface ShareSuggestion {
  qty: number;
  invested: number;
  /** Money lost if the stop is hit. */
  atRisk: number;
  limitedBy: "risk" | "size" | null;
}

/**
 * How many shares the rules would buy: the money at risk is `riskPercent` of the account (2% in the tested rules), and one position
 * never takes more than `capPercent` of it (20%). With a 12% stop that makes a position of about a sixth of the account.
 */
export function suggestedShares(input: { capital: number; buy: number; stop: number; riskPercent?: number; capPercent?: number }): ShareSuggestion {
  const { capital, buy, stop, riskPercent = 2, capPercent = 20 } = input;
  const none: ShareSuggestion = { qty: 0, invested: 0, atRisk: 0, limitedBy: null };
  if (!(capital > 0) || !(buy > 0) || !(stop > 0) || stop >= buy) return none;
  const byRisk = Math.floor((capital * riskPercent) / 100 / (buy - stop));
  const bySize = Math.floor((capital * capPercent) / 100 / buy);
  const qty = Math.max(0, Math.min(byRisk, bySize));
  return { qty, invested: Math.round(qty * buy), atRisk: Math.round(qty * (buy - stop)), limitedBy: qty === 0 ? null : byRisk <= bySize ? "risk" : "size" };
}
