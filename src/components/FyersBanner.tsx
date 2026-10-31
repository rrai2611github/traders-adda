"use client";

import { useEffect, useState } from "react";

interface FyersStatus {
  configured: boolean;
  connected: boolean;
  feed?: { fyersQuotes: number; freshestQuoteAgeMs: number | null; lastError: string | null };
}

/** Shown on trading-day mornings and through the session while today's Fyers login is missing. */
const inWindow = () => {
  const ist = new Date(Date.now() + 19_800_000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 8 * 60 + 30 && minutes <= 15 * 60 + 40;
};

export function FyersBanner() {
  const [status, setStatus] = useState<FyersStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/fyers/status", { cache: "no-store" });
        if (response.ok && alive) setStatus((await response.json()) as FyersStatus);
      } catch {
        // The banner is advisory; a failed check just leaves it hidden.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!status?.configured || !inWindow()) return null;
  if (status.connected) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span><b>Fyers is not connected today.</b> Prices are coming from Yahoo (about a minute behind) and paper trades use that feed. Log in once for live quotes.</span>
      <a href="/api/fyers/login" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-black text-white hover:bg-amber-700">Connect Fyers</a>
    </div>
  );
}
