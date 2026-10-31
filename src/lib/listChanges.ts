/**
 * What changed in a list since the last session this browser saw it: stocks that are new, and stocks that
 * dropped off. The baseline is the list as it stood at the end of the previous day the page was opened.
 */
export interface ListMemory {
  /** IST day number of the latest visit. */
  day: number;
  /** The list as last seen on `day`. */
  current: string[];
  /** The list as last seen on the previous visit day, or null on the first day. */
  baseline: string[] | null;
  baselineDay: number | null;
}

export interface ListChanges {
  hasBaseline: boolean;
  /** IST day number the comparison is against. */
  since: number | null;
  added: ReadonlySet<string>;
  dropped: string[];
}

export function rollListMemory(memory: ListMemory | null, today: number, symbols: ReadonlyArray<string>): ListMemory {
  const current = [...symbols];
  if (!memory) return { day: today, current, baseline: null, baselineDay: null };
  if (memory.day === today) return { ...memory, current };
  // A visit from the future (clock change) is ignored rather than trusted as a baseline.
  if (memory.day > today) return { day: today, current, baseline: null, baselineDay: null };
  return { day: today, current, baseline: memory.current, baselineDay: memory.day };
}

export function diffList(memory: ListMemory | null, symbols: ReadonlyArray<string>): ListChanges {
  if (!memory?.baseline) return { hasBaseline: false, since: null, added: new Set(), dropped: [] };
  const before = new Set(memory.baseline);
  const now = new Set(symbols);
  return {
    hasBaseline: true,
    since: memory.baselineDay,
    added: new Set(symbols.filter((symbol) => !before.has(symbol))),
    dropped: memory.baseline.filter((symbol) => !now.has(symbol)),
  };
}
