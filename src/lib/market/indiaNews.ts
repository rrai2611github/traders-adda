/**
 * Major India market headlines for the pre-open email: public RSS feeds, last 24 hours, ranked by how likely a headline is to move
 * the market (policy, regulators, flows, oil, the rupee, global shocks). Headlines only, with the link. A feed that fails is skipped,
 * and no failure here may stop the email.
 */

export interface Headline {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
}

export const NEWS_FEEDS: ReadonlyArray<{ source: string; url: string }> = [
  { source: "Economic Times", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { source: "Moneycontrol", url: "https://www.moneycontrol.com/rss/MCtopnews.xml" },
  { source: "Mint", url: "https://www.livemint.com/rss/markets" },
];

/** Words that make a headline market-wide news. Whole-word, case-insensitive. */
const MARKET_WORDS: ReadonlyArray<readonly [string, number]> = [
  ["rbi", 3], ["repo", 3], ["rate cut", 3], ["rate hike", 3], ["monetary policy", 3], ["mpc", 3], ["inflation", 2], ["cpi", 2], ["gdp", 2],
  ["budget", 3], ["gst", 2], ["tariff", 3], ["tax", 1], ["sebi", 3], ["fii", 3], ["fpi", 3], ["dii", 2], ["fed", 3], ["federal reserve", 3], ["powell", 2],
  ["crude", 2], ["oil price", 2], ["opec", 2], ["rupee", 3], ["dollar", 1], ["bond yield", 2], ["treasury", 1],
  ["sensex", 2], ["nifty", 2], ["market crash", 3], ["circuit", 2], ["f&o", 2], ["expiry", 2],
  ["war", 3], ["ceasefire", 3], ["sanctions", 2], ["election", 2], ["midterm", 2], ["lockdown", 3],

];

/** Headlines that are promotions or predictions, not news. */
const NOISE = /\b(stocks? to buy|buy or sell|picks?|prediction|horoscope|zodiac|shares? to watch for|multibagger|penny stocks?|q[1-4] results?|ipo ahead)\b/i;

function textOf(block: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return "";
  return match[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
}

const decode = (value: string) =>
  value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** Reads RSS items; items without a title, link or a readable date are dropped. */
export function parseRss(xml: string, source: string): Headline[] {
  const out: Headline[] = [];
  for (const match of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const title = decode(textOf(block, "title"));
    const link = decode(textOf(block, "link"));
    const publishedAt = Date.parse(textOf(block, "pubDate"));
    if (!title || !/^https?:\/\//.test(link) || !Number.isFinite(publishedAt)) continue;
    out.push({ title, link, source, publishedAt });
  }
  return out;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function relevance(title: string): number {
  const lower = title.toLowerCase();
  let score = 0;
  for (const [word, weight] of MARKET_WORDS) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`, "i").test(lower)) score += weight;
  }
  return score;
}

/** Fresh (within `maxAgeHours`), market-relevant, de-duplicated headlines, most relevant first and newer first among equals. */
export function topHeadlines(items: ReadonlyArray<Headline>, now: number, count = 5, maxAgeHours = 24): Headline[] {
  const cutoff = now - maxAgeHours * 3_600_000;
  const seen = new Set<string>();
  const ranked: Array<{ item: Headline; score: number }> = [];
  for (const item of items) {
    if (item.publishedAt < cutoff || item.publishedAt > now + 3_600_000) continue;
    if (NOISE.test(item.title)) continue;
    const score = relevance(item.title);
    if (score < 3) continue; // company results and stock tips are not market-wide news
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ item, score });
  }
  ranked.sort((a, b) => b.score - a.score || b.item.publishedAt - a.item.publishedAt);
  return ranked.slice(0, count).map((entry) => entry.item);
}

let cache: { at: number; items: Headline[] } | null = null;
const CACHE_MS = 10 * 60_000;

/** All feeds in parallel, each with its own short timeout; never throws. */
export async function fetchIndiaHeadlines(now: number = Date.now(), count = 5): Promise<Headline[]> {
  if (!cache || now - cache.at > CACHE_MS) {
    const lists = await Promise.all(
      NEWS_FEEDS.map(async (feed) => {
        try {
          const response = await fetch(feed.url, {
            cache: "no-store",
            headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAnalysis/1.0)" },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) return [];
          return parseRss(await response.text(), feed.source);
        } catch {
          return [];
        }
      }),
    );
    cache = { at: now, items: lists.flat() };
  }
  return topHeadlines(cache.items, now, count);
}
