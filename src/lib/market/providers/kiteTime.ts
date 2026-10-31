const ZONELESS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
const COMPACT_OFFSET = /([+-]\d{2})(\d{2})$/;

/**
 * Parses a Kite timestamp to epoch ms. Kite reports exchange times without a
 * zone ("2026-10-01 15:30:00"), which are IST; ISO strings keep their offset.
 * Returns null rather than substituting the fetch time when it cannot parse.
 */
export function parseKiteTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const zoneless = ZONELESS.exec(text);
  const iso = zoneless ? `${zoneless[1]}T${zoneless[2]}+05:30` : text.replace(COMPACT_OFFSET, "$1:$2");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}
