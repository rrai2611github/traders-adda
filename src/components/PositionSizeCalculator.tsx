"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { useAccountSize } from "@/hooks/useAccountSize";
import type { BuyHorizon } from "@/lib/screen/horizonSignal";
import { computePositionSize, DEFAULT_RISK_PERCENT } from "@/lib/screen/positionSize";
import type { JournalEntry } from "@/lib/screen/tradeJournal";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Turns the written "risk ≤1% of capital per trade" rule into an actual share
 * count at the exact moment a trader is deciding how much to buy, using the
 * entry/stop already shown in the plan above it. Account size is remembered
 * across stocks (localStorage) so it is entered once, not per popup.
 */
export function PositionSizeCalculator({
  entry,
  stop,
  target1,
  target2,
  symbol,
  name,
  horizon,
  source,
  onLogTrade,
}: {
  entry: number;
  stop: number;
  target1?: number;
  target2?: number;
  symbol?: string;
  name?: string;
  horizon?: BuyHorizon;
  source?: string;
  onLogTrade?: (entry: Omit<JournalEntry, "id" | "status">) => void;
}) {
  const { accountSize, setAccountSize } = useAccountSize();
  const [riskPercent, setRiskPercent] = useState(DEFAULT_RISK_PERCENT);
  const [draft, setDraft] = useState(String(accountSize));
  const [loggedKey, setLoggedKey] = useState<string | null>(null);

  const size = computePositionSize({ accountSize, entry, stop, riskPercent });
  const canLog = onLogTrade != null && symbol != null && target1 != null && target2 != null && !size.tooSmall;
  const planKey = `${symbol}-${horizon}-${entry}-${stop}`;
  const logged = loggedKey === planKey;

  const logTrade = () => {
    if (!canLog || !symbol || target1 == null || target2 == null) return;
    onLogTrade!({
      symbol,
      name: name ?? symbol,
      horizon: horizon ?? "mid",
      source: source ?? "Manual",
      entryDate: todayIso(),
      entryPrice: entry,
      stop,
      target1,
      target2,
      quantity: size.quantity,
    });
    setLoggedKey(planKey);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">Account size</span>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
            <span className="text-xs font-bold text-slate-400">₹</span>
            <input
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setAccountSize(Number(draft))}
              className="w-24 bg-transparent font-mono text-sm font-black text-slate-900 outline-none"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">Risk / trade</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            {[0.5, 1, 2].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRiskPercent(option)}
                className={`px-2.5 py-1 text-xs font-black transition ${riskPercent === option ? "bg-[#16894f] text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {option}%
              </button>
            ))}
          </div>
        </label>
        <div className="ml-auto flex items-end gap-4">
          <div>
            <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">Buy</div>
            <div className="font-mono text-lg font-black tabular-nums text-slate-900">
              {size.tooSmall ? "—" : `${size.quantity} sh`}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">Capital</div>
            <div className="font-mono text-sm font-black tabular-nums text-slate-700">₹{formatPrice(size.capitalRequired)}</div>
          </div>
          <div>
            <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">At risk</div>
            <div className="font-mono text-sm font-black tabular-nums text-slate-700">₹{formatPrice(size.riskAmount)}</div>
          </div>
          {canLog && (
            <button
              type="button"
              onClick={logTrade}
              className={`rounded-lg px-3 py-2 text-xs font-black transition ${logged ? "bg-emerald-100 text-emerald-700" : "bg-[#16894f] text-white hover:bg-[#12713f]"}`}
            >
              {logged ? "✓ Logged" : `+ Log trade (${size.quantity} sh)`}
            </button>
          )}
        </div>
      </div>
      {size.tooSmall && (
        <p className="mt-2 text-[11px] font-semibold text-amber-700">
          Account size is too small for even one share within this risk budget at this entry/stop.
        </p>
      )}
      {size.capitalCapped && (
        <p className="mt-2 text-[11px] font-semibold text-slate-500">
          Capped by available capital, not by the risk budget — the account can&rsquo;t afford the full risk-sized quantity.
        </p>
      )}
    </div>
  );
}
