"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ScreenScan } from "@/hooks/useScreenScan";
import { useSavedScans } from "@/hooks/useSavedScans";
import { matchesScreener } from "@/lib/screen/stockScreener";

export function SavedScanMatchesCard({ scan, scanError }: { scan: ScreenScan | null; scanError: boolean }) {
  const { saved, savedLoading, savedError } = useSavedScans();
  const rows = scan?.rows;
  const matches = useMemo(
    () => saved.map((item) => ({
      name: item.name,
      symbols: (rows ?? []).filter((row) => matchesScreener(row, item.filter)).map((row) => row.symbol),
    })).filter((item) => item.symbols.length > 0),
    [rows, saved],
  );
  const matchCount = matches.reduce((count, item) => count + item.symbols.length, 0);

  return (
    <section aria-label="Saved scan matches" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-emerald-950">Saved scan matches</h2>
          <p className="mt-1 text-xs text-emerald-800">
            {!savedLoading && saved.length > 0 && `${matchCount} matches across ${saved.length} saved ${saved.length === 1 ? "scan" : "scans"}`}
            {scan && ` · ${scan.source.label} · ${new Date(scan.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`}
          </p>
        </div>
        <Link href="/#stock-screener" className="shrink-0 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50">
          Manage scans
        </Link>
      </div>
      {savedError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{savedError}</p>}
      {scanError && scan && <p role="status" className="mt-2 text-xs font-semibold text-amber-800">Scan refresh failed; these matches use the last available snapshot.</p>}
      {scanError && !scan && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">Market scan is unavailable, so matches cannot be checked yet.</p>}
      {savedLoading ? <p className="mt-2 text-xs text-emerald-900">Loading your saved criteria…</p>
        : !saved.length ? <p className="mt-2 text-xs text-emerald-900">Save filters in Stock Screener to see matching stocks here.</p>
          : !scan ? <p className="mt-2 text-xs text-emerald-900">Waiting for the market scan to load.</p>
            : !matches.length ? <p className="mt-2 text-xs text-emerald-900">No saved scans match this snapshot.</p>
              : <ul className="mt-2 space-y-1.5">
                {matches.map((item) => (
                  <li key={item.name} className="text-xs text-emerald-950">
                    <b>{item.name}</b> · {item.symbols.length} {item.symbols.length === 1 ? "match" : "matches"}: {item.symbols.slice(0, 5).join(", ")}{item.symbols.length > 5 ? `, +${item.symbols.length - 5} more` : ""}
                  </li>
                ))}
              </ul>}
      <p className="mt-2 text-[11px] text-emerald-800">Current screening matches are informational, not buy recommendations.</p>
    </section>
  );
}
