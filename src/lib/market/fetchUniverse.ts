/**
 * Runs a per-symbol provider call, keeping successes and naming failures.
 * Throws only when every symbol fails, so a provider outage still surfaces.
 */
export async function settlePerSymbol<T>(
  symbols: string[],
  load: (symbol: string) => Promise<T>,
): Promise<{ entries: Array<readonly [string, T]>; unavailable: string[] }> {
  const settled = await Promise.allSettled(symbols.map(load));
  const entries: Array<readonly [string, T]> = [];
  const unavailable: string[] = [];
  let firstError: unknown = null;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      entries.push([symbols[index], result.value] as const);
    } else {
      firstError ??= result.reason;
      unavailable.push(symbols[index]);
    }
  });
  if (symbols.length > 0 && entries.length === 0) {
    throw firstError ?? new Error("Provider returned no data.");
  }
  return { entries, unavailable };
}
