import { ALERT_SCANNER_KEYS, SCANNERS, SCANNER_KEYS, type ExtraPick, type ExtraSection, type ScannerPayload, type ScannerRow } from "./chartinkScans.ts";
import type { BuyCheckKey, ScannerPlan } from "./buyReady.ts";
import { HEALTHY_BREADTH_PERCENT } from "./breadth.ts";
import { scannerBuyingStatus } from "./buyingStatus.ts";
import { longStatusKey } from "./tradeStatus.ts";
import { paBrief, type PaBrief } from "./priceActionRating.ts";

/**
 * Today's Picks: the one list to act on. It is the same list the customer
 * emails carry, built from the same sources (the curated alert scanners plus
 * the gated RPCI and Oscillator picks):
 *   1. market gate: breadth ≥ 50% or no new buys;
 *   2. only Buy ready stocks (every check passes, breadth included);
 *   3. one entry per stock, highest RS first (RS was the only score that
 *      separated winners from losers in the backtest), top 5.
 * The watch list ("Strong stocks waiting for the market") is separate and is
 * never presented as a buy: Watch stocks from every scanner that also pass
 * `WATCH_RULES`, highest RS first, at most two per sector, uncapped. Customer emails show
 * the names and triggers only. Backtest (scripts/backtest-weak-watch.mjs,
 * 2022–2026): buying this list on weak-breadth days lost −0.14R a trade
 * (+0.08R then −0.29R by half), so it stays watch-only.
 */
export const TODAYS_PICKS_LIMIT = 5;

export const WATCH_RULES = {
  minTurnoverCr: 40,
  minPa: 76,
  minRs: 75,
  maxRiskPercent: 6,
  maxPerSector: 2,
} as const;

export const EXTRA_SOURCES = [
  { key: "rpci", label: "RPCI (approx.)" },
  { key: "oscillator", label: "Oscillator buy-watch" },
] as const;

export type PickStatusKey = "buy-ready" | "watch";

export interface TodaysPick {
  symbol: string;
  name: string;
  close: number;
  changePercent: number | null;
  rs: number | null;
  score: number | null;
  /** Price Action rating: shown next to RS, never used for ranking (it showed no edge in the backtest). */
  pa: PaBrief | null;
  status: PickStatusKey;
  sector?: string | null;
  /** Every source that flagged the stock, best-plan source first. */
  sources: string[];
  /** Set-up description for RPCI/Oscillator picks. */
  note: string | null;
  plan: ScannerPlan;
}

export interface TodaysPicks {
  breadth: number | null;
  healthy: boolean;
  /** Buy ready, top `limit` by RS. Empty whenever breadth is weak. */
  picks: TodaysPick[];
  /** Every Watch stock from every scanner that passes `WATCH_RULES`, ranked by RS, at most two per sector (no count cap; emails trim to 5 themselves). */
  watch: TodaysPick[];
  buyReadyTotal: number;
  watchTotal: number;
  /** Sources that produced no Buy ready or Watch stock today. */
  quiet: string[];
}

/** Status of an RPCI/Oscillator pick; a pick from an older cache without the gate is never actionable. */
export function extraPickStatus(pick: Pick<ExtraPick, "failed">, healthy: boolean): "buy-ready" | "watch" | "extended" | "avoid" {
  if (!pick.failed) return "avoid";
  return longStatusKey([
    { key: "breadth", pass: healthy },
    ...pick.failed.map((key: BuyCheckKey) => ({ key, pass: false })),
  ]);
}

type Candidate = Omit<TodaysPick, "sources"> & { source: string };

function scannerCandidate(row: ScannerRow, source: string): Candidate | null {
  if (!row.passesFloor || !row.readiness.plan) return null;
  const key = scannerBuyingStatus(row.readiness).key;
  if (key !== "buy-ready" && key !== "watch") return null;
  return {
    symbol: row.symbol, name: row.name, close: row.close, changePercent: row.changePercent,
    rs: row.rs, score: row.score, pa: paBrief(row.paRating), status: key, sector: row.sector ?? null, note: null, plan: row.readiness.plan, source,
  };
}

