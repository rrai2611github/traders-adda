"use client";

import { useEffect, useState } from "react";
import { macroSector } from "@/lib/industry";
import type { FundamentalsReport } from "@/lib/fundamentals/assess";

export type FundamentalsOutcome = { phase: "loading" } | { phase: "failed"; message: string } | { phase: "done"; report: FundamentalsReport };

type Settled = Exclude<FundamentalsOutcome, { phase: "loading" }>;

/** One request per stock for the whole page: the Top picks cards and the stock drawer share the answer. */
const requests = new Map<string, Promise<Settled>>();

function request(url: string): Promise<Settled> {
  let pending = requests.get(url);
  if (!pending) {
    pending = fetch(url, { cache: "no-store" })
      .then(async (res): Promise<Settled> => {
        const body = await res.json();
        return res.ok ? { phase: "done", report: body as FundamentalsReport } : { phase: "failed", message: String(body?.error ?? "Company data is not available right now.") };
      })
      .catch((): Settled => ({ phase: "failed", message: "Could not reach the server." }));
    requests.set(url, pending);
    // A failure is not remembered, so the next look tries again.
    void pending.then((outcome) => { if (outcome.phase === "failed") requests.delete(url); });
  }
  return pending;
}

/** Company health for one stock. Banks and lenders (macro sector "Financial Services") skip the debt check. */
export function useFundamentals(symbol: string, sector?: string | null): FundamentalsOutcome {
  const lender = macroSector(sector) === "Financial Services";
  const url = `/api/market/fundamentals?symbol=${encodeURIComponent(symbol)}${lender ? "&lender=1" : ""}`;
  // The answer is stored with the request it belongs to, so a different stock reads as "loading" until its own answer arrives.
  const [answer, setAnswer] = useState<{ url: string; outcome: Settled } | null>(null);
  useEffect(() => {
    let alive = true;
    void request(url).then((outcome) => { if (alive) setAnswer({ url, outcome }); });
    return () => { alive = false; };
  }, [url]);
  return answer?.url === url ? answer.outcome : { phase: "loading" };
}
