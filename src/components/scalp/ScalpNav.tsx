import Link from "next/link";

const TABS = [
  { key: "desk", href: "/scalp", label: "Live desk" },
  { key: "backtest", href: "/scalp/backtest", label: "Setup backtests" },
  { key: "paper", href: "/scalp/paper", label: "Paper straddle" },
  { key: "index-paper", href: "/scalp/index-paper", label: "Index paper desk" },
] as const;

export type ScalpTab = (typeof TABS)[number]["key"];

/**
 * One slim bar for the four Scalp pages: the app's name (back to Today) and the four tools as tabs, so no page needs its own
 * row of "back" links. The desk stays dark on purpose: it is a charting terminal, used for long stretches.
 */
export function ScalpNav({ current }: { current: ScalpTab }) {
  return (
    <nav aria-label="Scalp desk pages" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-[#0b1220] px-3 py-2">
      <Link href="/" title="Back to Today" className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-800/60 focus-visible:outline-2 focus-visible:outline-[#5fd49a]">
        <span className="flex h-7 w-7 rotate-[-12deg] items-center justify-center rounded-lg bg-[#f0c14b] text-xs font-black text-[#0b1a34]">╱</span>
        <span className="text-sm font-extrabold tracking-[-0.02em] text-white">Traders <span className="text-[#f0c14b]">Adda</span></span>
      </Link>
      <span className="hidden h-5 w-px bg-slate-700 sm:block" aria-hidden />
      <ul className="flex min-w-0 flex-wrap gap-1">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.key === current ? "page" : undefined}
              className={`block rounded-lg px-3 py-1.5 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-[#5fd49a] ${
                tab.key === current ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/" className="ml-auto shrink-0 text-xs font-bold text-slate-400 hover:text-white">← Today</Link>
    </nav>
  );
}