/** The strict quality bar for the watch list: liquid, strong chart, market leader, tight stop. */
export function passesWatchRules(row: ScannerRow): boolean {
  const pa = row.paRating?.status === "rated" ? row.paRating.score : null;
  const plan = row.readiness.plan;
  return (row.turnoverCr ?? 0) >= WATCH_RULES.minTurnoverCr
    && pa != null && pa >= WATCH_RULES.minPa
    && (row.rs ?? 0) >= WATCH_RULES.minRs
    && plan != null && plan.riskPercent <= WATCH_RULES.maxRiskPercent;
}

function capPerSector(picks: TodaysPick[], max: number): TodaysPick[] {
  const count = new Map<string, number>();
  return picks.filter((p) => {
    if (!p.sector) return true;
    const n = count.get(p.sector) ?? 0;
    count.set(p.sector, n + 1);
    return n < max;
  });
}

function extraCandidate(pick: ExtraPick, source: string, healthy: boolean): Candidate | null {
  const key = extraPickStatus(pick, healthy);
  if (key !== "buy-ready" && key !== "watch") return null;
  return {
    symbol: pick.symbol, name: pick.name, close: pick.close, changePercent: pick.changePercent,
    rs: pick.rs, score: pick.score, pa: pick.pa ?? null, status: key, note: pick.note, plan: pick.plan, source,
  };
}

function rank(candidates: Candidate[]): TodaysPick[] {
  const bySymbol = new Map<string, TodaysPick>();
  for (const { source, ...c } of candidates) {
    const seen = bySymbol.get(c.symbol);
    if (seen) {
      if (!seen.sources.includes(source)) seen.sources.push(source);
    } else {
      bySymbol.set(c.symbol, { ...c, sources: [source] });
    }
  }
  return [...bySymbol.values()].sort((a, b) =>
    (b.rs ?? -1) - (a.rs ?? -1) || b.sources.length - a.sources.length || a.symbol.localeCompare(b.symbol));
}

export function todaysPicks(payload: ScannerPayload, limit = TODAYS_PICKS_LIMIT): TodaysPicks {
  const breadth = payload.breadth.percent;
  const healthy = breadth != null && breadth >= HEALTHY_BREADTH_PERCENT;
  const candidates: Candidate[] = [];
  const quiet: string[] = [];
  for (const key of ALERT_SCANNER_KEYS) {
    const label = SCANNERS[key].menuLabel;
    const found = (payload.results[key] ?? []).map((row) => scannerCandidate(row, label)).filter((c): c is Candidate => c != null);
    if (!found.length) quiet.push(label);
    candidates.push(...found);
  }
  for (const { key, label } of EXTRA_SOURCES) {
    const section: ExtraSection | undefined = payload.extras?.[key];
    const found = (section?.top ?? []).map((pick) => extraCandidate(pick, label, healthy)).filter((c): c is Candidate => c != null);
    if (!found.length) quiet.push(label);
    candidates.push(...found);
  }
  const ready = rank(candidates.filter((c) => c.status === "buy-ready"));
  const watchCandidates: Candidate[] = [];
  for (const key of SCANNER_KEYS) {
    const label = SCANNERS[key].menuLabel;
    for (const row of payload.results[key] ?? []) {
      if (!passesWatchRules(row)) continue;
      const c = scannerCandidate(row, label);
      if (c?.status === "watch") watchCandidates.push(c);
    }
  }
  const watch = capPerSector(rank(watchCandidates), WATCH_RULES.maxPerSector);
  return {
    breadth,
    healthy,
    picks: ready.slice(0, limit),
    watch,
    buyReadyTotal: ready.length,
    watchTotal: watch.length,
    quiet,
  };
}
