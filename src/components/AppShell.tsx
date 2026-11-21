"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HeaderClock, MarketPill, SideGroup, SideItem, SidebarClock, ThemeToggle, ToolSection } from "./ShellParts";
import { NavIcon } from "./NavIcons";
import { AccountMenu } from "./auth/AccountMenu";
import { SymbolSearch } from "./SymbolSearch";
import { Toaster } from "./Toaster";
import { useNow } from "@/hooks/useNow";
import { getMarketStatus } from "@/lib/market/marketHours";

export type ShellPage = "positions" | "backtest" | "radar" | "performance" | "assistant" | "playbook";

const TITLES: Record<ShellPage, string> = {
  positions: "Portfolio",
  backtest: "Backtest",
  radar: "Email track record",
  performance: "Results",
  assistant: "Assistant",
  playbook: "Trading playbook",
};

/**
 * The same frame the Dashboard has (navy sidebar, top bar with search, market status and the light/dark switch) for the pages that are
 * their own routes. Research opens the Dashboard hub through its existing hash. On a phone
 * the sidebar is hidden because the bottom tab bar already does that job.
 */
export function AppShell({ current, children }: { current: ShellPage; children: ReactNode }) {
  const router = useRouter();
  const now = useNow(30_000);
  const status = now == null ? null : getMarketStatus(now);
  const go = (href: string) => () => router.push(href);

  return (
    <div className="dashboard-shell flex min-h-screen min-w-0">
      <aside className="sidenav sticky top-0 flex h-screen shrink-0 flex-col max-sm:hidden">
        <div className="sidenav-divider flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
          <button type="button" onClick={go("/")} title="Traders Adda — Today" className="flex min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-[#5fd49a]">
            <span className="flex h-8 w-8 shrink-0 rotate-[-12deg] items-center justify-center rounded-[10px] bg-[#f0c14b] text-sm font-black text-[#0b1a34] shadow-[0_4px_14px_rgba(240,193,75,0.3)]">╱</span>
            <span className="sidenav-text min-w-0">
              <span className="block text-[15px] font-extrabold leading-none tracking-[-0.03em]">Traders <span className="text-[#f0c14b]">Adda</span></span>
              <span className="sidenav-muted mt-1 block text-[8.5px] font-bold uppercase tracking-[0.18em]">Market workstation</span>
            </span>
          </button>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4">
          <SideGroup label="Your workspace" collapsed={false}>
            <SideItem icon="today" label="Today" current={false} collapsed={false} onClick={go("/")} />
            <SideItem icon="journal" label="Positions & strategy" current={current === "positions"} collapsed={false} onClick={go("/positions")} />
            <SideItem icon="signals" label="Backtest (10 years)" current={current === "backtest"} collapsed={false} onClick={go("/backtest")} />
            <SideItem icon="picks" label="Email track record" current={current === "radar"} collapsed={false} onClick={go("/radar")} />
            <SideItem icon="watchlist" label="Watchlist" current={false} collapsed={false} onClick={go("/#watchlist")} />
          </SideGroup>

          <SideGroup label="Research & scanners" collapsed={false}>
            <SideItem icon="breadth" label="Market overview" current={false} collapsed={false} onClick={go("/#market")} />
            <SideItem icon="signals" label="Stock research" current={false} collapsed={false} onClick={go("/#research")} />
            <SideItem icon="search" label="Scanner directory" current={false} collapsed={false} onClick={go("/#scanner-directory")} />
            <SideItem icon="setups" label="Core Setups" current={false} collapsed={false} onClick={go("/#setups")} />
            <SideItem icon="setups" label="Monthly Setups" current={false} collapsed={false} onClick={go("/#monthly-setups")} />
            <SideItem icon="triggers" label="Trade Triggers" current={false} collapsed={false} onClick={go("/#scanner-range")} />
          </SideGroup>

          <details className="sidenav-tools">
            <summary aria-label="More tools" title="More tools" className="sidenav-item cursor-pointer">
              <NavIcon name="setups" />
              <span className="sidenav-text flex-1">More tools</span>
              <NavIcon name="chevron-down" size={14} className="sidenav-text sidenav-disclosure" />
            </summary>
            <div className="mt-2 space-y-3">
              <ToolSection label="Stock lists" collapsed={false}>
                <SideItem icon="picks" label="Older scanner picks" current={false} collapsed={false} onClick={go("/#picks")} />
                <SideItem icon="setups" label="Bottomed Out" current={false} collapsed={false} onClick={go("/#bottomed-out")} />
                <SideItem icon="setups" label="Stage 2 Bases" current={false} collapsed={false} onClick={go("/#stage-2-bases")} />
                <SideItem icon="setups" label="Stock Screener" current={false} collapsed={false} onClick={go("/#stock-screener")} />
              </ToolSection>
              <ToolSection label="Breadth & changes" collapsed={false}>
                <SideItem icon="setups" label="Sector Stage 2" current={false} collapsed={false} onClick={go("/#sector-stage-2")} />
                <SideItem icon="setups" label="Daily Changes" current={false} collapsed={false} onClick={go("/#daily-changes")} />
                <SideItem icon="setups" label="Setup Lab" current={false} collapsed={false} onClick={go("/#setup-lab")} />
              </ToolSection>
              <ToolSection label="Signals" collapsed={false}>
                <SideItem icon="rsi" label="RSI Edge Scanners" current={false} collapsed={false} onClick={go("/#rsi-edge")} />
                <SideItem icon="signals" label="RPCI & Oscillators" current={false} collapsed={false} onClick={go("/#signals")} />
              </ToolSection>
              <ToolSection label="Practice" collapsed={false}>
                <SideItem icon="journal" label="Paper trades & journal" current={false} collapsed={false} onClick={go("/#journal")} />
                <SideItem icon="triggers" label="Index Scalp Desk" current={false} collapsed={false} onClick={go("/scalp")} />
              </ToolSection>
            </div>
          </details>

          <SideGroup label="Learn" collapsed={false}>
            <SideItem icon="about" label="Trading playbook" current={current === "playbook"} collapsed={false} onClick={go("/playbook")} />
            <SideItem icon="about" label="About & risk" current={false} collapsed={false} onClick={go("/#about")} />
          </SideGroup>
        </nav>

        <div className="sidenav-footer sidenav-divider flex h-11 shrink-0 items-center gap-2 border-t px-4 text-[11px] font-extrabold uppercase tracking-[0.1em]">
          <span className={`h-1.5 w-1.5 rounded-full ${status?.isLive ? "bg-[#5fd49a] pulse-dot" : "bg-[#6b7280]"}`} />
          <span className="sidenav-muted truncate">{status?.label ?? "Connecting"}</span>
          <SidebarClock />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="dashboard-header sticky top-0 z-30 flex min-h-[64px] flex-wrap items-center gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-xl lg:px-6">
          <span className="shrink-0 text-[15px] font-extrabold tracking-[-0.01em] text-slate-900">{TITLES[current]}</span>
          <MarketPill status={status} />
          <HeaderClock />
          <div className="dashboard-search ml-auto min-w-0 max-w-[420px] flex-1 [&>div]:w-full [&_input]:h-9 [&_input]:rounded-xl [&_input]:border-slate-200 [&_input]:bg-slate-50 [&_input]:px-3.5 [&_input]:text-[13px] [&_input]:transition [&_input]:focus:bg-white">
            <SymbolSearch onSelect={(symbol) => router.push(`/?stock=${encodeURIComponent(symbol)}`)} existing={[]} />
          </div>
          <ThemeToggle />
          <AccountMenu />
        </header>
        {(current === "backtest" || current === "radar") && (
          <nav aria-label="Results tools" className="flex flex-wrap gap-3 border-b border-border px-4 py-3 text-sm font-bold lg:px-6">
            <Link href="/performance" className="px-3 py-2 text-emerald-700">Back to Results</Link>
            <Link href="/backtest" aria-current={current === "backtest" ? "page" : undefined} className="px-3 py-2 text-emerald-700">Historical backtest</Link>
            <Link href="/radar" aria-current={current === "radar" ? "page" : undefined} className="px-3 py-2 text-emerald-700">Email track record</Link>
          </nav>
        )}
        {children}
        <Toaster />
      </main>
    </div>
  );
}
