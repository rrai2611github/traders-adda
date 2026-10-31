import type { BacktestResult } from "./types.ts";

/**
 * The owner's end-of-day note for the live strategy check: what the account did, what closed or was bought today, what is held and how close
 * each stock is to its exit, and what the rules would buy at the next open. Plain lines for the owner-only email.
 */
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const signedInr = (v: number) => `${v >= 0 ? "+" : "−"}${inr(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const price = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function trackerNote(result: BacktestResult, capital: number, startDate: string): { subject: string; lines: string[] } {
  const day = result.data.lastDay;
  const profit = result.markedValue - capital;
  const bench = result.equity.benchmark;
  const nifty = bench.length > 1 ? bench[bench.length - 1] / bench[0] - 1 : null;
  const closed = result.trades.filter((t) => t.exitReason !== "end");
  const closedToday = closed.filter((t) => t.exitDay === day);
  const boughtToday = [
    ...closed.filter((t) => t.entryDay === day),
    ...result.openPositions.filter((p) => p.entryDay === day).map((p) => ({ symbol: p.symbol, entryPrice: p.entryPrice })),
  ];
  const p = result.pending;
  const lines: string[] = [];
  lines.push(`Live strategy check, ${day}: account ${inr(result.markedValue)} (${signedInr(profit)}, ${signedPct((profit / capital) * 100)}) since ${startDate}${nifty != null ? `; Nifty 50 ${signedPct(nifty * 100)} over the same days` : ""}.`);
  lines.push(`Market check: ${p.breadth50 != null ? `${p.breadth50}% of stocks above their 50-day average (${p.breadthOk ? "allowed" : "below the 35% the rules need"})` : "breadth unavailable"}${p.niftyOk == null ? "" : `, Nifty 50 ${p.niftyOk ? "above" : "under"} its 200-day average`}.`);
  if (closedToday.length) lines.push(`Closed today: ${closedToday.map((t) => `${t.symbol} ${t.exitReason === "stop" ? "hit its stop" : "closed under its 50-day average"} (${t.r >= 0 ? "+" : "−"}${Math.abs(t.r).toFixed(2)}R, ${signedInr(t.pnl)})`).join("; ")}.`);
  if (boughtToday.length) lines.push(`Bought at today's open: ${boughtToday.map((t) => `${t.symbol} at ₹${price(t.entryPrice)}`).join(", ")}.`);
  if (!closedToday.length && !boughtToday.length) lines.push("No trade opened or closed today.");
  if (result.openPositions.length) {
    lines.push(`Held (${result.openPositions.length} of 10):`);
    for (const pos of result.openPositions) {
      const gain = (pos.last / (pos.spent / pos.quantity) - 1) * 100;
      const toExit = pos.exitLevel != null ? (pos.last / pos.exitLevel - 1) * 100 : null;
      lines.push(`  ${pos.symbol}: ₹${price(pos.last)} (${signedPct(gain)}), stop ₹${price(pos.stop)}${pos.exitLevel != null ? `, sell if it closes under ₹${price(pos.exitLevel)} (${toExit!.toFixed(1)}% away)${toExit! < 3 ? " ⚠ close to its exit" : ""}` : ""}`);
    }
  } else lines.push("Nothing is held.");
  if (p.signals.length) lines.push(`Next open the rules would buy: ${p.signals.map((s) => `${s.symbol} (RS ${s.rs}, about ${s.quantity} shares, stop ₹${price(s.stop)})`).join("; ")}.`);
  else lines.push(!p.breadthOk || p.niftyOk === false ? "Next open: no buys, the market check is not passed." : p.slotsFree === 0 ? "Next open: no buys, every slot is full." : "Next open: no qualifying breakout.");
  lines.push("Paper money only. Judge the rules after at least 30 closed trades; a few weeks prove nothing.");
  const flag = closedToday.length ? `${closedToday.length} closed` : boughtToday.length ? `${boughtToday.length} bought` : "no trades";
  return { subject: `Live strategy check · ${signedPct((profit / capital) * 100)} · ${result.openPositions.length} held · ${flag} · ${day}`, lines };
}
