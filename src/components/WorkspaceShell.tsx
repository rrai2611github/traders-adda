import type { ReactNode } from "react";
import { NavIcon, type NavIconName } from "./NavIcons";

/** Page heading: icon tile, eyebrow, title and description on the page surface. */
export function WorkspaceHero({
  eyebrow,
  title,
  description,
  icon,
  action,
  children,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon?: NavIconName;
  action?: ReactNode;
  children?: ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={`${featured ? "workspace-hero-featured" : ""} relative border-b border-slate-200 bg-white px-6 py-5`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          {icon && (
            <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
              <NavIcon name={icon} size={19} />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">{eyebrow}</p>
            <h2 className="mt-1 text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-slate-900">{title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function WorkspaceFrame({
  id,
  children,
  className = "",
  bare = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /** No outer box: the page's own cards stand on the page background (the Today page). */
  bare?: boolean;
}) {
  return (
    <section id={id} className={`${bare ? "" : "overflow-hidden rounded-3xl border border-border bg-white shadow-sm"} ${className}`}>
      {children}
    </section>
  );
}

/** Skeleton rows with an optional progress message, shown while a data set loads. */
export function LoadingState({ message, rows = 5 }: { message?: string | null; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-5">
      {message && (
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500 pulse-dot" aria-hidden />
          {message}
        </p>
      )}
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3" aria-hidden>
          <div className="skeleton h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-2.5 w-1/3 rounded" />
            <div className="skeleton h-2 w-1/2 rounded" />
          </div>
          <div className="skeleton h-5 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

const EMPTY_TONES = {
  neutral: { icon: "◌", badge: "bg-slate-100 text-slate-400", text: "text-slate-500" },
  error: { icon: "!", badge: "bg-rose-50 text-rose-500", text: "text-rose-700" },
  search: { icon: "⌕", badge: "bg-slate-100 text-slate-400", text: "text-slate-500" },
} as const;

/** Centred message for empty results, unavailable data or searches with no match. */
export function EmptyState({
  children,
  title,
  tone = "neutral",
  action,
}: {
  children: ReactNode;
  title?: string;
  tone?: keyof typeof EMPTY_TONES;
  action?: ReactNode;
}) {
  const style = EMPTY_TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className="flex min-h-[160px] flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black ${style.badge}`} aria-hidden>{style.icon}</span>
      {title && <p className="text-sm font-black text-slate-800">{title}</p>}
      <p className={`max-w-md text-xs leading-5 ${style.text}`}>{children}</p>
      {action}
    </div>
  );
}

export function WorkspaceTabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: { key: T; icon: string; label: string; detail?: string }[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <div className="workspace-tabs flex overflow-x-auto border-b border-border bg-slate-50">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.key)}
          aria-pressed={active === item.key}
          className={`flex min-w-[160px] flex-1 items-center gap-3 border-r border-border px-4 py-3 text-left last:border-r-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
            active === item.key ? "bg-white shadow-[inset_0_-3px_0_#16894f]" : "hover:bg-white/70"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700">
            {item.icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-black text-slate-900">{item.label}</span>
            {item.detail && <span className="block truncate text-xs text-slate-500">{item.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
