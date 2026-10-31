import type { ScanRow } from "../../hooks/useScreenScan";
import type { BuyIdea, ShortIdea } from "./commandCenter";

export type DashboardMetric = "above50" | "above200" | "advancing" | "buyReady" | "shortReady";

export function dashboardMetricRows(
  metric: DashboardMetric,
  marketRows: ReadonlyArray<ScanRow>,
  buyIdeas: ReadonlyArray<BuyIdea>,
  shortIdeas: ReadonlyArray<ShortIdea>,
): ScanRow[] {
  if (metric === "buyReady") {
    return buyIdeas.filter((idea) => idea.signal.status.key === "buy-ready").map((idea) => idea.row);
  }
  if (metric === "shortReady") {
    return shortIdeas.filter((idea) => idea.status.key === "short-ready").map((idea) => idea.row);
  }
  return marketRows.filter((row) => {
    if (metric === "advancing") return Number.isFinite(row.changePercent) && row.changePercent > 0;
    const value = metric === "above50" ? row.vs50 : row.vs200;
    return value != null && Number.isFinite(value) && value >= 0;
  });
}
