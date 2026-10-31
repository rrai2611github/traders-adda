// Downloads up to 10 years of daily candles for every stock in the NSE list (plus the Nifty 50) from Yahoo Finance into
// .cache/history10y/<SYMBOL>.json, in the same compact layout the app's own cache uses: { fetchedAt, c: [[t,o,h,l,c,v], ...] }.
// The backtest reads these files; the live scan keeps its shorter history. Safe to re-run: files newer than MAX_AGE_DAYS are skipped.
// Usage: node --use-system-ca --no-warnings scripts/fetch-history.mjs [--force] [--recent] [--limit N]
// --recent downloads only the last month for every symbol and merges it into the saved files; run it after the close to add the day's candle.
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".cache", "history10y");
const MAX_AGE_DAYS = 3;
const CONCURRENCY = 5;
const UA = "Mozilla/5.0 (compatible; StockAnalysis/1.0)";
const force = process.argv.includes("--force");
const recent = process.argv.includes("--recent");
const limitAt = process.argv.indexOf("--limit");
const limit = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const symbols = JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.map((e) => e.symbol);
const jobs = [{ symbol: "NIFTY50", ticker: "^NSEI" }, ...symbols.map((symbol) => ({ symbol, ticker: `${symbol}.NS` }))].slice(0, limit);
const file = (symbol) => join(OUT, `${encodeURIComponent(symbol)}.json`);
const fresh = (symbol) => { try { return Date.now() - statSync(file(symbol)).mtimeMs < MAX_AGE_DAYS * 86_400_000; } catch { return false; } };

// Before 16:00 IST today's candle is still forming, and a half-finished day must never be saved as a finished one.
function dropToday(rows) {
  const shifted = new Date(Date.now() + 19_800_000);
  if (shifted.getUTCHours() >= 16) return rows;
  const today = shifted.toISOString().slice(0, 10);
  return rows.filter((row) => new Date(row[0] + 19_800_000).toISOString().slice(0, 10) !== today);
}

async function download(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${recent ? "1mo" : "10y"}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 404) return { status: "missing" };
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) return { status: `http ${res.status}` };
      const r = (await res.json()).chart?.result?.[0];
      if (!r?.timestamp) return { status: "empty" };
      const q = r.indicators.quote[0];
      const c = [];
      r.timestamp.forEach((t, i) => {
        const open = q.open[i], high = q.high[i], low = q.low[i], close = q.close[i], volume = q.volume[i];
        // Yahoo marks non-trading days with nulls; a bar needs every price.
        if ([open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) c.push([t * 1000, +open.toFixed(4), +high.toFixed(4), +low.toFixed(4), +close.toFixed(4), Number.isFinite(volume) ? volume : 0]);
      });
      return { status: "ok", c };
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return { status: "failed" };
}

const tally = { ok: 0, skipped: 0, missing: 0, other: 0 };
const problems = [];
let next = 0;
const started = Date.now();
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    if (!force && !recent && fresh(job.symbol)) { tally.skipped++; continue; }
    const res = await download(job.ticker);
    if (res.status === "ok" && res.c.length) {
      let c = dropToday(res.c);
      if (recent) {
        // Keep the saved history and replace everything from the first downloaded day onward.
        try {
          const saved = JSON.parse(readFileSync(file(job.symbol), "utf8")).c;
          if (Array.isArray(saved) && saved.length && c.length) c = saved.filter((row) => row[0] < c[0][0]).concat(c);
        } catch { /* no saved file yet: the month alone is not a history, so skip it */ tally.skipped++; continue; }
      }
      writeFileSync(file(job.symbol), JSON.stringify({ fetchedAt: Date.now(), c }));
      tally.ok++;
    } else if (res.status === "missing") tally.missing++;
    else { tally.other++; problems.push(`${job.symbol}: ${res.status}`); }
    const done = tally.ok + tally.skipped + tally.missing + tally.other;
    if (done % 100 === 0) console.log(`${done}/${jobs.length} done (${tally.ok} downloaded, ${tally.skipped} already fresh, ${tally.missing} not on Yahoo, ${tally.other} failed) in ${Math.round((Date.now() - started) / 1000)}s`);
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Finished in ${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(tally)}${problems.length ? `\nFailures (first 20): ${problems.slice(0, 20).join("; ")}` : ""}`);
