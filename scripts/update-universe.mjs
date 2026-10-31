#!/usr/bin/env node
// Downloads NSE's official equity master and writes the scan universe snapshot.
// Usage: npm run update-universe
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const INDUSTRY_LIST_URL = "https://niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv";
const INDEX_LIST_URLS = {
  nifty50: "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv",
  nifty100: "https://niftyindices.com/IndexConstituent/ind_nifty100list.csv",
  nifty200: "https://niftyindices.com/IndexConstituent/ind_nifty200list.csv",
  nifty500: "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv",
};
const FNO_LOTS_URL = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv";
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "market", "data");
const OUTPUT = join(DATA_DIR, "nse-equities.json");
const INDEX_OUTPUT = join(DATA_DIR, "index-universes.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().toUpperCase());
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ""])));
}

async function download(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (StockAnalysis universe import)" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function isoDate(nseDate) {
  const parsed = Date.parse(`${nseDate} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

const [equityCsv, industryCsv] = await Promise.all([download(EQUITY_LIST_URL), download(INDUSTRY_LIST_URL)]);

const industryBySymbol = new Map(
  parseCsv(industryCsv)
    .filter((row) => row.SYMBOL && row.INDUSTRY)
    .map((row) => [row.SYMBOL.toUpperCase(), row.INDUSTRY]),
);

// EQ is the regular series. BE is trade-for-trade (delivery only, usually a 5% price band): the screens list it, flagged, and no
// trading signal does. BZ (non-compliant companies) is left out.
const SERIES = new Set(["EQ", "BE"]);
const equities = parseCsv(equityCsv)
  .filter((row) => SERIES.has(row.SERIES) && row.SYMBOL)
  .map((row) => ({
    series: row.SERIES,
    symbol: row.SYMBOL.toUpperCase(),
    name: row["NAME OF COMPANY"],
    isin: row["ISIN NUMBER"] || null,
    listedOn: isoDate(row["DATE OF LISTING"]),
    industry: industryBySymbol.get(row.SYMBOL.toUpperCase()) ?? null,
  }))
  .sort((a, b) => a.symbol.localeCompare(b.symbol));

const regular = equities.filter((e) => e.series === "EQ").length;
if (regular < 1000) {
  throw new Error(`Only ${regular} EQ rows parsed; refusing to overwrite the universe.`);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  sources: { equities: EQUITY_LIST_URL, industry: INDUSTRY_LIST_URL },
  series: "EQ+BE",
  counts: { EQ: regular, BE: equities.length - regular },
  count: equities.length,
  equities,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(snapshot)}\n`);
const classified = equities.filter((e) => e.industry).length;
console.log(`Wrote ${equities.length} NSE equities (${regular} EQ, ${equities.length - regular} trade-for-trade BE; ${classified} with NSE industry) to ${OUTPUT}`);

// Index and F&O membership, restricted to symbols on the EQ master.
const known = new Set(equities.map((e) => e.symbol));
const members = (rows) => [...new Set(rows.map((s) => s.trim().toUpperCase()).filter((s) => known.has(s)))].sort();
const indexCsvs = await Promise.all(Object.values(INDEX_LIST_URLS).map(download));
const indexLists = Object.fromEntries(
  Object.keys(INDEX_LIST_URLS).map((key, i) => [key, members(parseCsv(indexCsvs[i]).map((row) => row.SYMBOL ?? ""))]),
);
// fo_mktlots.csv lists index underlyings first (NIFTY, BANKNIFTY, …); the EQ filter drops them.
const fno = members(parseCsv(await download(FNO_LOTS_URL)).map((row) => row.SYMBOL ?? ""));

const minimum = { nifty50: 45, nifty100: 90, nifty200: 180, nifty500: 450 };
for (const [key, min] of Object.entries(minimum)) {
  if (indexLists[key].length < min) throw new Error(`${key} has only ${indexLists[key].length} members; refusing to write.`);
}
if (fno.length < 150) throw new Error(`F&O list has only ${fno.length} stocks; refusing to write.`);

await writeFile(INDEX_OUTPUT, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: { ...INDEX_LIST_URLS, fno: FNO_LOTS_URL },
  ...indexLists,
  fno,
})}\n`);
console.log(
  `Wrote index universes to ${INDEX_OUTPUT}: ${Object.entries(indexLists).map(([k, v]) => `${k} ${v.length}`).join(", ")}, fno ${fno.length}`,
);
