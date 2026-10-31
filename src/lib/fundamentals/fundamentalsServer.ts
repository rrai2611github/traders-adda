import { assessFundamentals, parsePledge, parseShareholding, parseYahooFundamentals, type FundamentalsReport } from "./assess.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 12 * 3_600_000;
const cache = new Map<string, { at: number; report: FundamentalsReport }>();

async function getJson(url: string, referer: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer }, signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * Company health for one NSE symbol: Yahoo for sales, profit, debt and net worth; NSE for promoter holding and pledged shares.
 * Any source can fail on its own; the report then says "not available" for just those checks. Null only when nothing came back at all.
 * Cached for 12 hours: these figures change four times a year.
 */
export async function fetchFundamentals(symbol: string, lender: boolean, now = Date.now()): Promise<FundamentalsReport | null> {
  if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return null;
  const key = `${symbol}|${lender ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.report;

  const nowSec = Math.floor(now / 1000);
  const types = ["quarterlyTotalRevenue", "quarterlyNetIncome", "annualTotalDebt", "annualStockholdersEquity"].join(",");
  const yahoo = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}.NS?type=${types}&period1=${nowSec - 86_400 * 1500}&period2=${nowSec}`;
  const nse = (path: string) => `https://www.nseindia.com/api/${path}?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const [fin, share, pledge] = await Promise.all([
    getJson(yahoo, "https://finance.yahoo.com/"),
    getJson(nse("corporate-share-holdings-master"), "https://www.nseindia.com/"),
    getJson(nse("corporate-pledgedata"), "https://www.nseindia.com/"),
  ]);
  if (fin == null && share == null && pledge == null) return null;

  const report = assessFundamentals({
    ...parseYahooFundamentals(fin),
    holdings: parseShareholding(share),
    pledgedPercent: parsePledge(pledge),
    lender,
    now,
  });
  cache.set(key, { at: now, report });
  return report;
}
