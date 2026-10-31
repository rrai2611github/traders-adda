// Fetches market capitalisation (in crore rupees) for every stock in the NSE list from Yahoo Finance's batch quote endpoint
// and writes src/lib/market/data/market-caps.json, which the stock list reads.
// Usage: node --use-system-ca --no-warnings scripts/fetch-market-caps.mjs
// Re-run weekly: market caps drift with price, and new listings appear in nse-equities.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/lib/market/data/market-caps.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const BATCH = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const symbols = JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.map((e) => e.symbol);

async function session() {
  const home = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  const cookie = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  if (!res.ok) throw new Error(`Yahoo crumb request failed (HTTP ${res.status}).`);
  return { cookie, crumb: await res.text() };
}

let { cookie, crumb } = await session();
const caps = {};
const missing = [];
let failedBatches = 0;
for (let i = 0; i < symbols.length; i += BATCH) {
  const chunk = symbols.slice(i, i + BATCH);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.map((s) => `${s}.NS`).join(","))}&crumb=${encodeURIComponent(crumb)}&fields=marketCap`;
  let result = null;
  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
      if (res.status === 401 || res.status === 403) { ({ cookie, crumb } = await session()); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result = (await res.json()).quoteResponse?.result ?? [];
    } catch (error) {
      await sleep(1500 * (attempt + 1));
      if (attempt === 2) console.warn(`batch ${i / BATCH + 1} failed: ${error.message}`);
    }
  }
  if (!result) { failedBatches += 1; missing.push(...chunk); continue; }
  const seen = new Set();
  for (const quote of result) {
    const symbol = quote.symbol?.replace(/\.NS$/, "");
    if (!symbol || !(quote.marketCap > 0)) continue;
    caps[symbol] = Math.round(quote.marketCap / 1e7);
    seen.add(symbol);
  }
  for (const s of chunk) if (!seen.has(s)) missing.push(s);
  process.stdout.write(`\r${Math.min(i + BATCH, symbols.length)}/${symbols.length} symbols, ${Object.keys(caps).length} with a market cap`);
  await sleep(350);
}
console.log();
// Yahoo sometimes drops a symbol from a large batch; ask for the stragglers again in small groups.
const retry = [...missing];
missing.length = 0;
for (let i = 0; i < retry.length; i += 10) {
  const chunk = retry.slice(i, i + 10);
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.map((s) => `${s}.NS`).join(","))}&crumb=${encodeURIComponent(crumb)}&fields=marketCap`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
    const result = res.ok ? (await res.json()).quoteResponse?.result ?? [] : [];
    const seen = new Set();
    for (const quote of result) {
      const symbol = quote.symbol?.replace(/\.NS$/, "");
      if (symbol && quote.marketCap > 0) { caps[symbol] = Math.round(quote.marketCap / 1e7); seen.add(symbol); }
    }
    for (const s of chunk) if (!seen.has(s)) missing.push(s);
  } catch {
    missing.push(...chunk);
  }
  await sleep(300);
}
if (failedBatches > 3) throw new Error(`${failedBatches} batches failed; not overwriting the existing file.`);
const sorted = Object.fromEntries(Object.entries(caps).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "Yahoo Finance batch quote (marketCap, converted to crore rupees)", count: Object.keys(sorted).length, caps: sorted }, null, 1)}\n`);
console.log(`Wrote ${Object.keys(sorted).length} market caps to ${OUT}. Without one: ${missing.length}${missing.length ? ` (${missing.slice(0, 15).join(", ")}${missing.length > 15 ? ", ..." : ""})` : ""}.`);
