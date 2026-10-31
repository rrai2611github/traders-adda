import Link from "next/link";

const PAGES = [
  { key: "today", href: "/", label: "Today" },
  { key: "positions", href: "/positions", label: "My positions" },
  { key: "tracker", href: "/tracker", label: "Live strategy check" },
  { key: "backtest", href: "/backtest", label: "Backtest" },
] as const;

export type PageKey = (typeof PAGES)[number]["key"];

/** The four pages you use every week, one tap apart, on the pages that have no sidebar. */
export function PageNav({ current }: { current: PageKey }) {
  return (
    <nav aria-label="Main pages" className="flex flex-wrap gap-1.5">
      {PAGES.map((page) => (
        <Link
          key={page.key}
          href={page.href}
          aria-current={page.key === current ? "page" : undefined}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${page.key === current ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"}`}
        >
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
