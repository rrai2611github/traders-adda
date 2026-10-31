import type { Instrument } from "./types";
import nseEquities from "./data/nse-equities.json";
import marketCaps from "./data/market-caps.json";
import { DEFAULT_INDEX_SYMBOLS, DEFAULT_WATCHLIST } from "./defaults";

export { DEFAULT_INDEX_SYMBOLS, DEFAULT_WATCHLIST };

/**
 * Scan universe.
 *
 * Equities come from NSE's official EQ-series master (`npm run update-universe`
 * regenerates `data/nse-equities.json`). The hand-maintained entries below only
 * add detail (sector, approximate market cap, simulator seeds) to symbols that
 * are still on that list; delisted or renamed tickers drop out automatically.
 *
 * `seedPrice`, `volatility` and `avgVolume` only drive the simulated feed.
 */
export interface SeedInstrument extends Instrument {
  seedPrice: number;
  /** Annualised volatility used by the random-walk simulator. */
  volatility: number;
  /** Typical full-session traded volume. */
  avgVolume: number;
  isin?: string;
  listedOn?: string;
}

export const INDICES: SeedInstrument[] = [
  { symbol: "NIFTY50", name: "Nifty 50", exchange: "NSE", kind: "INDEX", seedPrice: 24800, volatility: 0.12, avgVolume: 0 },
  { symbol: "BANKNIFTY", name: "Nifty Bank", exchange: "NSE", kind: "INDEX", seedPrice: 53200, volatility: 0.16, avgVolume: 0 },
  { symbol: "NIFTYMIDCAP", name: "Nifty Midcap 100", exchange: "NSE", kind: "INDEX", seedPrice: 57400, volatility: 0.18, avgVolume: 0 },
  { symbol: "NIFTYIT", name: "Nifty IT", exchange: "NSE", kind: "INDEX", seedPrice: 38900, volatility: 0.2, avgVolume: 0 },
  { symbol: "INDIAVIX", name: "India VIX", exchange: "NSE", kind: "INDEX", seedPrice: 13.4, volatility: 0.75, avgVolume: 0 },
];

