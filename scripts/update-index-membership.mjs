import { writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_MEMBERSHIP_SOURCES, parseIndexMembers } from "./index-membership-import.mjs";

const entries = await Promise.all(Object.entries(INDEX_MEMBERSHIP_SOURCES).map(async ([symbol, definition]) => {
  const response = await fetch(definition.url, {
    headers: { "User-Agent": "Mozilla/5.0 (StockAnalysis constituent import)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${definition.url} returned HTTP ${response.status}`);
  return [symbol, { source: definition.url, members: parseIndexMembers(await response.text(), definition) }];
}));
const output = fileURLToPath(new URL("../src/lib/market/data/index-analysis-membership.json", import.meta.url));
const temporary = `${output}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, `${JSON.stringify({ generatedAt: new Date().toISOString(), indices: Object.fromEntries(entries) }, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}
for (const [symbol, entry] of entries) console.log(`${symbol}: ${entry.members.length} verified members`);
