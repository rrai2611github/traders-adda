export type Classification = { industry: string; subgroup: string };

// NSE-style industry / subgroup classification, keyed by ticker.
const CLASSIFICATION: Record<string, Classification> = {
  // Aerospace & Defense
  PARAS: { industry: "Aerospace & Defense", subgroup: "Aerospace & Defense" },
  DATAPATTNS: { industry: "Aerospace & Defense", subgroup: "Aerospace & Defense" },
  APOLLO: { industry: "Aerospace & Defense", subgroup: "Aerospace & Defense" },

  // Agricultural Food & other Products
  AVADHSUGAR: { industry: "Agricultural Food & other Products", subgroup: "Sugar" },
  BALRAMCHIN: { industry: "Agricultural Food & other Products", subgroup: "Sugar" },
  DALMIASUG: { industry: "Agricultural Food & other Products", subgroup: "Sugar" },

  // Industrial Manufacturing
  MACPOWER: { industry: "Industrial Manufacturing", subgroup: "Industrial Products" },
  DYNAMATECH: { industry: "Industrial Manufacturing", subgroup: "Industrial Products" },
  RAIN: { industry: "Industrial Manufacturing", subgroup: "Industrial Products" },

  // Chemicals & Petrochemicals
  YASHO: { industry: "Chemicals & Petrochemicals", subgroup: "Specialty Chemicals" },
  ACUTAAS: { industry: "Chemicals & Petrochemicals", subgroup: "Specialty Chemicals" },

  // Industrial Products
  APCOTEXIND: { industry: "Industrial Products", subgroup: "Plastic Products" },
  POLYPLEX: { industry: "Industrial Products", subgroup: "Plastic Products" },

  // Pharmaceuticals & Biotechnology
  SUVEN: { industry: "Pharmaceuticals & Biotechnology", subgroup: "Pharmaceuticals" },
  ORCHPHARMA: { industry: "Pharmaceuticals & Biotechnology", subgroup: "Pharmaceuticals" },
  WOCKPHARMA: { industry: "Pharmaceuticals & Biotechnology", subgroup: "Pharmaceuticals" },
  SMSPHARMA: { industry: "Pharmaceuticals & Biotechnology", subgroup: "Pharmaceuticals" },

  // Single-industry names in the VCP forming stage
  ASKAUTOLTD: { industry: "Auto Components", subgroup: "Auto Components & Equipments" },
  GANDHAR: { industry: "Petroleum Products", subgroup: "Refineries & Marketing" },
  AEGISLOG: { industry: "Gas", subgroup: "Trading - Gas" },
  AEGISVOPAK: { industry: "Transport Infrastructure", subgroup: "Port & Port services" },
  DECNGOLD: { industry: "Minerals & Mining", subgroup: "Industrial Minerals" },
  KTKBANK: { industry: "Banks", subgroup: "Private Sector Bank" },
  MCX: { industry: "Capital Markets", subgroup: "Exchange and Data Platform" },
  RBA: { industry: "Leisure Services", subgroup: "Restaurants" },
  NETWEB: { industry: "IT - Hardware", subgroup: "Computers Hardware & Equipments" },
  CPPLUS: { industry: "Consumer Durables", subgroup: "Consumer Electronics" },

  // Breakout / climbing / played-out names
  AIMTRON: { industry: "Industrial Manufacturing", subgroup: "Industrial Products" },
  FILATEX: { industry: "Textiles & Apparels", subgroup: "Other Textile Products" },
  ARVIND: { industry: "Textiles & Apparels", subgroup: "Other Textile Products" },
  SYRMA: { industry: "Industrial Manufacturing", subgroup: "Industrial Products" },
  CHENNPETRO: { industry: "Petroleum Products", subgroup: "Refineries & Marketing" },
  WABAG: { industry: "Other Utilities", subgroup: "Water Supply & Management" },
  EXICOM: { industry: "Electrical Equipment", subgroup: "Other Electrical Equipment" },
  DIACABS: { industry: "Electrical Equipment", subgroup: "Other Electrical Equipment" },
  TDPOWERSYS: { industry: "Electrical Equipment", subgroup: "Heavy Electrical Equipment" },
  QUADFUTURE: { industry: "Industrial Products", subgroup: "Cables - Electricals" },
  PWL: { industry: "Other Consumer Services", subgroup: "E-Learning" },
  MANINDS: { industry: "Industrial Products", subgroup: "Iron & Steel Products" },
  SMLMAH: { industry: "Automobiles", subgroup: "Commercial Vehicles" },
  LUMAXTECH: { industry: "Auto Components", subgroup: "Auto Components & Equipments" },
  CARTRADE: { industry: "Other Consumer Services", subgroup: "E-Commerce" },
  CUPID: { industry: "Healthcare Equipment & Supplies", subgroup: "Medical Equipment & Supplies" },
  ASHAPURMIN: { industry: "Minerals & Mining", subgroup: "Industrial Minerals" },
  MUFIN: { industry: "Finance", subgroup: "Non Banking Financial Company (NBFC)" },
  SRM: { industry: "Industrial Products", subgroup: "Plastic Products" },
};

export const UNCLASSIFIED = "Unclassified";

// Short labels from the hand-seeded large-cap list, mapped onto NSE's macro
// sector names so one sector never appears under two names.
const SECTOR_ALIASES: Record<string, string> = {
  Auto: "Automobile and Auto Components",
  IT: "Information Technology",
  Technology: "Information Technology",
  Financials: "Financial Services",
  Fintech: "Financial Services",
  Telecom: "Telecommunication",
  FMCG: "Fast Moving Consumer Goods",
  Sugar: "Fast Moving Consumer Goods",
  Pharma: "Healthcare",
  Energy: "Oil Gas & Consumable Fuels",
  Cement: "Construction Materials",
  Conglomerate: "Diversified",
  Metals: "Metals & Mining",
  Mining: "Metals & Mining",
  Infrastructure: "Construction",
  Defence: "Capital Goods",
  Industrials: "Capital Goods",
  "Power Electronics": "Capital Goods",
  "Water Infrastructure": "Utilities",
  Retail: "Consumer Services",
  Internet: "Consumer Services",
  Travel: "Consumer Services",
  Logistics: "Services",
};

/** NSE macro sector for a published or seeded sector label. */
export function macroSector(nseSector?: string | null): string {
  const sector = nseSector?.trim();
  if (!sector) return UNCLASSIFIED;
  return SECTOR_ALIASES[sector] ?? sector;
}

/**
 * Hand-curated industry/subgroup where known; otherwise NSE's published sector
 * for the stock (used for both levels), or "Unclassified". Never guesses.
 */
export function classifyTicker(ticker: string, nseSector?: string | null): Classification {
  const key = ticker.replace(/^NSE:/, "").toUpperCase();
  const curated = CLASSIFICATION[key];
  if (curated) return curated;
  const sector = macroSector(nseSector);
  return { industry: sector, subgroup: sector };
}