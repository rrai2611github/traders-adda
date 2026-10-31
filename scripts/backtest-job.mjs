// Runs one backtest in its own process: node scripts/backtest-job.mjs <settings.json> <result.json>
// Progress lines go to stdout; the website's job runner reads them.
import { readFileSync, writeFileSync } from "node:fs";
import { runBacktest } from "../src/lib/backtest/run.ts";

const [settingsFile, resultFile] = process.argv.slice(2);
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
const result = runBacktest(settings, ".cache/history10y", (m) => console.log(m));
writeFileSync(resultFile, JSON.stringify(result));
console.log("done");