const CURATED_EQUITIES: SeedInstrument[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE", kind: "EQUITY", sector: "Energy", marketCapCr: 1920000, seedPrice: 1418, volatility: 0.22, avgVolume: 9_800_000 },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", kind: "EQUITY", sector: "IT", marketCapCr: 1410000, seedPrice: 3890, volatility: 0.2, avgVolume: 2_600_000 },
  { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 1490000, seedPrice: 1952, volatility: 0.19, avgVolume: 11_200_000 },
  { symbol: "ICICIBANK", name: "ICICI Bank", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 990000, seedPrice: 1404, volatility: 0.21, avgVolume: 8_400_000 },
  { symbol: "INFY", name: "Infosys", exchange: "NSE", kind: "EQUITY", sector: "IT", marketCapCr: 780000, seedPrice: 1876, volatility: 0.23, avgVolume: 6_100_000 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", exchange: "NSE", kind: "EQUITY", sector: "Telecom", marketCapCr: 1050000, seedPrice: 1738, volatility: 0.24, avgVolume: 4_900_000 },
  { symbol: "SBIN", name: "State Bank of India", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 740000, seedPrice: 829, volatility: 0.26, avgVolume: 14_300_000 },
  { symbol: "LT", name: "Larsen & Toubro", exchange: "NSE", kind: "EQUITY", sector: "Infrastructure", marketCapCr: 495000, seedPrice: 3602, volatility: 0.24, avgVolume: 2_200_000 },
  { symbol: "ITC", name: "ITC", exchange: "NSE", kind: "EQUITY", sector: "FMCG", marketCapCr: 520000, seedPrice: 415, volatility: 0.18, avgVolume: 13_500_000 },
  { symbol: "AXISBANK", name: "Axis Bank", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 360000, seedPrice: 1162, volatility: 0.25, avgVolume: 7_600_000 },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 390000, seedPrice: 1968, volatility: 0.22, avgVolume: 3_400_000 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", exchange: "NSE", kind: "EQUITY", sector: "FMCG", marketCapCr: 560000, seedPrice: 2384, volatility: 0.17, avgVolume: 2_100_000 },
  { symbol: "MARUTI", name: "Maruti Suzuki India", exchange: "NSE", kind: "EQUITY", sector: "Auto", marketCapCr: 400000, seedPrice: 12740, volatility: 0.24, avgVolume: 780_000 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", exchange: "NSE", kind: "EQUITY", sector: "Pharma", marketCapCr: 415000, seedPrice: 1731, volatility: 0.21, avgVolume: 2_400_000 },
  { symbol: "TITAN", name: "Titan Company", exchange: "NSE", kind: "EQUITY", sector: "Consumer", marketCapCr: 320000, seedPrice: 3604, volatility: 0.25, avgVolume: 1_500_000 },
  { symbol: "ASIANPAINT", name: "Asian Paints", exchange: "NSE", kind: "EQUITY", sector: "Consumer", marketCapCr: 230000, seedPrice: 2402, volatility: 0.23, avgVolume: 1_800_000 },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", exchange: "NSE", kind: "EQUITY", sector: "Cement", marketCapCr: 345000, seedPrice: 11890, volatility: 0.22, avgVolume: 520_000 },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 560000, seedPrice: 905, volatility: 0.28, avgVolume: 9_100_000 },
  { symbol: "WIPRO", name: "Wipro", exchange: "NSE", kind: "EQUITY", sector: "IT", marketCapCr: 265000, seedPrice: 252, volatility: 0.26, avgVolume: 12_700_000 },
  { symbol: "HCLTECH", name: "HCL Technologies", exchange: "NSE", kind: "EQUITY", sector: "IT", marketCapCr: 445000, seedPrice: 1642, volatility: 0.24, avgVolume: 3_100_000 },
  { symbol: "TECHM", name: "Tech Mahindra", exchange: "NSE", kind: "EQUITY", sector: "IT", marketCapCr: 150000, seedPrice: 1536, volatility: 0.27, avgVolume: 2_900_000 },
  { symbol: "ADANIENT", name: "Adani Enterprises", exchange: "NSE", kind: "EQUITY", sector: "Conglomerate", marketCapCr: 290000, seedPrice: 2412, volatility: 0.42, avgVolume: 4_600_000 },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ", exchange: "NSE", kind: "EQUITY", sector: "Infrastructure", marketCapCr: 310000, seedPrice: 1398, volatility: 0.34, avgVolume: 5_200_000 },
  { symbol: "JSWSTEEL", name: "JSW Steel", exchange: "NSE", kind: "EQUITY", sector: "Metals", marketCapCr: 250000, seedPrice: 1026, volatility: 0.29, avgVolume: 4_800_000 },
  { symbol: "TATASTEEL", name: "Tata Steel", exchange: "NSE", kind: "EQUITY", sector: "Metals", marketCapCr: 205000, seedPrice: 164, volatility: 0.31, avgVolume: 42_000_000 },
  { symbol: "HINDALCO", name: "Hindalco Industries", exchange: "NSE", kind: "EQUITY", sector: "Metals", marketCapCr: 165000, seedPrice: 738, volatility: 0.32, avgVolume: 8_700_000 },
  { symbol: "COALINDIA", name: "Coal India", exchange: "NSE", kind: "EQUITY", sector: "Energy", marketCapCr: 240000, seedPrice: 389, volatility: 0.27, avgVolume: 11_400_000 },
  { symbol: "NTPC", name: "NTPC", exchange: "NSE", kind: "EQUITY", sector: "Power", marketCapCr: 330000, seedPrice: 341, volatility: 0.24, avgVolume: 14_800_000 },
  { symbol: "POWERGRID", name: "Power Grid Corporation", exchange: "NSE", kind: "EQUITY", sector: "Power", marketCapCr: 265000, seedPrice: 285, volatility: 0.22, avgVolume: 13_200_000 },
  { symbol: "ONGC", name: "Oil & Natural Gas Corp", exchange: "NSE", kind: "EQUITY", sector: "Energy", marketCapCr: 305000, seedPrice: 242, volatility: 0.28, avgVolume: 16_500_000 },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", exchange: "NSE", kind: "EQUITY", sector: "Pharma", marketCapCr: 105000, seedPrice: 1258, volatility: 0.24, avgVolume: 2_700_000 },
  { symbol: "CIPLA", name: "Cipla", exchange: "NSE", kind: "EQUITY", sector: "Pharma", marketCapCr: 125000, seedPrice: 1547, volatility: 0.23, avgVolume: 2_300_000 },
  { symbol: "NESTLEIND", name: "Nestle India", exchange: "NSE", kind: "EQUITY", sector: "FMCG", marketCapCr: 215000, seedPrice: 2234, volatility: 0.18, avgVolume: 1_400_000 },
  { symbol: "M&M", name: "Mahindra & Mahindra", exchange: "NSE", kind: "EQUITY", sector: "Auto", marketCapCr: 380000, seedPrice: 3068, volatility: 0.26, avgVolume: 3_300_000 },
  { symbol: "EICHERMOT", name: "Eicher Motors", exchange: "NSE", kind: "EQUITY", sector: "Auto", marketCapCr: 175000, seedPrice: 6412, volatility: 0.27, avgVolume: 950_000 },
  { symbol: "DMART", name: "Avenue Supermarts", exchange: "NSE", kind: "EQUITY", sector: "Retail", marketCapCr: 265000, seedPrice: 4082, volatility: 0.28, avgVolume: 720_000 },
  { symbol: "ETERNAL", name: "Eternal (formerly Zomato)", exchange: "NSE", kind: "EQUITY", sector: "Internet", marketCapCr: 250000, seedPrice: 268, volatility: 0.45, avgVolume: 58_000_000 },
  { symbol: "PAYTM", name: "One 97 Communications", exchange: "NSE", kind: "EQUITY", sector: "Fintech", marketCapCr: 62000, seedPrice: 972, volatility: 0.52, avgVolume: 6_400_000 },
  { symbol: "IRFC", name: "Indian Railway Finance Corp", exchange: "NSE", kind: "EQUITY", sector: "Financials", marketCapCr: 165000, seedPrice: 126, volatility: 0.4, avgVolume: 34_000_000 },
  { symbol: "IRCTC", name: "Indian Railway Catering & Tourism", exchange: "NSE", kind: "EQUITY", sector: "Travel", marketCapCr: 62000, seedPrice: 778, volatility: 0.35, avgVolume: 4_100_000 },
  { symbol: "DIXON", name: "Dixon Technologies", exchange: "NSE", kind: "EQUITY", sector: "Electronics", marketCapCr: 92000, seedPrice: 15420, volatility: 0.44, avgVolume: 480_000 },
  { symbol: "FILATEX", name: "Filatex India Limited", exchange: "NSE", kind: "EQUITY", sector: "Textiles", seedPrice: 87.41, volatility: 0.44, avgVolume: 2_800_000 },
  { symbol: "SYRMA", name: "Syrma SGS Technology Limited", exchange: "NSE", kind: "EQUITY", sector: "Electronics", seedPrice: 1589.3, volatility: 0.42, avgVolume: 950_000 },
  { symbol: "CHENNPETRO", name: "Chennai Petroleum Corporation Limited", exchange: "NSE", kind: "EQUITY", sector: "Energy", seedPrice: 1572.9, volatility: 0.4, avgVolume: 1_300_000 },
  { symbol: "WABAG", name: "VA Tech Wabag Limited", exchange: "NSE", kind: "EQUITY", sector: "Water Infrastructure", seedPrice: 2277.9, volatility: 0.38, avgVolume: 610_000 },
  { symbol: "ARVIND", name: "Arvind Limited", exchange: "NSE", kind: "EQUITY", sector: "Textiles", seedPrice: 575.1, volatility: 0.35, avgVolume: 1_000_000 },
  { symbol: "EXICOM", name: "Exicom Tele-Systems Limited", exchange: "NSE", kind: "EQUITY", sector: "Power Electronics", seedPrice: 182.28, volatility: 0.5, avgVolume: 1_600_000 },
  { symbol: "WOCKPHARMA", name: "Wockhardt Limited", exchange: "NSE", kind: "EQUITY", sector: "Pharma", seedPrice: 2179.4, volatility: 0.48, avgVolume: 390_000 },
  { symbol: "YASHO", name: "Yasho Industries Limited", exchange: "NSE", kind: "EQUITY", sector: "Chemicals", seedPrice: 4187.5, volatility: 0.36, avgVolume: 180_000 },
  { symbol: "CPPLUS", name: "Aditya Infotech Limited", exchange: "NSE", kind: "EQUITY", sector: "Electronics", seedPrice: 3825.5, volatility: 0.42, avgVolume: 320_000 },
  { symbol: "GANDHAR", name: "Gandhar Oil Refinery (India) Limited", exchange: "NSE", kind: "EQUITY", sector: "Energy", seedPrice: 272.7, volatility: 0.38, avgVolume: 1_200_000 },
  { symbol: "MACPOWER", name: "Macpower CNC Machines Limited", exchange: "NSE", kind: "EQUITY", sector: "Industrials", seedPrice: 1843, volatility: 0.44, avgVolume: 120_000 },
  { symbol: "PARAS", name: "Paras Defence and Space Technologies Limited", exchange: "NSE", kind: "EQUITY", sector: "Defence", seedPrice: 1435.6, volatility: 0.52, avgVolume: 1_100_000 },
  { symbol: "AVADHSUGAR", name: "Avadh Sugar & Energy Limited", exchange: "NSE", kind: "EQUITY", sector: "Sugar", seedPrice: 769.6, volatility: 0.39, avgVolume: 230_000 },
  { symbol: "SUVEN", name: "Suven Life Sciences Limited", exchange: "NSE", kind: "EQUITY", sector: "Pharma", seedPrice: 355.55, volatility: 0.46, avgVolume: 1_500_000 },
  { symbol: "AEGISLOG", name: "Aegis Logistics Limited", exchange: "NSE", kind: "EQUITY", sector: "Logistics", seedPrice: 1353.6, volatility: 0.4, avgVolume: 900_000 },
  { symbol: "DECNGOLD", name: "Deccan Gold Mines Limited", exchange: "NSE", kind: "EQUITY", sector: "Mining", seedPrice: 229.73, volatility: 0.58, avgVolume: 1_600_000 },
  { symbol: "ACUTAAS", name: "Acutaas Chemicals Limited", exchange: "NSE", kind: "EQUITY", sector: "Chemicals", seedPrice: 3383.7, volatility: 0.37, avgVolume: 95_000 },
  { symbol: "RAIN", name: "Rain Industries Limited", exchange: "NSE", kind: "EQUITY", sector: "Materials", seedPrice: 215.97, volatility: 0.35, avgVolume: 1_900_000 },
  { symbol: "DATAPATTNS", name: "Data Patterns (India) Limited", exchange: "NSE", kind: "EQUITY", sector: "Defence", seedPrice: 4829.2, volatility: 0.45, avgVolume: 450_000 },
  { symbol: "KTKBANK", name: "The Karnataka Bank Limited", exchange: "NSE", kind: "EQUITY", sector: "Financials", seedPrice: 325.35, volatility: 0.36, avgVolume: 2_800_000 },
  { symbol: "APOLLO", name: "Apollo Micro Systems Limited", exchange: "NSE", kind: "EQUITY", sector: "Defence", seedPrice: 422.25, volatility: 0.56, avgVolume: 4_900_000 },
  { symbol: "MCX", name: "Multi Commodity Exchange of India Limited", exchange: "NSE", kind: "EQUITY", sector: "Financials", seedPrice: 3276, volatility: 0.34, avgVolume: 620_000 },
  { symbol: "RBA", name: "Restaurant Brands Asia Limited", exchange: "NSE", kind: "EQUITY", sector: "Consumer", seedPrice: 98.05, volatility: 0.31, avgVolume: 1_700_000 },
  { symbol: "APCOTEXIND", name: "Apcotex Industries Limited", exchange: "NSE", kind: "EQUITY", sector: "Chemicals", seedPrice: 601.15, volatility: 0.32, avgVolume: 140_000 },
  { symbol: "NETWEB", name: "Netweb Technologies India Limited", exchange: "NSE", kind: "EQUITY", sector: "Technology", seedPrice: 5027, volatility: 0.5, avgVolume: 470_000 },
  { symbol: "ASKAUTOLTD", name: "ASK Automotive Limited", exchange: "NSE", kind: "EQUITY", sector: "Auto", seedPrice: 624.55, volatility: 0.33, avgVolume: 290_000 },
  { symbol: "BALRAMCHIN", name: "Balrampur Chini Mills Limited", exchange: "NSE", kind: "EQUITY", sector: "Sugar", seedPrice: 691.4, volatility: 0.36, avgVolume: 1_100_000 },
  { symbol: "ORCHPHARMA", name: "Orchid Pharma Limited", exchange: "NSE", kind: "EQUITY", sector: "Pharma", seedPrice: 1003.05, volatility: 0.48, avgVolume: 410_000 },
  { symbol: "DYNAMATECH", name: "Dynamatic Technologies Limited", exchange: "NSE", kind: "EQUITY", sector: "Industrials", seedPrice: 12097, volatility: 0.42, avgVolume: 85_000 },
  { symbol: "AEGISVOPAK", name: "Aegis Vopak Terminals Limited", exchange: "NSE", kind: "EQUITY", sector: "Logistics", seedPrice: 295.1, volatility: 0.46, avgVolume: 1_000_000 },
  { symbol: "DALMIASUG", name: "Dalmia Bharat Sugar and Industries Limited", exchange: "NSE", kind: "EQUITY", sector: "Sugar", seedPrice: 417.35, volatility: 0.34, avgVolume: 260_000 },
  { symbol: "POLYPLEX", name: "Polyplex Corporation Limited", exchange: "NSE", kind: "EQUITY", sector: "Packaging", seedPrice: 1134.2, volatility: 0.35, avgVolume: 110_000 },
];

interface NseEquityRecord {
  symbol: string;
  /** Absent in older snapshots, which held EQ only. */
  series?: "EQ" | "BE";
  name: string;
  isin: string | null;
  listedOn: string | null;
  industry: string | null;
}

/** Provenance of the equity list, surfaced to the UI. */
export const UNIVERSE_INFO = {
  source: "NSE EQUITY_L (EQ series)",
  generatedAt: nseEquities.generatedAt,
  count: nseEquities.count,
};

function symbolHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

const curatedBySymbol = new Map(CURATED_EQUITIES.map((e) => [e.symbol, e]));
/** Market cap in crore rupees from `scripts/fetch-market-caps.mjs`; fresher than the curated approximations, absent for very new listings. */
const capsBySymbol = marketCaps.caps as Record<string, number>;
export const MARKET_CAP_INFO = { generatedAt: marketCaps.generatedAt, count: marketCaps.count };

export const EQUITIES: SeedInstrument[] = (nseEquities.equities as NseEquityRecord[]).map((record) => {
  const curated = curatedBySymbol.get(record.symbol);
  const base: SeedInstrument = curated ?? {
    symbol: record.symbol,
    name: record.name,
    exchange: "NSE",
    kind: "EQUITY",
    // Simulator-only seeds; never shown as market data.
    seedPrice: 50 + (symbolHash(record.symbol) % 2000),
    volatility: 0.35,
    avgVolume: 500_000,
  };
  return {
    ...base,
    marketCapCr: capsBySymbol[record.symbol] ?? curated?.marketCapCr,
    sector: curated?.sector ?? record.industry ?? undefined,
    series: record.series ?? "EQ",
    isin: record.isin ?? undefined,
    listedOn: record.listedOn ?? undefined,
  };
});

export const UNIVERSE: SeedInstrument[] = [...INDICES, ...EQUITIES];

const BY_SYMBOL = new Map(UNIVERSE.map((i) => [i.symbol, i]));

export function getInstrument(symbol: string): SeedInstrument | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

export function isKnownSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.toUpperCase());
}

export function searchInstruments(query: string, limit = 8): SeedInstrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return UNIVERSE.filter(
    (i) =>
      i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
  )
    .sort((a, b) => {
      const aExact = a.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      const bExact = b.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}
