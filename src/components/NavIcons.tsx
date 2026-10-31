import type { ReactNode } from "react";

export type NavIconName =
  | "today"
  | "setups"
  | "signals"
  | "rsi"
  | "triggers"
  | "breakouts"
  | "breadth"
  | "rotation"
  | "sectors"
  | "heatmap"
  | "watchlist"
  | "about"
  | "chevron-left"
  | "chevron-down"
  | "search"
  | "sun"
  | "moon"
  | "auto-theme"
  | "clock"
  | "link"
  | "check"
  | "picks"
  | "journal";

const PATHS: Record<NavIconName, ReactNode> = {
  today: (<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  setups: (<><path d="M3 17l5-5 4 3 8-9" /><path d="M15 6h5v5" /></>),
  signals: (<path d="M2 12h3l3-7 4 14 3-9 2 2h5" />),
  rsi: (<><path d="M4 15a8 8 0 0 1 16 0" /><path d="M12 15l4-5" /><circle cx="12" cy="15" r="1.2" /><path d="M4 19h16" /></>),
  triggers: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>),
  breakouts: (<><path d="M4 20h16" /><path d="M4 14h8" strokeDasharray="2 2" /><path d="M6 17l4-6 3 2 6-8" /></>),
  breadth: (<><path d="M5 20V10M10 20V4M15 20v-7M20 20v-4" /></>),
  rotation: (<><path d="M20 12a8 8 0 0 1-14 5.3" /><path d="M4 12A8 8 0 0 1 18 6.7" /><path d="M18 3v4h-4M6 21v-4h4" /></>),
  sectors: (<><path d="M12 3v9l7.5 4.5" /><circle cx="12" cy="12" r="9" /></>),
  heatmap: (<><rect x="3" y="3" width="10" height="10" rx="1.5" /><rect x="15" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="11" width="6" height="10" rx="1.5" /><rect x="3" y="15" width="10" height="6" rx="1.5" /></>),
  watchlist: (<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />),
  about: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>),
  "chevron-left": (<path d="M15 5l-7 7 7 7" />),
  "chevron-down": (<path d="M6 9l6 6 6-6" />),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: (<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />),
  "auto-theme": (<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  link: (<><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>),
  check: (<path d="m5 12.5 4.5 4.5L19 7.5" />),
  picks: (<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14M14.5 9.5H17M14.5 15.5H17" /></>),
  journal: (<><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" /><path d="M4 7h4" /><path d="M9 9h6M9 13h6M9 17h4" /></>),
};

/** Line icon drawn in currentColor, 18px by default. */
export function NavIcon({ name, size = 18, className = "" }: { name: NavIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
