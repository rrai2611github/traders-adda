export interface BreakoutFeedCandidate<Tag extends string = string> {
  d: string;
  symbol: string;
  level: number;
  tags: Tag[];
}

/**
 * A stock can clear several nested bases in one session. The breakout record
 * represents that as one event, using the outermost base and all matched tags.
 */
export function canonicalBreakoutEvents<
  Tag extends string,
  Event extends BreakoutFeedCandidate<Tag>,
>(events: Event[]): Event[] {
  const byStockAndSession = new Map<string, Event>();

  for (const event of events) {
    const key = `${event.d}\0${event.symbol}`;
    const existing = byStockAndSession.get(key);
    if (!existing) {
      byStockAndSession.set(key, { ...event, tags: [...event.tags] });
      continue;
    }

    const canonical = event.level < existing.level ? event : existing;
    byStockAndSession.set(key, {
      ...canonical,
      tags: [...new Set([...existing.tags, ...event.tags])],
    });
  }

  return [...byStockAndSession.values()];
}
