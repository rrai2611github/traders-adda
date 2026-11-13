import { VISIBLE_SCANNER_KEYS } from "@/lib/screen/chartinkScans";
import { getScannerResults } from "@/lib/screen/scannerResults";
import { getBottomedOutResults } from "@/lib/screen/bottomedOutResults";
import { getRsiEdgeSourceResults } from "@/lib/screen/rsiEdgeChartink";
import { getMonthlySetupsPayload } from "@/lib/screen/monthlySetupsResults";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getMarketStatus } from "@/lib/market/marketHours";
import type { NavCounts } from "@/lib/navCounts";

export const dynamic = "force-dynamic";

/**
 * Small numbers for the sidebar, so the rail can show where matches are without the browser
 * downloading the full scanner payload (about 2 MB) on every page. Every figure reuses results the
 * server already keeps (scanner snapshot, bottomed-out snapshot, the 60-second RSI Edge cache) and is
 * whole-market: the universe filter on the Dashboard does not apply. A figure that is not ready yet is null.
 */
export async function GET() {
  const counts: NavCounts["counts"] = { scanners: null, "rsi-edge": null, monthly: null, bottomed: null };

  const scanners = getScannerResults("completed");
  if (scanners.status === "ready") {
    const liquid = new Set<string>();
    for (const key of VISIBLE_SCANNER_KEYS) {
      for (const row of scanners.payload.results[key] ?? []) if (row.passesFloor) liquid.add(row.symbol);
    }
    counts.scanners = liquid.size;
  }

  const bottomed = getBottomedOutResults(getMarketStatus().isLive ? "live" : "completed");
  if (bottomed.status === "ready") counts.bottomed = bottomed.payload.rows.length;

  // Shared with the Monthly Setups page and kept until the universe snapshot refreshes, so polling is cheap.
  const universe = getUniverseSnapshot();
  if (universe.status === "ready") {
    try {
      counts.monthly = getMonthlySetupsPayload(universe).rows.length;
    } catch (error) {
      console.error("[nav-counts] Monthly count failed:", error);
    }
  }

  try {
    const rsi = await getRsiEdgeSourceResults();
    const symbols = new Set<string>();
    for (const result of Object.values(rsi.scanners)) for (const row of result?.rows ?? []) symbols.add(row.symbol);
    counts["rsi-edge"] = symbols.size;
  } catch {
    // RSI Edge comes from Chartink; when it is unreachable the rail simply shows no number.
  }

  const body: NavCounts = { updatedAt: Date.now(), counts };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
