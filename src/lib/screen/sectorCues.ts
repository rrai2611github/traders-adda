export interface CueMove {
  label: string;
  changePercent: number;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/**
 * Overseas moves that tend to carry into particular Indian sectors, even though they do not move the Nifty as a whole.
 * Based on 10 years of daily data: on days crude moved more than 1.5%, ONGC averaged about +0.7% / −0.7% and oil marketing companies,
 * paints and airlines the opposite (smaller); Nasdaq moves carry into IT stocks; gold into Muthoot Finance. Only clear moves are listed.
 */
export function sectorCues(cues: ReadonlyArray<CueMove>): string[] {
  const move = (label: string) => cues.find((c) => c.label === label && Number.isFinite(c.changePercent))?.changePercent ?? null;
  const out: string[] = [];
  const brent = move("Brent crude");
  if (brent != null && Math.abs(brent) >= 1.5) {
    out.push(brent > 0
      ? `Crude ${signed(brent)}: ONGC and Oil India usually rise; oil marketing companies (HPCL, BPCL), paints and airlines come under mild pressure.`
      : `Crude ${signed(brent)}: ONGC and Oil India usually fall; oil marketing companies (HPCL, BPCL), paints and airlines get mild relief.`);
  }
  const nasdaq = move("Nasdaq");
  if (nasdaq != null && Math.abs(nasdaq) >= 1) {
    out.push(`Nasdaq ${signed(nasdaq)}: IT stocks (TCS, Infosys, HCLTech, Wipro, Tech Mahindra) usually follow in the same direction.`);
  }
  const gold = move("Gold");
  if (gold != null && Math.abs(gold) >= 1.5) {
    out.push(`Gold ${signed(gold)}: gold-loan lender Muthoot Finance usually follows; jewellers like Titan react little.`);
  }
  return out;
}
