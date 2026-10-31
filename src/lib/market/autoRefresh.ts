import { getFreshUniverseSnapshot } from "./universeSnapshot";
import { getIndexContext } from "./indexContext";
import { shouldUpdateIndexOutlookJournal } from "./indexOutlookJournal";

/** Keep the shared snapshot fresh without requiring an open browser. */
export function startMarketAutoRefresh() {
  const globalRef = globalThis as typeof globalThis & {
    __marketAutoRefreshTimer?: ReturnType<typeof setInterval>;
  };
  if (globalRef.__marketAutoRefreshTimer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const state = await getFreshUniverseSnapshot();
      if (state.status === "failed") console.error("[market] automatic refresh failed:", state.error);
      if (shouldUpdateIndexOutlookJournal(Date.now())) await getIndexContext("completed");
    } catch (error) {
      console.error("[market] automatic refresh failed:", error);
    } finally {
      running = false;
    }
  };
  void tick();
  globalRef.__marketAutoRefreshTimer = setInterval(() => void tick(), 60_000);
  globalRef.__marketAutoRefreshTimer.unref?.();
}
