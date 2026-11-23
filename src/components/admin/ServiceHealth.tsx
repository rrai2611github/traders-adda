"use client";

import { useEffect, useState } from "react";

interface ServiceHealthResponse {
  checkedAt: string;
  database: { status: "ok" | "failed"; message: string };
  priceData: {
    status: "ok" | "stale";
    latestSession: string | null;
    expectedSession: string;
    message: string;
    refreshStatus: "idle" | "running" | "failed";
    refreshMessage: string;
    lastRefreshAt: string | null;
    initialized: boolean;
  };
  error?: string;
}

function statusStyle(ok: boolean) {
  return ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800";
}

export function ServiceHealth() {
  const [health, setHealth] = useState<ServiceHealthResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/service-health", { cache: "no-store" });
        const result = await response.json() as ServiceHealthResponse;
        if (!response.ok) throw new Error(result.error ?? `Could not check service health (${response.status}).`);
        if (active) {
          setHealth(result);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not check service health.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshKey]);

  const checkedAt = health ? new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(health.checkedAt)) : null;

  return (
    <section aria-label="Service health" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-slate-900">Service health</h2>
          <p className="mt-1 text-xs text-slate-500">Database connectivity and the shared historical price-data status.</p>
        </div>
        <button type="button" onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">
          Check now
        </button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      {loading && !health ? (
        <p className="mt-4 text-sm text-slate-500">Checking service health…</p>
      ) : health && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">Database</p>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusStyle(health.database.status === "ok")}`}>
                {health.database.status === "ok" ? "Connected" : "Unavailable"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{health.database.message}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">Historical price data</p>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusStyle(health.priceData.status === "ok" && health.priceData.initialized)}`}>
                {health.priceData.status === "ok" && health.priceData.initialized ? "Current" : "Needs attention"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{health.priceData.message}</p>
            <p className="mt-1 text-xs text-slate-500">
              Latest session: {health.priceData.latestSession ?? "not available"} · expected: {health.priceData.expectedSession}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Refresh: {health.priceData.refreshStatus}{health.priceData.lastRefreshAt ? ` · last run ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(health.priceData.lastRefreshAt))}` : ""}
            </p>
            {health.priceData.refreshStatus === "failed" && health.priceData.refreshMessage && (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{health.priceData.refreshMessage}</p>
            )}
          </div>
        </div>
      )}
      {checkedAt && <p className="mt-3 text-[11px] text-slate-400">Last checked {checkedAt} IST · refreshes automatically every minute.</p>}
    </section>
  );
}
