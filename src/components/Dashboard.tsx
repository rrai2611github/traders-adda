"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BreakoutsRecordSection } from "./BreakoutsRecordSection";
import { IndexStrip } from "./IndexStrip";
import { LivePatternSection } from "./LivePatternSection";
import { RpciApproxSection } from "./RpciApproxSection";
import { MomentumOscillatorSection } from "./MomentumOscillatorSection";
import { ChartinkScannerSection } from "./ChartinkScannerSection";
import { RsiEdgeScannerSection } from "./RsiEdgeScannerSection";
import { useScannerResults } from "@/hooks/useScannerResults";
import { useRsiEdgeResults } from "@/hooks/useRsiEdgeResults";
import { useIndexQuotes } from "@/hooks/useIndexQuotes";
import {
  SCANNERS,
  SCANNER_NAV_GROUPS,
  type ScannerKey,
  type ScannerMode,
} from "@/lib/screen/chartinkScans";
import type { RsiEdgeScanKey } from "@/lib/screen/rsiEdgeSource";
import { MarketStatusBar } from "./MarketStatusBar";
import { EDGE_TAG, scannerEdge, scannerEdgeSentence, sortByEdge } from "@/lib/screen/scannerEdge";
import { FyersBanner } from "./FyersBanner";
import { MarketStrip } from "./MarketStrip";
import { SymbolSearch } from "./SymbolSearch";
import { WatchlistPanel } from "./WatchlistPanel";
import { useIntradaySeries } from "@/hooks/useIntradaySeries";
import { useScreenScan } from "@/hooks/useScreenScan";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useUniverse } from "@/hooks/useUniverse";
import { useTheme } from "@/hooks/useTheme";
import { universePredicate, universeSize } from "@/lib/market/indexUniverses";
import { filterRsiEdge, filterScan, filterScanners, UNIVERSE_OPTIONS, type UniverseKey } from "@/lib/screen/universeFilter";
import type { ScreenScan } from "@/hooks/useScreenScan";
import { toneClass } from "@/lib/format";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { groupScanBySector as groupSectors, MIN_SECTOR_MEMBERS as SHARED_MIN_SECTOR_MEMBERS } from "@/lib/screen/commandCenter";
import { NIFTY50_SYMBOLS } from "@/lib/market/defaults";
import { GlossaryList } from "./Term";
import { WorkspaceFrame, WorkspaceHero, WorkspaceTabs } from "./WorkspaceShell";
import { StockDetailProvider } from "./StockDetailContext";
import { StockDetailDrawer } from "./StockDetailDrawer";
import { CommandCenter, type CommandCenterTarget } from "./CommandCenter";
import { MonthlySetups } from "./MonthlySetups";
import { BottomedOutScreener } from "./BottomedOutScreener";
import { TodaysPicks } from "./TodaysPicks";
import { TradeJournal } from "./TradeJournal";
import { useTradeJournal } from "@/hooks/useTradeJournal";
import { PaperTrading } from "./PaperTrading";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { SectorHeatmap } from "./SectorHeatmap";
import { NavIcon, type NavIconName } from "./NavIcons";
import { useNow } from "@/hooks/useNow";
import type { MarketStatus } from "@/lib/market/types";
import { parseRoute, routeHash, routeUrl, type ActiveNavKey, type MarketMenuKey } from "@/lib/appRoute";
import type { DashboardMetric } from "@/lib/screen/dashboardMetrics";
import type { BuyHorizon } from "@/lib/screen/horizonSignal";

const USER_NAME = "Rupesh Rai";

const PAGE_TITLES: Record<ActiveNavKey, string> = {
  today: "Dashboard",
  monthly: "Monthly Setups",
  bottomed: "Bottomed Out",
  metrics: "Stock list",
  research: "Stock research",
  directory: "Scanner directory",
  picks: "Today's Picks",
  screens: "Core Setups",
  signals: "RPCI & Oscillators",
  scanners: "Trade Triggers",
  "rsi-edge": "RSI Edge Scanners",
  market: "Market",
  watchlist: "Watchlist",
  journal: "Trade Journal",
  learn: "About & risk",
};

const MARKET_MENU_ITEMS: {
  key: MarketMenuKey;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    key: "breakouts",
    icon: "↗",
    title: "All breakouts",
    description: "latest sessions' pivot clears",
  },
  {
    key: "breadth",
    icon: "◌",
    title: "Breadth",
    description: "how broad is the advance",
  },
  {
    key: "rotation",
    icon: "⟳",
    title: "Rotation",
    description: "where money is moving",
  },
  {
    key: "sectors",
    icon: "▦",
    title: "Sector strength",
    description: "strong · weak · heating · cooling",
  },
  {
    key: "map",
    icon: "▥",
    title: "Sector heatmap",
    description: "every sector and its stocks, coloured",
  },
];

// Averages over a handful of names are noise, so small industries are left out.
const MIN_SECTOR_MEMBERS = SHARED_MIN_SECTOR_MEMBERS;

