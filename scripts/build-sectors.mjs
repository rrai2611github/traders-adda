// Rebuilds src/lib/market/data/sectors.json (the sector of each stock, used for the per-sector limit on My positions and in the backtest).
// It reads the running app's scan, so start the site first and let the scan finish:
//   curl -s localhost:3107/api/market/screen -o tmp/screen3.json && node scripts/build-sectors.mjs
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("tmp/screen3.json", "utf8"));
const sectors = {};
for (const r of [...j.rows, ...(j.extraRows ?? [])]) if (r.sector && r.sector !== "Unclassified") sectors[r.symbol] = r.sector;
const sorted = Object.fromEntries(Object.entries(sectors).sort(([a], [b]) => a.localeCompare(b)));
const out = {
  generatedAt: new Date().toISOString(),
  source: "NSE sector of each stock in the app's scan (liquid stocks and the extra rows), saved so the backtest and My positions can limit positions per sector. Today's labels are used for past years; a stock's sector rarely changes.",
  sectors: sorted,
};
fs.writeFileSync("src/lib/market/data/sectors.json", JSON.stringify(out, null, 1));
console.log("saved", Object.keys(sorted).length, "sector labels");
