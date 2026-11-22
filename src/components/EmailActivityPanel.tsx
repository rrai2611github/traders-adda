"use client";

import { useEffect, useState } from "react";
import type { EmailActivityEntry, EmailActivityStatus } from "@/lib/alerts/emailActivity";
import type { EmailScheduleStatus } from "@/lib/alerts/emailActivityStatus";

interface Activity {
  checkedAt: number;
  entries: EmailActivityEntry[];
  schedules: EmailScheduleStatus[];
  calendarWarning: string | null;
}

const STATUS: Record<EmailActivityStatus, { label: string; tone: string }> = {
  accepted: { label: "Provider accepted", tone: "bg-emerald-50 text-emerald-800" },
  partial: { label: "Partially accepted", tone: "bg-amber-50 text-amber-900" },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-800" },
  skipped: { label: "Skipped", tone: "bg-slate-100 text-slate-600" },
};
const SOURCE = { hourly: "Hourly", "pre-open": "Pre-open", owner: "Owner alert", other: "Other email" };
const SCHEDULE = { paused: "Paused", waiting: "Waiting", accepted: "Provider accepted", eligible: "Eligible", "retry-pending": "Retry pending" };
const timestamp = (at: number) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function EmailActivityPanel() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<EmailActivityStatus | "all">("all");
  useEffect(() => {
    let active = true;
    let loading = false;
    const controller = new AbortController();
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/alerts/activity", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Email activity could not be loaded. Try refreshing.");
        const body: Activity = await response.json();
        if (active) { setData(body); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Email activity could not be loaded.");
      } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const entries = (data?.entries ?? []).filter((entry) => filter === "all" || entry.status === filter);
  return (
    <section id="email-activity" aria-labelledby="email-activity-title" className="scroll-mt-20 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Notification monitor</p>
          <h2 id="email-activity-title" className="mt-1 text-base font-extrabold text-slate-900">Email Activity</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Provider acceptance is not proof of inbox delivery. History starts when activity logging is enabled.</p>
        </div>
        <button type="button" onClick={() => setRefresh((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh activity</button>
      </header>
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}{data ? " Showing the last loaded data." : ""}</p>}
        {!data && !error && <p role="status" className="text-xs text-slate-500">Loading email activity...</p>}
        {data?.calendarWarning && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{data.calendarWarning}</p>}
        {data && <>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.schedules.map((schedule) => <div key={schedule.source} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-900">{schedule.label}</h3>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${schedule.status === "retry-pending" ? "bg-amber-100 text-amber-900" : "bg-white text-slate-600"}`}>{SCHEDULE[schedule.status]}</span>
              </div>
              <p className="mt-2 break-words text-xs leading-5 text-slate-600">{schedule.detail}</p>
            </div>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 font-semibold text-slate-600">Show
              <select aria-label="Filter email activity" value={filter} onChange={(event) => setFilter(event.target.value as EmailActivityStatus | "all")} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                <option value="all">All activity</option>
                {Object.entries(STATUS).map(([key, status]) => <option key={key} value={key}>{status.label}</option>)}
              </select>
            </label>
            <span className="text-slate-500">Checked {timestamp(data.checkedAt)} IST · refreshes every 30s</span>
          </div>
          {entries.length === 0
            ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">{data.entries.length ? "No activity matches this filter." : "No recorded email activity yet. Earlier emails are not backfilled."}</p>
            : <ul className="divide-y divide-slate-100">
              {entries.slice(0, 50).map((entry) => <li key={entry.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
                  <span className={`rounded-full px-2 py-1 ${STATUS[entry.status].tone}`}>{STATUS[entry.status].label}</span>
                  <span className="text-slate-500">{SOURCE[entry.source]}{entry.test ? " · TEST" : ""}</span>
                  <time dateTime={new Date(entry.at).toISOString()} className="ml-auto font-normal text-slate-500">{timestamp(entry.at)} IST</time>
                </div>
                <p className="mt-1.5 break-words text-xs font-bold text-slate-800">{entry.subject}</p>
                <p className="mt-1 break-words text-xs leading-5 text-slate-500">{entry.detail}</p>
              </li>)}
            </ul>}
          <p className="text-[10px] leading-5 text-slate-500">Showing up to 50 matching events from the latest 200 stored locally. Holiday and disabled-scheduler skips are recorded once per day per reason. Owner alerts are event-driven; retry eligibility depends on the signal and its check window.</p>
        </>}
      </div>
    </section>
  );
}