function groupScanBySector(scan: ScreenScan | null) {
  return groupSectors(scan?.rows ?? []);
}

function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function MarketReadout({
  label,
  value,
  description,
  tone = "neutral",
}: {
  label: string;
  value: string;
  description: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClassName =
    tone === "positive" ? "text-[#16894f]" : tone === "negative" ? "text-down" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${toneClassName}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-muted">{description}</div>
    </div>
  );
}

function MarketPanel({
  active,
  scan,
  scanError,
}: {
  active: MarketMenuKey;
  scan: ScreenScan | null;
  scanError: boolean;
}) {
  const scanRows = (scan?.rows ?? []).filter((row) => Number.isFinite(row.changePercent));
  const sectorRows = groupScanBySector(scan);
  const advancing = scanRows.filter((row) => row.changePercent > 0).length;
  const declining = scanRows.filter((row) => row.changePercent < 0).length;
  const total = scanRows.length;
  const upPercent = total ? `${Math.round((advancing / total) * 100)}%` : "—";
  const downPercent = total ? `${Math.round((declining / total) * 100)}%` : "—";
  const breadth50 = movingAverageBreadth(scan?.rows ?? [], "vs50");
  const breadth200 = movingAverageBreadth(scan?.rows ?? [], "vs200");
  const strongest = sectorRows.filter((row) => row.avgChange > 0).slice(0, 6);
  const weakest = sectorRows
    .filter((row) => row.avgChange < 0)
    .sort((left, right) => left.avgChange - right.avgChange)
    .slice(0, 6);

  if (active === "breakouts") return null;

  if (active === "rotation") {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Market · rotation</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">Where money is moving today</h2>
        <p className="mt-1 text-xs text-muted">Average 1-day move of eligible equities per NSE sector (sectors with at least {MIN_SECTOR_MEMBERS} names; stocks without a published sector are excluded).</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-white p-3">
            <div className="mb-2 text-sm font-black text-foreground">Heating up</div>
            {strongest.map((row) => (
              <div key={row.sector} className="flex items-center justify-between border-t border-border/60 py-2 text-sm first:border-0">
                <span className="font-semibold">{row.sector}</span>
                <span className="font-mono text-[#16894f]">{signedPercent(row.avgChange)}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-white p-3">
            <div className="mb-2 text-sm font-black text-foreground">Cooling off</div>
            {weakest.map((row) => (
              <div key={row.sector} className="flex items-center justify-between border-t border-border/60 py-2 text-sm first:border-0">
                <span className="font-semibold">{row.sector}</span>
                <span className="font-mono text-down">{signedPercent(row.avgChange)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (active === "sectors") {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Market · sector strength</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">Strong · weak · heating · cooling</h2>
        <p className="mt-1 text-xs text-muted">NSE sectors with at least {MIN_SECTOR_MEMBERS} eligible equities; stocks without a published sector are excluded.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sectorRows.map((row) => (
            <div key={row.sector} className="rounded-xl border border-border bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-foreground">{row.sector}</span>
                <span className={`font-mono text-sm ${toneClass(row.avgChange)}`}>
                  {signedPercent(row.avgChange)}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted">
                {row.advancing} of {row.total} advancing · median traded value ₹{Math.round(row.turnoverCr).toLocaleString("en-IN")} cr/day
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-[#16894f]" style={{ width: `${(row.advancing / row.total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (active === "map") {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Market · sector heatmap</p>
        <h2 className="mt-1 mb-4 text-2xl font-black tracking-tight text-foreground">Every sector at a glance</h2>
        <SectorHeatmap rows={scan?.rows ?? []} />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">Market · breadth</p>
      <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">The lay of the land</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketReadout
          label="Up today"
          value={upPercent}
          description={`${advancing} of ${total} eligible equities rose`}
          tone="positive"
        />
        <MarketReadout
          label="Down today"
          value={downPercent}
          description={`${declining} of ${total} eligible equities fell`}
          tone="negative"
        />
        <MarketReadout
          label="Above the 50-day line"
          value={breadth50.percent == null ? "—" : `${breadth50.percent}%`}
          description={`${breadth50.above} of ${breadth50.covered} eligible equities with 50-day history`}
        />
        <MarketReadout
          label="Above the 200-day line"
          value={breadth200.percent == null ? "—" : `${breadth200.percent}%`}
          description={`${breadth200.above} of ${breadth200.covered} eligible equities with 200-day history`}
        />
      </div>
      <p className="mt-3 text-xs text-muted">
        Moving-average breadth covers liquid NSE EQ-series equities (median traded value ≥ ₹5 cr), not every listed security.
        {scanError ? " Scan refresh failed; breadth may be stale." : ""}
      </p>
    </section>
  );
}

function ThemeToggle() {
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

/** Copies the current URL, which always encodes the open page, tab and stock. */
function CopyPageLink() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy link to this page"
      title={copied ? "Link copied" : "Copy link to this page"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-white shadow-sm transition ${
        copied ? "border-emerald-300 text-emerald-600" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      <NavIcon name={copied ? "check" : "link"} size={17} />
    </button>
  );
}

const IST_CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const IST_DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const IST_HOUR = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false });

function istClock(now: number | null): string {
  return now == null ? "--:--" : IST_CLOCK.format(now);
}

/** Compact market-phase pill for the top bar. */
function MarketPill({ status }: { status: MarketStatus | null }) {
  const live = status?.isLive ?? false;
  return (
    <span
      title={status?.label ?? "Connecting"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500 pulse-dot" : "bg-slate-400"}`} />
      <span className="hidden lg:inline">{status?.label ?? "Connecting"}</span>
    </span>
  );
}

function HeaderClock() {
  const now = useNow(1000);
  return (
    <span className="hidden shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] font-bold text-slate-500 xl:inline-flex">
      <NavIcon name="clock" size={13} />
      {istClock(now)} IST
    </span>
  );
}

function SidebarClock() {
  const now = useNow(1000);
  return <span className="sidenav-muted ml-auto font-mono tracking-normal">{istClock(now)}</span>;
}

function Greeting({ status }: { status: MarketStatus | null }) {
  const now = useNow(60_000);
  const hour = now == null ? null : Number(IST_HOUR.format(now));
  const part = hour == null ? "" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <div className="flex min-h-[52px] flex-wrap items-end justify-between gap-3 px-1">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Your daily edge</p>
        <h2 className="text-[24px] font-extrabold tracking-[-0.03em] text-slate-900">
          {part ? `${part}, ${USER_NAME}` : USER_NAME}
        </h2>
        <p className="mt-0.5 text-xs font-medium text-slate-500">
          {now == null ? "\u00a0" : IST_DATE.format(now)}
          {status ? ` · ${status.label}` : ""}
        </p>
      </div>
    </div>
  );
}

function SideItem({
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

function SideGroup({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div>
      {collapsed ? <div className="sidenav-divider mx-3 mb-2 border-t" /> : <div className="sidenav-label">{label}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** A small heading inside "Research & older tools" so its twelve items read as four short groups. */
function ToolSection({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      {!collapsed && <div className="sidenav-sublabel">{label}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function UniversePicker({ value, onChange }: { value: UniverseKey; onChange: (key: UniverseKey) => void }) {
  const option = UNIVERSE_OPTIONS.find((item) => item.key === value)!;
  const size = universeSize(value);
  const filtered = value !== "all";
  return (
    <label
      title={`${option.detail}. Filters scanner lists; market breadth and ratings still use the whole market.`}
      className={`flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
        filtered ? "border-[#16894f] bg-[#e7f6ee] text-[#12814c]" : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      <span className="hidden xl:inline">Universe</span>
      <select
        aria-label="Stock universe"
        value={value}
        onChange={(event) => onChange(event.target.value as UniverseKey)}
        className="min-w-0 cursor-pointer bg-transparent font-black text-slate-900 outline-none"
      >
        {UNIVERSE_OPTIONS.map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>
      {size != null && <span className="hidden font-mono text-[10px] opacity-80 xl:inline">{size}</span>}
    </label>
  );
}

export function Dashboard() {
  const router = useRouter();
  const [activeScanner, setActiveScanner] = useState<ScannerKey>("range");
  const [scannerMode, setScannerMode] = useState<ScannerMode>("completed");
  const [activeNav, setActiveNav] = useState<ActiveNavKey>("today");
  const [activeMetric, setActiveMetric] = useState<DashboardMetric>("above50");
  const [researchHorizon, setResearchHorizon] = useState<BuyHorizon>("short");
  const [activeMarketMenu, setActiveMarketMenu] = useState<MarketMenuKey>("breakouts");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const openStock = useCallback((symbol: string) => {
    setCommandOpen(false);
    setDetailSymbol(symbol.toUpperCase());
  }, []);
  const closeStock = useCallback(() => setDetailSymbol(null), []);
  const { symbols, add, remove, reset } = useWatchlist();
  const journal = useTradeJournal();
  const watchlistView = activeNav === "watchlist";
  const journalView = activeNav === "journal";
  const trackedWatchlistSymbols = useMemo(
    () => [...new Set([...NIFTY50_SYMBOLS, ...symbols])],
    [symbols],
  );
  const { quotes, status, dataSource, connection, lastUpdate } =
    useMarketStream(watchlistView ? trackedWatchlistSymbols : symbols);
  const paper = usePaperTrading();
  const series = useIntradaySeries(watchlistView ? trackedWatchlistSymbols : []);
  const { scan, error: scanError, loadingMessage: scanLoadingMessage } = useScreenScan();

  const indices = useIndexQuotes();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectNav = (key: ActiveNavKey, sectionId: string = key) => {
    setActiveNav(key);
    // The page body swaps between views, so scroll after the new view renders.
    window.requestAnimationFrame(() => scrollToSection(sectionId));
  };

  const [rsiEdgeTab, setRsiEdgeTab] = useState<RsiEdgeScanKey>("daily-bullish");
  const [routeReady, setRouteReady] = useState(false);

  // URL → state: on load and on Back/Forward, so any view can be shared as a link.
  useEffect(() => {
    const applyUrl = () => {
      const route = parseRoute(window.location.hash, window.location.search);
      setActiveNav(route.nav);
      setActiveScanner(route.scanner);
      setActiveMarketMenu(route.market);
      setRsiEdgeTab(route.rsiEdge);
      setDetailSymbol(route.stock);
      setActiveMetric(route.metric);
      setRouteReady(true);
    };
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    window.addEventListener("hashchange", applyUrl);
    return () => {
      window.removeEventListener("popstate", applyUrl);
      window.removeEventListener("hashchange", applyUrl);
    };
  }, []);

  // State → URL: page changes add a history entry; opening or closing a stock replaces it.
  useEffect(() => {
    if (!routeReady) return;
    const route = { nav: activeNav, scanner: activeScanner, market: activeMarketMenu, rsiEdge: rsiEdgeTab, stock: detailSymbol, metric: activeMetric };
    const { pathname, search, hash } = window.location;
    const url = routeUrl(route, pathname, search);
    if (url === pathname + search + hash) return;
    if (routeHash(route) !== hash) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [routeReady, activeNav, activeScanner, activeMarketMenu, rsiEdgeTab, detailSymbol, activeMetric]);
  const signalsView = activeNav === "signals";
  const scannersView = activeNav === "scanners";
  const toolsView = activeNav === "picks" || journalView || activeNav === "market" || activeNav === "monthly" || activeNav === "bottomed" || activeNav === "screens" || signalsView || scannersView || activeNav === "rsi-edge" || activeNav === "research" || activeNav === "directory";
  const scanners = useScannerResults(scannersView || activeNav === "research" || activeNav === "directory" || activeNav === "picks" || detailSymbol != null, scannerMode);
  const rsiEdge = useRsiEdgeResults(activeNav === "rsi-edge" || activeNav === "research" || activeNav === "directory" || detailSymbol != null);
  const [universe, setUniverse] = useUniverse();
  const universeKeep = useMemo(() => universePredicate(universe), [universe]);
  const universeScan = useMemo(() => filterScan(scan, universeKeep), [scan, universeKeep]);
  const universeScanners = useMemo(() => filterScanners(scanners.data, universeKeep), [scanners.data, universeKeep]);
  const universeRsiEdge = useMemo(() => filterRsiEdge(rsiEdge.data, universeKeep), [rsiEdge.data, universeKeep]);
  const universeApplies = activeNav === "monthly" || activeNav === "bottomed" || activeNav === "today" || activeNav === "metrics" || activeNav === "research" || activeNav === "directory" || activeNav === "screens" || signalsView || scannersView || activeNav === "rsi-edge";

  const selectScanner = (key: ScannerKey) => {
    setActiveScanner(key);
    setActiveNav("scanners");
    window.requestAnimationFrame(() => scrollToSection("scanners"));
  };

  const selectMarketMenu = (key: MarketMenuKey) => {
    setActiveNav("market");
    setActiveMarketMenu(key);
    if (key === "breakouts") {
      window.requestAnimationFrame(() => scrollToSection("breakouts-record"));
      return;
    }
    scrollToSection("market");
  };

  const openBreakoutRecord = () => {
    setActiveNav("market");
    setActiveMarketMenu("breakouts");
    window.requestAnimationFrame(() => scrollToSection("breakouts-record"));
  };

  const navigateFromCommandCenter = (target: CommandCenterTarget) => {
    if (target === "breakouts" || target === "sectors" || target === "breadth") selectMarketMenu(target);
    else if (target.startsWith("scanner-")) selectScanner(target.slice("scanner-".length) as ScannerKey);
    else if (target.startsWith("rsi-edge-")) {
      setRsiEdgeTab(target.slice("rsi-edge-".length) as RsiEdgeScanKey);
      selectNav("rsi-edge");
    } else if (target === "signals-momentum") selectNav("signals", "momentum-title");
    else selectNav(target as ActiveNavKey);
  };


  useEffect(() => {
    const openCommands = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      } else if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", openCommands);
    return () => window.removeEventListener("keydown", openCommands);
  }, []);

  return (
    <StockDetailProvider value={openStock}>
    <div className="dashboard-shell flex min-h-screen min-w-0">
      <aside data-collapsed={sidebarCollapsed} className="sidenav sticky top-0 flex h-screen shrink-0 flex-col transition-[width] duration-300">
        <div className="sidenav-divider flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
          <button type="button" onClick={() => selectNav("today")} title="Traders Adda — Today" className="flex min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-[#5fd49a]">
            <span className="flex h-8 w-8 shrink-0 rotate-[-12deg] items-center justify-center rounded-[10px] bg-[#f0c14b] text-sm font-black text-[#0b1a34] shadow-[0_4px_14px_rgba(240,193,75,0.3)]">╱</span>
            {!sidebarCollapsed && (
              <span className="sidenav-text min-w-0">
                <span className="block text-[15px] font-extrabold leading-none tracking-[-0.03em]">Traders <span className="text-[#f0c14b]">Adda</span></span>
                <span className="sidenav-muted mt-1 block text-[8.5px] font-bold uppercase tracking-[0.18em]">Market workstation</span>
              </span>
            )}
          </button>
          {!sidebarCollapsed && (
            <button type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar" className="sidenav-text sidenav-btn ml-auto flex h-7 w-7 shrink-0 items-center justify-center">
              <NavIcon name="chevron-left" size={14} />
            </button>
          )}
        </div>

        <nav aria-label="Primary navigation" className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4">
          <SideGroup label="Your workspace" collapsed={sidebarCollapsed}>
            <SideItem icon="today" label="Today" current={activeNav === "today" || activeNav === "metrics"} collapsed={sidebarCollapsed} onClick={() => selectNav("today")} />
            <SideItem icon="journal" label="My positions" current={false} collapsed={sidebarCollapsed} onClick={() => router.push("/positions")} />
            <SideItem icon="breadth" label="Live strategy check" current={false} collapsed={sidebarCollapsed} onClick={() => router.push("/tracker")} />
            <SideItem icon="signals" label="Backtest (10 years)" current={false} collapsed={sidebarCollapsed} onClick={() => router.push("/backtest")} />
            <SideItem icon="picks" label="Email track record" current={false} collapsed={sidebarCollapsed} onClick={() => router.push("/radar")} />
            <SideItem icon="watchlist" label="Watchlist" current={activeNav === "watchlist"} collapsed={sidebarCollapsed} onClick={() => selectNav("watchlist")} />
          </SideGroup>

          <details key={toolsView ? "tools-active" : "tools-idle"} open={sidebarCollapsed || toolsView} className="sidenav-tools">
            <summary aria-label="Research and older tools" title="Research and older tools" className="sidenav-item cursor-pointer">
              <NavIcon name="setups" />
              <span className="sidenav-text flex-1">Research & older tools</span>
              <NavIcon name="chevron-down" size={14} className="sidenav-text sidenav-disclosure" />
            </summary>
            <div className="mt-2 space-y-3">
              <ToolSection label="Market" collapsed={sidebarCollapsed}>
                <SideItem icon="breadth" label="Market overview" current={activeNav === "market"} collapsed={sidebarCollapsed} onClick={() => selectMarketMenu(activeMarketMenu)} />
                <SideItem icon="signals" label="Stock research" current={activeNav === "research"} collapsed={sidebarCollapsed} onClick={() => selectNav("research")} />
                <SideItem icon="search" label="Scanner directory" current={activeNav === "directory"} collapsed={sidebarCollapsed} onClick={() => selectNav("directory")} />
              </ToolSection>
              <ToolSection label="Stock lists" collapsed={sidebarCollapsed}>
                <SideItem icon="picks" label="Older scanner picks" current={activeNav === "picks"} collapsed={sidebarCollapsed} onClick={() => selectNav("picks")} />
                <SideItem icon="setups" label="Core Setups" current={activeNav === "screens"} collapsed={sidebarCollapsed} onClick={() => selectNav("screens")} />
                <SideItem icon="setups" label="Monthly Setups" current={activeNav === "monthly"} collapsed={sidebarCollapsed} onClick={() => selectNav("monthly")} />
                <SideItem icon="setups" label="Bottomed Out" current={activeNav === "bottomed"} collapsed={sidebarCollapsed} onClick={() => selectNav("bottomed")} />
              </ToolSection>
              <ToolSection label="Signals" collapsed={sidebarCollapsed}>
                <SideItem icon="triggers" label="Trade Triggers" current={scannersView} collapsed={sidebarCollapsed} onClick={() => selectScanner(activeScanner)} />
                <SideItem icon="rsi" label="RSI Edge Scanners" current={activeNav === "rsi-edge"} collapsed={sidebarCollapsed} onClick={() => selectNav("rsi-edge")} />
                <SideItem icon="signals" label="RPCI & Oscillators" current={signalsView} collapsed={sidebarCollapsed} onClick={() => selectNav("signals")} />
              </ToolSection>
              <ToolSection label="Practice" collapsed={sidebarCollapsed}>
                <SideItem icon="journal" label="Paper trades & journal" current={journalView} collapsed={sidebarCollapsed} onClick={() => selectNav("journal")} />
                <SideItem icon="triggers" label="Index Scalp Desk" current={false} collapsed={sidebarCollapsed} onClick={() => router.push("/scalp")} />
              </ToolSection>
            </div>
          </details>

          <SideGroup label="Learn" collapsed={sidebarCollapsed}>
            <SideItem icon="about" label="About & risk" current={activeNav === "learn"} collapsed={sidebarCollapsed} onClick={() => selectNav("learn")} />
          </SideGroup>
        </nav>

        <div className="sidenav-footer sidenav-divider flex h-11 shrink-0 items-center gap-2 border-t px-4 text-[10px] font-extrabold uppercase tracking-[0.1em]">
          {sidebarCollapsed ? (
            <button type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar" className="sidenav-btn mx-auto flex h-7 w-7 items-center justify-center">
              <NavIcon name="chevron-left" size={14} className="rotate-180" />
            </button>
          ) : (
            <>
              <span className={`h-1.5 w-1.5 rounded-full ${status?.isLive ? "bg-[#5fd49a] pulse-dot" : "bg-[#6b7280]"}`} />
              <span className="sidenav-muted truncate">{status?.label ?? "Connecting"}</span>
              <SidebarClock />
            </>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="dashboard-header sticky top-0 z-30 flex min-h-[64px] flex-wrap items-center gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-xl lg:px-6">
          <h1 className="shrink-0 text-[15px] font-extrabold tracking-[-0.01em] text-slate-900">{PAGE_TITLES[activeNav]}</h1>
          <MarketPill status={status} />
          <HeaderClock />
          <div className="dashboard-search ml-auto min-w-0 max-w-[420px] flex-1 [&>div]:w-full [&_input]:h-9 [&_input]:rounded-xl [&_input]:border-slate-200 [&_input]:bg-slate-50 [&_input]:px-3.5 [&_input]:text-[13px] [&_input]:transition [&_input]:focus:bg-white">
            <SymbolSearch onSelect={openStock} existing={[]} />
          </div>
          <button type="button" onClick={() => setCommandOpen(true)} aria-label="Quick actions" title="Quick actions (Ctrl K)" className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
            <span className="hidden 2xl:inline">Quick actions</span><kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>
          <div className="hidden sm:block"><CopyPageLink /></div>
          <ThemeToggle />
          <div className="hidden shrink-0 items-center gap-2 border-l border-slate-200 pl-3 xl:flex" title={`${USER_NAME} · live workspace`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0c14b] text-xs font-black text-[#0b1a34]">{USER_NAME.charAt(0)}</span>
            <span className="hidden text-[13px] font-bold text-slate-800 xl:inline">{USER_NAME}</span>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-3 py-5 sm:px-6 lg:py-6">
          {universeApplies && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {activeNav === "today" ? <Greeting status={status} /> : <p className="text-xs text-muted">Filter scanner results, not market-wide breadth.</p>}
              <UniversePicker value={universe} onChange={setUniverse} />
            </div>
          )}
          {universeApplies && universe !== "all" && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#b9e6cd] bg-[#eef9f3] px-4 py-2.5 text-sm text-[#0f5c37]">
              <span>
                Showing <strong>{UNIVERSE_OPTIONS.find((item) => item.key === universe)!.label}</strong> only ({universeSize(universe)} stocks). Lists below may be shorter or empty; market breadth still uses the whole market.
              </span>
              <button type="button" onClick={() => setUniverse("all")} className="rounded-lg border border-[#16894f] bg-white px-3 py-1 text-xs font-bold text-[#12814c] transition hover:bg-[#16894f] hover:text-white">
                Show all NSE
              </button>
            </div>
          )}
          {commandOpen && (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-6 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}>
              <section role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.35)]">
                <div className="border-b border-slate-100 p-4 [&_input]:rounded-xl [&_input]:bg-slate-50 [&_input]:px-4 [&_input]:py-3">
                  <SymbolSearch onSelect={openStock} existing={[]} />
                </div>
                <div className="p-3">
                  <div className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Navigate</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Dashboard", "Market summary and next steps", "today", "◎"],
                      ["Watchlist", "Nifty 50 buy and short monitor", "watchlist", "▤"],
                      ["Market breadth", "Participation and regime", "market", "▥"],
                      ["Stock research", "Ideas, confluence and session changes", "research", "≋"],
                      ["Scanner directory", "Browse all visible tools", "directory", "⌖"],
                      ["Today's Picks", "Market gate and the top Buy ready stocks", "picks", "✓"],
                      ["Core Setups", "VCP, Blue sky and base breakouts", "screens", "〽"],
                      ["Monthly Setups", "Completed-month breakouts and compression", "monthly", "↗"],
                      ["Bottomed Out", "Fallen stocks with a higher low", "bottomed", "▼"],
                      ["Trade Triggers", "Selective entry and reversal scans", "scanners", "⌖"],
                      ["RSI Edge Scanners", "Daily, weekly and bearish RSI scans", "rsi-edge", "R"],
                      ["RPCI & Oscillators", "Momentum signals", "signals", "≋"],
                      ["Paper trades & journal", "Review paper orders and logged trades", "journal", "□"],
                      ["About & risk", "Methodology and disclosures", "learn", "□"],
                    ].map(([label, description, key, icon]) => (
                      <button key={key} type="button" onClick={() => { selectNav(key as ActiveNavKey); setCommandOpen(false); }} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>{icon}</span>
                        <span><span className="block text-sm font-black">{label}</span><span className="block text-xs text-muted">{description}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between bg-slate-50 px-5 py-3 text-[11px] text-slate-400"><span>Press Esc to close</span><span>Desktop command centre</span></div>
              </section>
            </div>
          )}

      <FyersBanner />
      <MarketStrip />

      {activeNav !== "metrics" && <section aria-label="Market index snapshot" className="scroll-mt-36 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4">
        <IndexStrip quotes={indices.quotes} lastUpdate={indices.lastUpdate} error={indices.error} />
      </section>}

      <div key={activeNav} className="page-enter">
      {activeNav === "today" || activeNav === "metrics" || activeNav === "research" || activeNav === "directory" ? (
        <CommandCenter
          view={activeNav}
          metric={activeMetric}
          horizon={researchHorizon}
          onHorizonChange={setResearchHorizon}
          onOpenMetric={(metric) => { setActiveMetric(metric); selectNav("metrics"); }}
          scan={universeScan}
          error={scanError}
          loadingMessage={scanLoadingMessage}
          scanners={universeScanners}
          rsiEdge={universeRsiEdge}
          onNavigate={navigateFromCommandCenter}
        />
      ) : activeNav === "monthly" ? (
        <MonthlySetups scan={scan} scanError={scanError} keep={universeKeep} />
      ) : activeNav === "bottomed" ? (
        <BottomedOutScreener keep={universeKeep} />
      ) : activeNav === "picks" ? (
        <TodaysPicks
          data={scanners.data}
          error={scanners.error}
          loadingMessage={scanners.loadingMessage}
          mode={scannerMode}
          onModeChange={setScannerMode}
          onPaperApprove={(pick, signalDate) => {
            paper.approve(pick, signalDate);
            selectNav("journal");
          }}
          paperSymbols={new Set(paper.trackedSymbols)}
          paperReady={paper.hydrated}
        />
      ) : scannersView ? (
        <div id="scanners" className="scroll-mt-28">
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4">
            <label htmlFor="trade-trigger-picker" className="text-sm font-bold text-foreground">Choose a trade trigger</label>
            <select id="trade-trigger-picker" value={activeScanner} onChange={(event) => selectScanner(event.target.value as ScannerKey)} className="min-w-0 max-w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-accent">
              {SCANNER_NAV_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {sortByEdge(group.keys).map((key) => {
                    const edge = scannerEdge(key);
                    return <option key={key} value={key}>{SCANNERS[key].menuLabel}{universeScanners ? ` (${universeScanners.results[key].filter((row) => row.passesFloor).length})` : ""}{edge ? ` · ${EDGE_TAG[edge.level]}` : ""}</option>;
                  })}
                </optgroup>
              ))}
            </select>
            <span className="min-w-0 flex-1 text-xs leading-5 text-muted">
              {(() => {
                const edge = scannerEdge(activeScanner);
                return edge
                  ? <><b className={edge.level === "edge" ? "text-emerald-700" : edge.level === "none" ? "text-rose-700" : "text-slate-700"}>{EDGE_TAG[edge.level].toUpperCase()}.</b> {scannerEdgeSentence(SCANNERS[activeScanner].menuLabel, edge)} Matches are candidates, not buy calls.</>
                  : "Scanner matches are candidates, not buy calls. This scanner has no backtest yet.";
              })()}
            </span>
          </div>
          <ChartinkScannerSection
            active={activeScanner}
            mode={scannerMode}
            onModeChange={setScannerMode}
            data={universeScanners}
            error={scanners.error}
            loadingMessage={scanners.loadingMessage}
            watchlistSymbols={symbols}
            onAddToWatchlist={add}
          />
        </div>
      ) : activeNav === "rsi-edge" ? (
        <RsiEdgeScannerSection
          scan={universeScan}
          source={universeRsiEdge}
          sourceError={rsiEdge.error}
          sourceLoading={rsiEdge.loading}
          active={rsiEdgeTab}
          onTabChange={setRsiEdgeTab}
        />
      ) : signalsView ? (
        <WorkspaceFrame id="signals" className="scroll-mt-28">
          <WorkspaceHero
            eyebrow="Timing and confirmation" icon="signals"
            title="RPCI & Oscillators"
            description="Use contraction structure to find developing setups and oscillator agreement to time stronger continuation or pullback entries."
          />
          <div className="space-y-5 bg-slate-50/60 p-5">
            <RpciApproxSection
              scan={universeScan}
              error={scanError}
              loadingMessage={scanLoadingMessage}
              watchlistSymbols={symbols}
              onAddToWatchlist={add}
            />
            <MomentumOscillatorSection
              scan={universeScan}
              error={scanError}
              loadingMessage={scanLoadingMessage}
              watchlistSymbols={symbols}
              onAddToWatchlist={add}
            />
          </div>
        </WorkspaceFrame>
      ) : watchlistView ? (
        <WatchlistPanel
          symbols={symbols}
          quotes={quotes}
          series={series}
          onAdd={add}
          onRemove={remove}
          onReset={reset}
          scan={scan}
        />
      ) : journalView ? (
        <>
          <div className="mb-5">
            <PaperTrading
              key={paper.initialCapital}
              orders={paper.orders}
              initialCapital={paper.initialCapital}
              onCapitalChange={paper.setCapital}
              onCancel={paper.cancel}
              onCloseNow={paper.closeNow}
              onRemoveDemo={paper.removeDemo}
              error={paper.error}
              onClearError={paper.clearError}
              connected={paper.connected}
              ready={paper.hydrated}
              snapshot={paper.snapshot}
            />
          </div>
          <TradeJournal entries={journal.entries} onClose={journal.close} onReopen={journal.reopen} onRemove={journal.remove} />
        </>
      ) : activeNav === "learn" ? (
        <WorkspaceFrame id="learn" className="scroll-mt-28">
          <WorkspaceHero
            eyebrow="Method and risk" icon="about"
            title="How to use Traders Adda"
            description="A transparent guide to scanner roles, ratings, risk controls, data limitations, and responsible use."
          />
          <div className="grid gap-4 bg-slate-50/60 p-5 lg:grid-cols-3">
            {[
              ["1", "Discover", "Start with Core Setups, Trade Triggers, or RSI Edge. A scanner match is only a candidate."],
              ["2", "Confirm", "Prefer Buy ready status, supportive breadth, adequate liquidity, and aligned trend."],
              ["3", "Plan risk", "Use the displayed entry, stop, targets and risk percentage. Never treat a rating as a probability of success."],
            ].map(([number, title, text]) => (
              <div key={number} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700">{number}</span>
                <h3 className="mt-4 text-lg font-black text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </div>
            ))}
            <div className="lg:col-span-3">
              <h3 className="text-lg font-black text-slate-900">Words used in the app</h3>
              <p className="mb-3 mt-1 text-sm text-slate-600">Dotted words on other pages explain themselves when tapped. Here they all are in one place.</p>
              <GlossaryList />
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 lg:col-span-3">
              <h3 className="font-black text-amber-900">Important risk notice</h3>
              <p className="mt-2 text-sm leading-6 text-amber-900/80">
                This is a market analytics and charting tool, not investment advice, and not a SEBI-registered adviser or research analyst service.
                Markets carry risk; validate every setup and consult a registered adviser where appropriate.
              </p>
            </div>
          </div>
        </WorkspaceFrame>
      ) : activeNav === "market" ? (
        <WorkspaceFrame id="market" className="scroll-mt-28">
          <WorkspaceHero
            eyebrow="Market context" icon="breadth"
            title="Breadth, Rotation & Breakouts"
            description="Read the market environment before acting on individual stock signals."
          >
            <MarketStatusBar
              status={status}
              connection={connection}
              dataSource={dataSource}
              lastUpdate={lastUpdate}
            />
          </WorkspaceHero>
          <WorkspaceTabs
            items={MARKET_MENU_ITEMS.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.title,
              detail: item.description,
            }))}
            active={activeMarketMenu}
            onSelect={selectMarketMenu}
          />
          <div className="bg-slate-50/60 p-5">
            {activeMarketMenu === "breakouts"
              ? <BreakoutsRecordSection scan={scan} />
              : <MarketPanel active={activeMarketMenu} scan={scan} scanError={scanError} />}
          </div>
        </WorkspaceFrame>
      ) : (
        <WorkspaceFrame id="screens" className="scroll-mt-28">
          <WorkspaceHero
            eyebrow="Primary trading workspace" icon="setups"
            title="Core Setups"
            description="Find high-quality bases first, then use ratings, breadth, and a defined trade plan before considering an entry."
          />
          <div className="bg-slate-50/60 p-5">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <LivePatternSection
                scan={universeScan}
                scanError={scanError}
                scanLoadingMessage={scanLoadingMessage}
                quotes={quotes}
                lastUpdate={lastUpdate}
                watchlistSymbols={symbols}
                onAddToWatchlist={add}
                onOpenBreakouts={openBreakoutRecord}
              />
            </div>
          </div>
        </WorkspaceFrame>
      )}
      </div>

      <footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted">
        <p>
          <span className="text-foreground">Important.</span> This is a market
          analytics and charting tool, not investment advice, and not a
          SEBI-registered adviser or research analyst service. Markets carry
          risk — consult a registered adviser before investing.
        </p>
        {dataSource && (
          <p className="mt-1.5">
            Data source: {dataSource.label}
            {dataSource.isRealtime ? "" : " — prices are simulated and do not reflect the real market."}
          </p>
        )}
      </footer>
        </div>
      </main>
      {detailSymbol && (
        <StockDetailDrawer
          key={detailSymbol}
          symbol={detailSymbol}
          onClose={closeStock}
          scan={scan}
          quote={quotes[detailSymbol] ?? null}
          scanners={scanners.data}
          rsiEdge={rsiEdge.data}
          inWatchlist={trackedWatchlistSymbols.includes(detailSymbol)}
          onAddToWatchlist={add}
        />
      )}
    </div>
    </StockDetailProvider>
  );
}
