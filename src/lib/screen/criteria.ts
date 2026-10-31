/**
 * Screen criteria, ported from the BananaPatterns client bundle.
 *
 * The site evaluates a stock against a screen by checking each factor band in
 * `HOUSE_PRESETS`. A band is only enforced when it is narrower than the factor's
 * full range, which is why a preset can list a bound like `vs200: [0, 400]` and
 * still behave as a simple "must be above the 200-MA" rule.
 */

export type ScreenName = "VCP" | "Blue sky" | "Multi-year breakouts" | "IPO base";

export const SCREEN_NAMES: ScreenName[] = [
  "Multi-year breakouts",
  "Blue sky",
  "VCP",
  "IPO base",
];

/** Short tag shown on a row when it matches the screen. */
export const SCREEN_BADGES: Record<ScreenName, string> = {
  VCP: "VCP",
  "Blue sky": "blue sky",
  "Multi-year breakouts": "multi-year",
  "IPO base": "IPO",
};

export type FactorKey =
  | "rs"
  | "vs50"
  | "vs200"
  | "nearHigh"
  | "aboveLow"
  | "turn"
  | "mcap"
  | "baseWk"
  | "baseDepth"
  | "coil"
  | "dry"
  | "listedWk"
  | "lvl"
  | "ext";

export interface FactorDef {
  k: FactorKey;
  label: string;
  /** Inclusive full range of the dial; a band equal to this is a no-op. */
  lo: number;
  hi: number;
}

/** The dial ranges, matching `SCR_FACTORS` in the source bundle. */
export const FACTORS: Record<FactorKey, FactorDef> = {
  rs: { k: "rs", label: "RS rating", lo: 1, hi: 99 },
  vs50: { k: "vs50", label: "Price vs 50-MA", lo: -60, hi: 200 },
  vs200: { k: "vs200", label: "Price vs 200-MA", lo: -80, hi: 400 },
  nearHigh: { k: "nearHigh", label: "From 52-week high", lo: 0, hi: 100 },
  aboveLow: { k: "aboveLow", label: "Above 52-week low", lo: 1, hi: 700 },
  turn: { k: "turn", label: "Median turnover", lo: 0.1, hi: 1300 },
  mcap: { k: "mcap", label: "Market cap", lo: 1, hi: 600000 },
  baseWk: { k: "baseWk", label: "Base age", lo: 2, hi: 300 },
  baseDepth: { k: "baseDepth", label: "Base max depth", lo: 2, hi: 90 },
  coil: { k: "coil", label: "Tightening (ATR ratio)", lo: 0.3, hi: 3 },
  dry: { k: "dry", label: "Volume dry-up", lo: 0.05, hi: 5 },
  listedWk: { k: "listedWk", label: "Listing age", lo: 2, hi: 1300 },
  lvl: { k: "lvl", label: "Structure level", lo: 1, hi: 4 },
  ext: { k: "ext", label: "Now vs pivot (%)", lo: -100, hi: 100 },
};

export type ScreenSpec = Partial<Record<FactorKey, [number, number]>>;

/** `HOUSE_PRESETS` verbatim from the bundle. */
export const HOUSE_PRESETS: Record<ScreenName, ScreenSpec> = {
  VCP: {
    coil: [0.3, 0.9],
    dry: [0.05, 0.9],
    baseWk: [3, 300],
    baseDepth: [2, 35],
    vs50: [0, 200],
    vs200: [0, 400],
    nearHigh: [0, 30],
    aboveLow: [15, 700],
    rs: [70, 99],
  },
  "Blue sky": {
    lvl: [1, 1],
    rs: [70, 99],
    ext: [-20, 0],
  },
  "Multi-year breakouts": {
    baseWk: [52, 300],
    ext: [-20, 0],
    vs200: [0, 400],
    rs: [60, 99],
  },
  "IPO base": {
    listedWk: [2, 50],
    baseWk: [3, 300],
    baseDepth: [2, 35],
    vs50: [0, 200],
    ext: [-20, 0],
  },
};

/**
 * The per-stock inputs a screen reads. Every field is nullable because a stock
 * without enough history cannot be judged, and the source treats a missing
 * value inside an enforced band as a failure.
 */
export interface FactorValues {
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  /** Percent below the 52-week high, as a positive number. */
  fromHigh: number | null;
  aboveLow: number | null;
  turn: number | null;
  mcap: number | null;
  baseWk: number | null;
  baseDepth: number | null;
  coil: number | null;
  dry: number | null;
  listedWk: number | null;
  level: number | null;
  /** Percent above (positive) or below (negative) the pivot. */
  ext: number | null;
}

function factorValue(key: FactorKey, v: FactorValues): number | null {
  switch (key) {
    // The dial counts distance below the high, so the stored offset is read as
    // a positive "how far from the high" number.
    case "nearHigh":
      return v.fromHigh == null ? null : Math.abs(v.fromHigh);
    case "lvl":
      return v.level;
    default:
      return v[key];
  }
}

/** Mirrors `scrMatch`: a band only filters where it narrows the full dial. */
export function matchesScreen(values: FactorValues, spec: ScreenSpec): boolean {
  for (const key of Object.keys(spec) as FactorKey[]) {
    const band = spec[key];
    if (!band) continue;
    const def = FACTORS[key];
    const [mn, mx] = band;
    if (mn <= def.lo && mx >= def.hi) continue;

    const value = factorValue(key, values);
    if (value == null) return false;
    if (mn > def.lo && value < mn) return false;
    if (mx < def.hi && value > mx) return false;
  }
  return true;
}

export function matchesScreenName(values: FactorValues, screen: ScreenName): boolean {
  return matchesScreen(values, HOUSE_PRESETS[screen]);
}

/** Every screen a stock currently qualifies for, in preset order. */
export function screenBadges(values: FactorValues): string[] {
  return SCREEN_NAMES.filter((name) => matchesScreenName(values, name)).map(
    (name) => SCREEN_BADGES[name],
  );
}
