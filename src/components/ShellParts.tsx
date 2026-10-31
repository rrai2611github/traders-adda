"use client";

import type { ReactNode } from "react";
import { NavIcon, type NavIconName } from "./NavIcons";
import { useTheme } from "@/hooks/useTheme";
import { useNow } from "@/hooks/useNow";
import type { MarketStatus } from "@/lib/market/types";

/** Pieces shared by the Dashboard and the standalone pages (positions, live check, backtest, email track record). */

const IST_CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-base text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
    >
      <NavIcon name={dark ? "sun" : "moon"} size={17} />
    </button>
  );
}


export function istClock(now: number | null): string {
  return now == null ? "--:--" : IST_CLOCK.format(now);
}

/** Compact market-phase pill for the top bar. */
export function MarketPill({ status }: { status: MarketStatus | null }) {
  const live = status?.isLive ?? false;
  return (
    <span
      title={status?.label ?? "Connecting"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500 pulse-dot" : "bg-slate-400"}`} />
      <span className="hidden lg:inline">{status?.label ?? "Connecting"}</span>
    </span>
  );
}

export function HeaderClock() {
  const now = useNow(1000);
  return (
    <span className="hidden shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] font-bold text-slate-500 xl:inline-flex">
      <NavIcon name="clock" size={13} />
      {istClock(now)} IST
    </span>
  );
}

export function SidebarClock() {
  const now = useNow(1000);
  return <span className="sidenav-muted ml-auto font-mono tracking-normal">{istClock(now)}</span>;
}


export function SideItem({
  icon,
  label,
  current,
  collapsed,
  onClick,
  trailing,
  expanded,
}: {
  icon: NavIconName;
  label: string;
  current: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={`sidenav-item ${collapsed ? "justify-center" : ""}`}
    >
      <NavIcon name={icon} />
      {!collapsed && <span className="sidenav-text min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && trailing && <span className="sidenav-text">{trailing}</span>}
    </button>
  );
}

export function SideGroup({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div>
      {collapsed ? <div className="sidenav-divider mx-3 mb-2 border-t" /> : <div className="sidenav-label">{label}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** A small heading inside "Research & older tools" so its twelve items read as four short groups. */
export function ToolSection({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      {!collapsed && <div className="sidenav-sublabel">{label}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

