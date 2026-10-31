export function marketProviderErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Market data provider request failed.";
}

export function marketProviderErrorResponse(error: unknown): Response {
  return Response.json(
    { error: marketProviderErrorMessage(error) },
    {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * Rough ETA from the sweep's own elapsed-rate so far. Always an estimate, not
 * a promise — never phrased as exact, and omitted until there is at least a
 * few seconds and a few symbols of data to estimate from.
 */
function etaText(progress: { done: number; total: number; startedAt: number }): string {
  const elapsedMs = Date.now() - progress.startedAt;
  if (progress.done < 20 || elapsedMs < 3_000) return "";
  const remainingMs = (elapsedMs / progress.done) * (progress.total - progress.done);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "";
  const remainingSec = Math.round(remainingMs / 1000);
  return remainingSec < 60 ? ` — about ${remainingSec}s left` : ` — about ${Math.round(remainingSec / 60)} min left`;
}

/** First universe sweep still loading: report progress instead of partial results. */
export function universeWarmingResponse(progress: { phase: string; done: number; total: number; startedAt: number }): Response {
  const label = progress.phase === "history" ? "daily history" : "quotes";
  return Response.json(
    {
      warming: true,
      progress,
      error: `Loading NSE universe ${label}: ${progress.done} of ${progress.total} symbols.${etaText(progress)}`,
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    },
  );
}
