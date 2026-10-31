/**
 * Company health in plain words: are sales and profit growing, is debt manageable, are the owners holding on?
 * Information only. None of this is in the 10-year backtest (there is no point-in-time history for it), so it never changes a pick,
 * the setup check or the risk check. It exists so a person can spot a chart that looks good on a company that does not.
 */
export interface Quarter {
  /** Quarter end, "2026-09-30". */
  date: string;
  /** Rupees. */
  sales: number | null;
  profit: number | null;
}

export interface Holding {
  /** Quarter end, "2026-09-30". */
  date: string;
  /** Promoter and promoter-group share of the company, percent. */
  promoter: number;
}

export interface FundamentalsInput {
  /** Oldest first. */
  quarters: Quarter[];
  /** Latest financial year, rupees. */
  debt: number | null;
  equity: number | null;
  /** Newest first. */
  holdings: Holding[];
  /** Percent of the promoters' own shares that are pledged to lenders. */
  pledgedPercent: number | null;
  /** Banks and lenders borrow by design, so a debt ratio says nothing about them. */
  lender: boolean;
  now: number;
}

export type Tone = "good" | "ok" | "warn" | "unknown";
export type Verdict = "strong" | "fine" | "mixed" | "weak" | "unknown";

export interface FundamentalCheck {
  key: "sales" | "profit" | "debt" | "promoter" | "pledge";
  label: string;
  tone: Tone;
  detail: string;
}

export interface FundamentalsReport {
  verdict: Verdict;
  headline: string;
  checks: FundamentalCheck[];
  /** Quarter end of the figures used, "2026-09-30", or null when none were found. */
  quarterEnd: string | null;
}

const DAY = 86_400_000;
const STALE_DAYS = 200;

const crores = (rupees: number) => Math.round(rupees / 1e7).toLocaleString("en-IN");
/** A size without its sign: the sentence already says "up" or "down". */
const pct = (v: number) => `${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`;
const growth = (now: number, before: number) => ((now - before) / Math.abs(before)) * 100;

type Series = { asOfDate?: string; reportedValue?: { raw?: number } };
type YahooPayload = { timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> } };

