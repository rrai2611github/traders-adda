/**
 * Recent exchange announcements for one stock, from NSE's corporate-announcements feed (the filings companies submit to the exchange).
 * The AI news check reads only these, so every line it writes can be traced to an official filing.
 */
export interface Announcement {
  /** "30-Oct-2026 13:45:51" as NSE prints it. */
  at: string;
  /** NSE's category, e.g. "Outcome of Board Meeting". */
  subject: string;
  /** The first lines of the filing's own summary text. */
  text: string;
}

interface Row {
  an_dt?: string;
  desc?: string;
  attchmntText?: string;
}

const MAX_ITEMS = 10;
const MAX_TEXT = 260;
/** Routine filings with no bearing on a trade. */
const NOISE = /trading window|copy of newspaper|loss of share certificate|duplicate share|compliance certificate|reg\.? ?74|reg\.? ?40|investor grievance/i;

/** Newest first, de-duplicated, routine notices dropped, long text trimmed. */
export function parseAnnouncements(rows: ReadonlyArray<Row>): Announcement[] {
  const seen = new Set<string>();
  const out: Announcement[] = [];
  for (const row of rows) {
    const subject = (row.desc ?? "").trim();
    const text = (row.attchmntText ?? "").replace(/\s+/g, " ").trim();
    if (!row.an_dt || !subject || NOISE.test(subject) || NOISE.test(text)) continue;
    const key = `${subject}|${text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at: row.an_dt, subject, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text });
  }
  const time = (a: Announcement) => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?: (\d{2}:\d{2}:\d{2}))?/.exec(a.at); return m ? Date.parse(`${m[1]} ${m[2]} ${m[3]} ${m[4] ?? "00:00:00"} +0530`) || 0 : 0; };
  return out.sort((a, b) => time(b) - time(a)).slice(0, MAX_ITEMS);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const fmt = (d: Date) => { const s = new Date(d.getTime() + 19_800_000); return `${String(s.getUTCDate()).padStart(2, "0")}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${s.getUTCFullYear()}`; };

/** The last `days` days of announcements for a symbol; an empty list if NSE cannot be reached. Never throws. */
export async function fetchAnnouncements(symbol: string, days = 14, now = Date.now()): Promise<Announcement[]> {
  if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol)) return [];
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}&from_date=${fmt(new Date(now - days * 86_400_000))}&to_date=${fmt(new Date(now))}`;
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? parseAnnouncements(rows as Row[]) : [];
  } catch {
    return [];
  }
}
