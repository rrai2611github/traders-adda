"use client";

import { useEffect, useState } from "react";

interface AuditEvent {
  id: string;
  actor_email: string;
  target_email: string;
  action: "role_changed" | "account_disabled" | "account_enabled";
  details: Record<string, string | boolean>;
  created_at: string;
}

interface AuditResponse {
  events: AuditEvent[];
  error?: string;
}

function actionSummary(event: AuditEvent) {
  if (event.action === "role_changed") return `Role changed from ${event.details.from} to ${event.details.to}`;
  if (event.action === "account_disabled") return "Account access disabled";
  return "Account access restored";
}

export function AdminAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => setRefreshKey((key) => key + 1);
    const load = async () => {
      try {
        const response = await fetch("/api/admin/audit-log?limit=30", { cache: "no-store" });
        const result = await response.json() as AuditResponse;
        if (!response.ok) throw new Error(result.error ?? `Could not load admin activity (${response.status}).`);
        if (active) {
          setEvents(result.events);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load admin activity.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    window.addEventListener("admin-audit-updated", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("admin-audit-updated", refresh);
    };
  }, [refreshKey]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-black text-slate-900">Admin activity</h2>
          <p className="mt-1 text-xs text-slate-500">Recent role and account-access changes, with the administrator who made them.</p>
        </div>
        <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">
          Refresh
        </button>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      {loading ? (
        <p className="px-5 py-6 text-sm text-slate-500">Loading admin activity…</p>
      ) : events.length ? (
        <div className="divide-y divide-slate-100">
          {events.map((event) => (
            <div key={event.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
              <div>
                <p className="text-sm font-bold text-slate-800">{actionSummary(event)}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {event.target_email} · by {event.actor_email}
                </p>
              </div>
              <time className="text-xs text-slate-500">
                {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(event.created_at))} IST
              </time>
            </div>
          ))}
        </div>
      ) : !error ? (
        <p className="px-5 py-6 text-sm text-slate-500">No admin account changes have been recorded yet.</p>
      ) : null}
      <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">Showing the latest 30 events. Audit entries are stored in the account database.</p>
    </section>
  );
}