/** Yahoo's fundamentals-timeseries answer: the quarters (oldest first) and the latest year's debt and net worth. */
export function parseYahooFundamentals(json: unknown): { quarters: Quarter[]; debt: number | null; equity: number | null } {
  const results = (json as YahooPayload)?.timeseries?.result ?? [];
  const series = (type: string): Array<{ date: string; value: number }> => {
    const entry = results.find((r) => r.meta?.type?.[0] === type);
    const rows = entry?.[type];
    if (!Array.isArray(rows)) return [];
    return (rows as Series[])
      .filter((r) => r?.asOfDate && typeof r.reportedValue?.raw === "number" && Number.isFinite(r.reportedValue.raw))
      .map((r) => ({ date: r.asOfDate as string, value: r.reportedValue!.raw as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };
  const sales = series("quarterlyTotalRevenue");
  const profit = series("quarterlyNetIncome");
  const dates = [...new Set([...sales, ...profit].map((r) => r.date))].sort();
  const quarters = dates.map((date) => ({ date, sales: sales.find((r) => r.date === date)?.value ?? null, profit: profit.find((r) => r.date === date)?.value ?? null }));
  const latest = (type: string) => series(type).at(-1)?.value ?? null;
  return { quarters, debt: latest("annualTotalDebt"), equity: latest("annualStockholdersEquity") };
}

const day = (nse: string): string | null => {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(nse);
  if (!m) return null;
  const t = Date.parse(`${m[1]} ${m[2]} ${m[3]} 12:00:00 UTC`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** NSE's shareholding filings, newest first. Rows without a usable date or percentage are dropped. */
export function parseShareholding(rows: unknown): Holding[] {
  if (!Array.isArray(rows)) return [];
  const out: Holding[] = [];
  for (const row of rows as Array<{ date?: string; pr_and_prgrp?: string }>) {
    const date = day(row?.date ?? "");
    const promoter = Number.parseFloat(row?.pr_and_prgrp ?? "");
    if (date && Number.isFinite(promoter)) out.push({ date, promoter });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** NSE's pledge disclosure: the percent of the promoters' shares that are pledged. */
export function parsePledge(json: unknown): number | null {
  const rows = (json as { data?: Array<{ percSharesPledged?: string; shp?: string }> })?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const v = Number.parseFloat(rows[0]?.percSharesPledged ?? "");
  return Number.isFinite(v) ? v : null;
}

function salesAndProfit(input: FundamentalsInput): { sales: FundamentalCheck; profit: FundamentalCheck; quarterEnd: string | null } {
  const latest = input.quarters.at(-1);
  const unknown = (key: "sales" | "profit", label: string, detail: string): FundamentalCheck => ({ key, label, tone: "unknown", detail });
  if (!latest) {
    return { sales: unknown("sales", "Sales", "No quarterly figures found."), profit: unknown("profit", "Profit", "No quarterly figures found."), quarterEnd: null };
  }
  const old = input.now - Date.parse(`${latest.date}T12:00:00Z`) > STALE_DAYS * DAY;
  if (old) {
    const detail = `The latest quarter on file ends ${month(latest.date)}, too old to judge.`;
    return { sales: unknown("sales", "Sales", detail), profit: unknown("profit", "Profit", detail), quarterEnd: latest.date };
  }
  const target = Date.parse(`${latest.date}T12:00:00Z`) - 365 * DAY;
  const year = input.quarters.find((q) => Math.abs(Date.parse(`${q.date}T12:00:00Z`) - target) <= 35 * DAY);
  const when = month(latest.date);

  let sales: FundamentalCheck;
  if (latest.sales == null || year?.sales == null || year.sales <= 0) {
    sales = unknown("sales", "Sales", latest.sales == null ? "Sales are missing for the latest quarter." : `Sales were ₹${crores(latest.sales)} Cr in the quarter to ${when}; no year-ago quarter to compare.`);
  } else {
    const g = growth(latest.sales, year.sales);
    sales = {
      key: "sales", label: "Sales", tone: g >= 15 ? "good" : g >= 0 ? "ok" : "warn",
      detail: `₹${crores(latest.sales)} Cr in the quarter to ${when}, ${g >= 0 ? "up" : "down"} ${pct(g)} on a year earlier.`,
    };
  }

  let profit: FundamentalCheck;
  if (latest.profit == null) {
    profit = unknown("profit", "Profit", "Profit is missing for the latest quarter.");
  } else if (latest.profit < 0) {
    profit = { key: "profit", label: "Profit", tone: "warn", detail: `Lost ₹${crores(-latest.profit)} Cr in the quarter to ${when}.` };
  } else if (year?.profit == null) {
    profit = unknown("profit", "Profit", `Made ₹${crores(latest.profit)} Cr in the quarter to ${when}; no year-ago quarter to compare.`);
  } else if (year.profit <= 0) {
    profit = { key: "profit", label: "Profit", tone: "good", detail: `Made ₹${crores(latest.profit)} Cr in the quarter to ${when}, against a loss a year earlier.` };
  } else {
    const g = growth(latest.profit, year.profit);
    profit = {
      key: "profit", label: "Profit", tone: g >= 20 ? "good" : g >= -10 ? "ok" : "warn",
      detail: `₹${crores(latest.profit)} Cr in the quarter to ${when}, ${g >= 0 ? "up" : "down"} ${pct(g)} on a year earlier.`,
    };
  }
  return { sales, profit, quarterEnd: latest.date };
}

function debtCheck(input: FundamentalsInput): FundamentalCheck {
  if (input.lender) return { key: "debt", label: "Debt", tone: "unknown", detail: "Banks and lenders borrow by design, so a debt ratio says nothing here." };
  if (input.debt == null || input.equity == null) return { key: "debt", label: "Debt", tone: "unknown", detail: "Debt or net worth is not available." };
  if (input.equity <= 0) return { key: "debt", label: "Debt", tone: "warn", detail: "Net worth is zero or negative: the company owes more than it owns." };
  const ratio = input.debt / input.equity;
  const text = `Borrowings are ${ratio.toFixed(2)} times the owners' money (₹${crores(input.debt)} Cr against ₹${crores(input.equity)} Cr).`;
  return { key: "debt", label: "Debt", tone: ratio <= 0.5 ? "good" : ratio <= 1.5 ? "ok" : "warn", detail: ratio <= 0.5 ? `Low. ${text}` : ratio <= 1.5 ? `Moderate. ${text}` : `High. ${text}` };
}

function promoterChecks(input: FundamentalsInput): FundamentalCheck[] {
  const [latest] = input.holdings;
  if (!latest) {
    return [
      { key: "promoter", label: "Owners", tone: "unknown", detail: "No shareholding filing found." },
    ];
  }
  const when = month(latest.date);
  if (latest.promoter < 1) {
    return [{ key: "promoter", label: "Owners", tone: "ok", detail: `No promoter group (as of ${when}): professionally run and widely held.` }];
  }
  const back = input.holdings[4] ?? input.holdings.at(-1);
  const change = back && back !== latest ? latest.promoter - back.promoter : null;
  let check: FundamentalCheck;
  if (change == null) {
    check = { key: "promoter", label: "Owners", tone: "ok", detail: `Promoters hold ${latest.promoter.toFixed(1)}% (${when}); not enough filings to see a trend.` };
  } else {
    const span = `since ${month(back!.date)}`;
    check = {
      key: "promoter", label: "Owners", tone: change >= 1 ? "good" : change <= -2 ? "warn" : "ok",
      detail: `Promoters hold ${latest.promoter.toFixed(1)}% (${when}), ${Math.abs(change) < 0.5 ? "about the same" : `${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} points`} ${span}.`,
    };
  }
  const p = input.pledgedPercent;
  const pledge: FundamentalCheck = p == null
    ? { key: "pledge", label: "Pledged shares", tone: "unknown", detail: "No pledge disclosure found." }
    : {
      key: "pledge", label: "Pledged shares", tone: p <= 0.5 ? "good" : p <= 10 ? "ok" : "warn",
      detail: p <= 0.5 ? "None of the promoters' shares are pledged to lenders." : `${pct(p)} of the promoters' shares are pledged to lenders${p > 10 ? ": if the price falls, forced selling is possible." : "."}`,
    };
  return [check, pledge];
}

/** Turns the raw figures into five plain checks and one verdict. Two or more warnings = weak; one = mixed; none with three good = strong. */
export function assessFundamentals(input: FundamentalsInput): FundamentalsReport {
  const { sales, profit, quarterEnd } = salesAndProfit(input);
  const checks = [sales, profit, debtCheck(input), ...promoterChecks(input)];
  const known = checks.filter((c) => c.tone !== "unknown");
  const warns = known.filter((c) => c.tone === "warn").length;
  const goods = known.filter((c) => c.tone === "good").length;
  if (known.length < 2) return { verdict: "unknown", headline: "Not enough company data to judge.", checks, quarterEnd };
  if (warns >= 2) return { verdict: "weak", headline: `Weak company: ${warns} warning signs. A good chart on a shaky company is a riskier trade.`, checks, quarterEnd };
  if (warns === 1) return { verdict: "mixed", headline: "Mixed: one warning sign. Read it before you buy.", checks, quarterEnd };
  if (goods >= 3) return { verdict: "strong", headline: "Strong company: growing, manageable debt, owners holding on.", checks, quarterEnd };
  return { verdict: "fine", headline: "Fine: no warning signs.", checks, quarterEnd };
}
