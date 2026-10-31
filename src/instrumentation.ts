export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMarketAutoRefresh } = await import("./lib/market/autoRefresh");
  startMarketAutoRefresh();
  const { startHourlyEmailScheduler } = await import("./lib/alerts/hourlyEmail");
  startHourlyEmailScheduler();
  const { startPreOpenEmailScheduler } = await import("./lib/alerts/preOpenEmail");
  startPreOpenEmailScheduler();
  const { startPaperStraddleScheduler } = await import("./lib/scalp/paperStraddleRun");
  startPaperStraddleScheduler();
  const { startPaperEngine } = await import("./lib/paper/paperServer");
  startPaperEngine();
  const { startIndexPaperEngine } = await import("./lib/paper/indexPaperServer");
  startIndexPaperEngine();
  const { startFyersReminder } = await import("./lib/fyers/fyersReminder");
  startFyersReminder();
  const { startTop5Alert } = await import("./lib/alerts/top5Alert");
  startTop5Alert();
  const { startReadyAlert } = await import("./lib/alerts/readyAlert");
  startReadyAlert();
  const { startHistoryRefreshScheduler } = await import("./lib/backtest/historyRefresh");
  const { readTracker, trackerState } = await import("./lib/backtest/tracker");
  // After the close, add the day's candle to the price files and recompute the live strategy check, if one is running.
  const { sendTrackerNote } = await import("./lib/backtest/trackerNote");
  const { sendWeeklyReviewIfDue } = await import("./lib/ai/weeklyReviewServer");
  const { sendHealthIfDue } = await import("./lib/backtest/healthServer");
  const { hasOpenPositions, sendPositionsNoteIfDue } = await import("./lib/positions/positionsServer");
  const { startPositionsWatchdog } = await import("./lib/positions/watchdog");
  const { sendTomorrowPlanIfDue } = await import("./lib/positions/planServer");
  // Live stop alerts for real positions while the market is open, and an alarm if the saved prices fall behind.
  startPositionsWatchdog();
  // The price files are also refreshed while the user holds open positions, so the exit rules can be checked each evening.
  startHistoryRefreshScheduler(() => { trackerState(); void sendTrackerNote().then(() => sendWeeklyReviewIfDue()).then(() => sendHealthIfDue()).catch((error) => console.error("[weekly-review] failed:", error instanceof Error ? error.message : error)); void sendPositionsNoteIfDue().catch((error) => console.error("[positions] note failed:", error instanceof Error ? error.message : error)); void sendTomorrowPlanIfDue().catch((error) => console.error("[positions] plan failed:", error instanceof Error ? error.message : error)); }, () => readTracker() != null || hasOpenPositions());
}
