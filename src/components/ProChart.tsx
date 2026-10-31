"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatPercent, formatPrice, formatVolume } from "@/lib/format";
import type { Candle } from "@/lib/market/types";
import { aggregateCandles, type ChartTimeframe } from "@/lib/chart/aggregate";
import { INTRADAY_TIMEFRAMES, isIntradayTimeframe, type IntradayTimeframe } from "@/lib/chart/intraday";
import { useFyersIntradayCandles } from "@/hooks/useFyersChartCandles";
import { autoLevels, type AutoLevel } from "@/lib/chart/autoLevels";
import { CANDLE_PATTERNS, detectCandlePatterns, type CandlePatternHit } from "@/lib/chart/candlePatterns";
import { barIndexAt, type Drawing } from "@/lib/chart/drawings";
import { bollinger, classicPivots, ichimoku, sma, supertrend, type Series } from "@/lib/chart/indicators";
import { regressionBreakoutMap, type ArbmMap, type ArbmTrade } from "@/lib/chart/regressionBreakout";
import { DEFAULT_PARAMS, PARAM_DEFS, PARAM_GROUPS, cleanParam, cleanParams, paramSummary, type ChartParams, type ParamGroup, type ParamKey } from "@/lib/chart/chartParams";
import { adx, macd, rsi, stochastic } from "@/lib/screen/oscillators";

export interface ChartLevel {
  label: string;
  value: number;
  color: string;
}

type Overlay = "ma" | "bb" | "st" | "ichi" | "pivots" | "levels" | "patterns" | "arbm" | "volume";
type Pane = "rsi" | "macd" | "stoch" | "adx" | "atr";
type Toggle = Overlay | Pane;
type ScaleMode = "normal" | "log" | "percent";
type Tool = "none" | "trend" | "hline";
/** Daily/weekly/monthly from the scan's candles, or intraday minutes from Fyers. */
type Timeframe = ChartTimeframe | IntradayTimeframe;

interface ChartSettings {
  timeframe: Timeframe;
  scale: ScaleMode;
  on: Record<Toggle, boolean>;
  /** Dark chart even when the app is in light mode. */
  dark: boolean;
  params: ChartParams;
}

const STORAGE_KEY = "traders-adda:chart";
const DRAWINGS_KEY = "traders-adda:drawings";
const DEFAULTS: ChartSettings = {
  timeframe: "D",
  scale: "normal",
  on: {
    ma: true, bb: false, st: false, ichi: false, pivots: false, levels: true, patterns: false, arbm: false, volume: true,
    rsi: false, macd: false, stoch: false, adx: false, atr: false,
  },
  dark: false,
  params: DEFAULT_PARAMS,
};

const OVERLAYS: { key: Overlay; label: string; hint: string }[] = [
  { key: "ma", label: "Moving averages", hint: "Three simple moving averages (20, 50 and 200 bars by default; change them with ⚙ in the chart legend)" },
  { key: "bb", label: "Bollinger", hint: "Bollinger Bands: 20-bar average ± 2 standard deviations by default" },
  { key: "st", label: "Supertrend", hint: "Supertrend (10, 3 by default): green below price in an uptrend, red above in a downtrend" },
  { key: "ichi", label: "Ichimoku", hint: "Ichimoku (9, 26, 52): conversion, base line and the cloud projected 26 bars ahead" },
  { key: "pivots", label: "Pivots", hint: "Classic floor pivots P, R1–R3, S1–S3 from the last completed week (daily chart), month (weekly) or year (monthly)" },
  { key: "levels", label: "Auto S/R", hint: "Support and resistance from clustered swing highs and lows (2+ touches, within 25% of price)" },
  {
    key: "patterns",
    label: "Candle patterns",
    hint: "Marks hammers, engulfings, stars and more on the last 120 bars. Our 2022–2026 NSE study found no edge (about 50% follow-through over 10 sessions), so treat them as context, not signals.",
  },
  {
    key: "arbm",
    label: "Regression Breakout",
    hint: "GainzAlgo's Adaptive Regression Breakout Map (50-bar regression ± 2σ, squeeze = narrowest 20% of 100 bars). Marks Long/Short breakouts with entry, stop and TP1–TP3. Our NSE backtest found no edge (−0.09R a trade), so use it as context, not a buy signal.",
  },
  { key: "volume", label: "Volume", hint: "Volume bars under the price" },
];
const PANES: { key: Pane; label: string; hint: string }[] = [
  { key: "rsi", label: "RSI", hint: "RSI 14 with 70/30 guides" },
  { key: "macd", label: "MACD", hint: "MACD 12/26/9 with histogram" },
  { key: "stoch", label: "Stochastic", hint: "Slow stochastic 14/3/3 with 80/20 guides" },
  { key: "adx", label: "ADX", hint: "ADX 14 with +DI and −DI; 25 marks a trending market" },
  { key: "atr", label: "ATR", hint: "Average true range 14 (Wilder), in rupees" },
];
const TIMEFRAMES: { key: ChartTimeframe; label: string; hotkey: string }[] = [
  { key: "D", label: "Daily", hotkey: "D" },
  { key: "W", label: "Weekly", hotkey: "W" },
  { key: "M", label: "Monthly", hotkey: "M" },
];
const INTRADAY_KEYS = Object.keys(INTRADAY_TIMEFRAMES) as IntradayTimeframe[];
const tfShortOf = (tf: Timeframe) => (isIntradayTimeframe(tf) ? INTRADAY_TIMEFRAMES[tf].short : tf === "D" ? "1D" : tf === "W" ? "1W" : "1M");
const tfNameOf = (tf: Timeframe) => (isIntradayTimeframe(tf) ? INTRADAY_TIMEFRAMES[tf].label : tf === "D" ? "daily" : tf === "W" ? "weekly" : "monthly");
const RANGES = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "All", months: null },
] as const;
type RangeLabel = (typeof RANGES)[number]["label"];
const DEFAULT_RANGE: Record<Timeframe, RangeLabel> = { D: "6M", W: "All", M: "All", "1": "All", "5": "All", "15": "All", "60": "All" };
const SHORTCUTS: [string, string][] = [
  ["D / W / M", "Daily, weekly, monthly"],
  ["← / →", "Pan"],
  ["↑ / ↓", "Zoom in / out"],
  ["Ctrl+L", "Log scale"],
  ["Ctrl+P", "Percent scale"],
  ["Alt+R", "Reset view"],
  ["T / H", "Trend line / horizontal line tool"],
  ["Esc", "Cancel drawing"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo drawing"],
  ["Ctrl+Shift+S", "Download PNG"],
  ["F", "Full screen (Esc to leave)"],
];

/** TradingView's default candle colours. */
const COLORS = {
  up: "#089981",
  down: "#f23645",
  ma20: "#d6911d",
  ma50: "#6366f1",
  ma200: "#64748b",
  bb: "#0ea5e9",
  rsi: "#7c3aed",
  macd: "#2563eb",
  signal: "#f59e0b",
  support: "#059669",
  resistance: "#dc2626",
  tenkan: "#0891b2",
  kijun: "#be123c",
  spanA: "rgba(22,163,74,0.75)",
  spanB: "rgba(225,29,72,0.75)",
  pivot: "#a16207",
  drawing: "#2563eb",
  arbmBand: "#4f46e5",
  arbmSqueeze: "#94a3b8",
  arbmEntry: "#2563eb",
  arbmStop: "#dc2626",
  arbmTarget: "#16a34a",
  arbmTrendHigh: "#06b6d4",
  arbmTrendLow: "#d946ef",
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const dayString = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
const dateLabel = (t: number, timeframe: Timeframe) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: timeframe === "M" ? undefined : "2-digit",
    month: "short",
    year: "2-digit",
    ...(isIntradayTimeframe(timeframe) ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(t);

function loadSettings(): ChartSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw) return DEFAULTS;
    return {
      timeframe: ["D", "W", "M"].includes(raw.timeframe) || isIntradayTimeframe(raw.timeframe) ? raw.timeframe : DEFAULTS.timeframe,
      scale: ["normal", "log", "percent"].includes(raw.scale) ? raw.scale : DEFAULTS.scale,
      on: { ...DEFAULTS.on, ...(raw.on ?? {}) },
      dark: raw.dark === true,
      params: cleanParams(raw.params),
    };
  } catch {
    return DEFAULTS;
  }
}

function loadDrawings(symbol: string): Drawing[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(DRAWINGS_KEY) ?? "{}");
    return Array.isArray(all[symbol]) ? all[symbol] : [];
  } catch {
    return [];
  }
}

function saveDrawings(symbol: string, drawings: Drawing[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(DRAWINGS_KEY) ?? "{}");
    if (drawings.length) all[symbol] = drawings;
    else delete all[symbol];
    window.localStorage.setItem(DRAWINGS_KEY, JSON.stringify(all));
  } catch { /* storage full or blocked */ }
}

/** Colours from the chart wrapper, which carries data-theme="dark" when the chart is forced dark. */
function themeColors(el: HTMLElement) {
  const dark = el.closest('[data-theme="dark"]') != null;
  const css = getComputedStyle(el);
  return {
    dark,
    background: css.getPropertyValue("--chart-surface").trim() || (dark ? "#121820" : "#ffffff"),
    grid: css.getPropertyValue("--chart-grid").trim() || (dark ? "#222c38" : "#eef2f1"),
    text: dark ? "#94a3b8" : "#64748b",
    border: dark ? "#2a3644" : "#e2e8f0",
    watermark: dark ? "rgba(148,163,184,0.07)" : "rgba(100,116,139,0.07)",
  };
}

function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

/** The last completed higher-timeframe bar that feeds the pivot levels. */
function pivotSource(candles: Candle[], timeframe: Timeframe, bars: Candle[]): { bar: Candle; label: string } | null {
  if (isIntradayTimeframe(timeframe)) {
    // Intraday floor pivots come from the previous completed daily bar.
    const lastDay = bars.length ? dayString(bars[bars.length - 1].t) : null;
    const done = candles.filter((c) => lastDay == null || dayString(c.t) < lastDay);
    const bar = done[done.length - 1];
    return bar ? { bar, label: `day ${dateLabel(bar.t, "D")}` } : null;
  }
  if (timeframe === "M") {
    const lastYear = new Date(candles[candles.length - 1].t + IST_OFFSET_MS).getUTCFullYear() - 1;
    const year = candles.filter((c) => new Date(c.t + IST_OFFSET_MS).getUTCFullYear() === lastYear);
    if (!year.length) return null;
    return {
      bar: { t: year[0].t, open: year[0].open, close: year[year.length - 1].close, high: Math.max(...year.map((c) => c.high)), low: Math.min(...year.map((c) => c.low)), volume: 0 },
      label: `${lastYear}`,
    };
  }
  const higher = aggregateCandles(candles, timeframe === "D" ? "W" : "M");
  if (higher.length < 2) return null;
  const bar = higher[higher.length - 2];
  return { bar, label: timeframe === "D" ? `week of ${dateLabel(bar.t, "D")}` : dateLabel(bar.t, "M") };
}

export function ProChart({ candles, levels: levelsProp, symbol, intraday = false }: {
  candles: Candle[];
  levels: ChartLevel[];
  symbol: string;
  /** Fyers is connected, so intraday timeframes can be offered. */
  intraday?: boolean;
}) {
  // Live scan polls hand us a fresh array every few seconds; rebuild the chart only when the values change.
  const levelsKey = JSON.stringify(levelsProp);
  const levels = useMemo<ChartLevel[]>(() => JSON.parse(levelsKey), [levelsKey]);
  // Settings-dependent markup renders only after candles load on the client, so
  // reading localStorage in the initialisers cannot cause a hydration mismatch.
  const [settings, setSettings] = useState<ChartSettings>(() => (typeof window === "undefined" ? DEFAULTS : loadSettings()));
  // A saved intraday choice falls back to daily while Fyers is not connected.
  const tf: Timeframe = !intraday && isIntradayTimeframe(settings.timeframe) ? "D" : settings.timeframe;
  const intradayTf = isIntradayTimeframe(tf) ? tf : null;
  const intra = useFyersIntradayCandles(symbol, intradayTf);
  const [range, setRange] = useState<RangeLabel>(() => DEFAULT_RANGE[settings.timeframe]);
  const [resetNonce, setResetNonce] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [pending, setPending] = useState<{ t: number; price: number } | null>(null);
  const [drawingsFor, setDrawingsFor] = useState(symbol);
  const [drawings, setDrawings] = useState<Drawing[]>(() => (typeof window === "undefined" ? [] : loadDrawings(symbol)));
  const [redo, setRedo] = useState<Drawing[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [editing, setEditing] = useState<ParamGroup | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([]);
  if (drawingsFor !== symbol) {
    setDrawingsFor(symbol);
    setDrawings(loadDrawings(symbol));
    setRedo([]);
    setPending(null);
    setTool("none");
  }
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const logicalRef = useRef<LogicalRange | null>(null);
  const barCountRef = useRef(0);
  const viewSymbolRef = useRef(symbol);
  const clickRef = useRef<(param: MouseEventParams<Time>) => void>(() => {});
  const themeVersion = useThemeVersion();

  const update = useCallback((next: ChartSettings) => {
    setSettings(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }, []);
  const setTimeframe = (timeframe: Timeframe) => {
    if (timeframe === tf) return;
    logicalRef.current = null;
    setRange(DEFAULT_RANGE[timeframe]);
    update({ ...settings, timeframe });
  };
  const setScale = (scale: ScaleMode) => update({ ...settings, scale: settings.scale === scale ? "normal" : scale });
  const toggle = (key: Toggle) => update({ ...settings, on: { ...settings.on, [key]: !settings.on[key] } });
  const resetView = () => {
    logicalRef.current = null;
    setResetNonce((n) => n + 1);
  };
  const chooseRange = (label: RangeLabel) => {
    setRange(label);
    resetView();
  };
  const commitDrawings = (next: Drawing[], clearRedo = true) => {
    setDrawings(next);
    saveDrawings(symbol, next);
    if (clearRedo) setRedo([]);
  };
  const undo = () => {
    if (!drawings.length) return;
    setRedo([...redo, drawings[drawings.length - 1]]);
    commitDrawings(drawings.slice(0, -1), false);
  };
  const redoLast = () => {
    if (!redo.length) return;
    commitDrawings([...drawings, redo[redo.length - 1]], false);
    setRedo(redo.slice(0, -1));
  };
  const chooseTool = (next: Tool) => {
    setPending(null);
    setTool(tool === next ? "none" : next);
  };
  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === wrapperRef.current && wrapperRef.current != null);
      setViewportHeight(window.innerHeight);
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  const params = settings.params;
  const saveParams = (next: ChartParams) => update({ ...settings, params: next });

  const bars = useMemo(
    () => (intradayTf ? intra.candles : aggregateCandles(candles, tf as ChartTimeframe)),
    [candles, intra.candles, intradayTf, tf],
  );
  const sr = useMemo<AutoLevel[]>(() => autoLevels(bars, tf === "D" || intradayTf ? {} : { pivotBars: 2 }), [bars, tf, intradayTf]);
  const patterns = useMemo<CandlePatternHit[]>(() => detectCandlePatterns(bars, Math.max(0, bars.length - 120)), [bars]);
  const arbm = useMemo<ArbmMap | null>(
    () => (settings.on.arbm && bars.length > 2
      ? regressionBreakoutMap(bars, {
        length: params.arbmLength,
        devMult: params.arbmDev,
        sqzLen: params.arbmSqzLen,
        sqzPct: params.arbmSqzPct,
        tp: [params.arbmTp1, params.arbmTp2, params.arbmTp3],
        pivotLen: 10,
      })
      : null),
    [bars, settings.on.arbm, params],
  );
  // Indicator series live outside the chart build so the legend can show their values under the crosshair.
  const ind = useMemo(() => {
    const closes = bars.map((b) => b.close);
    const on = settings.on;
    return {
      ma: on.ma ? [sma(closes, params.ma1), sma(closes, params.ma2), sma(closes, params.ma3)] : null,
      bb: on.bb ? bollinger(closes, params.bbLength, params.bbMult) : null,
      st: on.st ? supertrend(bars, params.stPeriod, params.stMult) : null,
      ichi: on.ichi ? ichimoku(bars) : null,
      rsi: on.rsi ? rsi(closes, params.rsiLength) : null,
      macd: on.macd ? macd(closes) : null,
      stoch: on.stoch ? stochastic(bars) : null,
      adx: on.adx || on.atr ? adx(bars) : null,
    };
  }, [bars, settings.on, params]);
  const patternsByIndex = useMemo(() => {
    const map = new Map<number, CandlePatternHit[]>();
    for (const p of patterns) map.set(p.index, [...(map.get(p.index) ?? []), p]);
    return map;
  }, [patterns]);
  const pivots = useMemo(() => {
    const source = candles.length > 1 ? pivotSource(candles, tf, bars) : null;
    return source ? { ...classicPivots(source.bar), label: source.label } : null;
  }, [candles, tf, bars]);

  const onChartClick = (param: MouseEventParams<Time>) => {
    if (tool === "none" || !param.point || param.logical == null || !candleRef.current) return;
    const price = candleRef.current.coordinateToPrice(param.point.y);
    const index = Math.max(0, Math.min(bars.length - 1, Math.round(param.logical)));
    if (price == null || !bars[index]) return;
    const point = { t: bars[index].t, price };
    if (tool === "hline") {
      commitDrawings([...drawings, { kind: "hline", price }]);
      setTool("none");
    } else if (!pending) {
      setPending(point);
    } else {
      if (point.t !== pending.t) commitDrawings([...drawings, { kind: "trend", a: pending, b: point }]);
      setPending(null);
      setTool("none");
    }
  };
  useEffect(() => {
    clickRef.current = onChartClick;
  });

  const paneKeys = PANES.filter((p) => settings.on[p.key]).map((p) => p.key);
  const height = fullscreen ? Math.max(360, viewportHeight - 150) : 400 + paneKeys.length * 110;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length < 2) return;
    const theme = themeColors(wrapperRef.current ?? el);
    const scaleMode = settings.scale === "log" ? PriceScaleMode.Logarithmic : settings.scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: theme.background },
        textColor: theme.text,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: theme.border, separatorHoverColor: theme.border, enableResize: true },
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border, mode: scaleMode },
      timeScale: { borderColor: theme.border, rightOffset: settings.on.ichi ? 28 : 4, minBarSpacing: 1, timeVisible: !!intradayTf, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p: number) => formatPrice(p) },
      handleScale: { axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    // Intraday bars need real timestamps; Lightweight Charts shows UTC, so shift by +5:30 to read IST.
    const time = (t: number) => (intradayTf ? ((Math.floor(t / 1000) + IST_OFFSET_MS / 1000) as UTCTimestamp) : (dayString(t) as Time));
    const lastT = bars[bars.length - 1].t;
    const barGap = intradayTf ? Number(intradayTf) * 60_000 : tf === "D" ? DAY_MS : tf === "W" ? 7 * DAY_MS : 30 * DAY_MS;
    const timeAt = (i: number) => (i < bars.length ? time(bars[i].t) : time(lastT + (i - bars.length + 1) * barGap));
    const line = (values: Series, color: string, opts: { pane?: number; width?: 1 | 2; style?: LineStyle; title?: string } = {}) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: opts.width ?? 1,
        lineStyle: opts.style ?? LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: !!opts.title,
        title: opts.title ?? "",
        crosshairMarkerVisible: false,
      }, opts.pane ?? 0);
      s.setData(values.flatMap((v, i) => (v == null ? [] : [{ time: timeAt(i), value: v }])));
      return s;
    };
    const guide = (series: ISeriesApi<"Line">, price: number) =>
      series.createPriceLine({ price, color: theme.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      priceLineStyle: LineStyle.Dotted,
    });
    candleSeries.setData(bars.map((b) => ({ time: time(b.t), open: b.open, high: b.high, low: b.low, close: b.close })));
    candleRef.current = candleSeries;
    createTextWatermark(chart.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [
        { text: symbol, color: theme.watermark, fontSize: 56, fontStyle: "bold" },
        { text: `NSE · ${tfShortOf(tf)}`, color: theme.watermark, fontSize: 18 },
      ],
    });

    if (settings.on.volume) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(bars.map((b) => ({ time: time(b.t), value: b.volume, color: b.close >= b.open ? "rgba(8,153,129,0.35)" : "rgba(242,54,69,0.35)" })));
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    }

    if (ind.ma) {
      line(ind.ma[0], COLORS.ma20);
      line(ind.ma[1], COLORS.ma50);
      line(ind.ma[2], COLORS.ma200, { style: LineStyle.Dashed });
    }
    if (ind.bb) {
      line(ind.bb.upper, COLORS.bb);
      line(ind.bb.mid, COLORS.bb, { style: LineStyle.Dotted });
      line(ind.bb.lower, COLORS.bb);
    }
    if (ind.st) {
      line(ind.st.up, COLORS.up, { width: 2 });
      line(ind.st.down, COLORS.down, { width: 2 });
    }
    if (ind.ichi) {
      const ichi = ind.ichi;
      line(ichi.tenkan, COLORS.tenkan);
      line(ichi.kijun, COLORS.kijun);
      line([...ichi.spanA, ...ichi.futureA], COLORS.spanA, { style: LineStyle.Dashed });
      line([...ichi.spanB, ...ichi.futureB], COLORS.spanB, { style: LineStyle.Dashed });
    }

    if (settings.on.levels) {
      for (const level of sr) {
        candleSeries.createPriceLine({
          price: level.price,
          color: level.kind === "support" ? COLORS.support : COLORS.resistance,
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: `${level.kind === "support" ? "S" : "R"}${level.flipped ? "↺" : ""} ×${level.touches}`,
        });
      }
    }
    if (settings.on.pivots && pivots) {
      for (const [key, title] of [["r3", "R3"], ["r2", "R2"], ["r1", "R1"], ["p", "P"], ["s1", "S1"], ["s2", "S2"], ["s3", "S3"]] as const) {
        candleSeries.createPriceLine({ price: pivots[key], color: COLORS.pivot, lineWidth: 1, lineStyle: key === "p" ? LineStyle.Solid : LineStyle.LargeDashed, axisLabelVisible: false, title });
      }
    }

    const markers: SeriesMarker<Time>[] = [];
    if (settings.on.patterns && patterns.length) {
      markers.push(...patterns.map((p): SeriesMarker<Time> => ({
        time: time(p.t),
        position: p.bias === "bullish" ? "belowBar" : "aboveBar",
        shape: p.bias === "bullish" ? "arrowUp" : "arrowDown",
        color: p.bias === "bullish" ? COLORS.up : COLORS.down,
        text: CANDLE_PATTERNS[p.key].short,
        size: 0.8,
      })));
    }

    if (arbm) {
      const { upper, lower, squeeze } = arbm.bands;
      const bandData = (values: (number | null)[]) =>
        values.flatMap((v, i) => (v == null ? [] : [{ time: time(bars[i].t), value: v, color: squeeze[i] ? COLORS.arbmSqueeze : COLORS.arbmBand }]));
      for (const values of [upper, lower]) {
        const s = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
        s.setData(bandData(values));
      }
      // Trades never overlap, so alternating two sets of series leaves a gap bar between neighbouring trades.
      const mapLine = (color: string, style: LineStyle, width: 1 | 2, value: (trade: ArbmTrade, k: number) => number) => {
        for (const parity of [0, 1]) {
          const data: ({ time: Time; value: number } | { time: Time })[] = bars.map((b) => ({ time: time(b.t) }));
          arbm.trades.forEach((trade, n) => {
            if (n % 2 !== parity) return;
            const end = trade.exitIndex ?? bars.length - 1;
            for (let i = trade.signalIndex; i <= end; i++) data[i] = { time: time(bars[i].t), value: value(trade, i - trade.signalIndex) };
          });
          const s = chart.addSeries(LineSeries, {
            color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null,
          });
          s.setData(data);
        }
      };
      mapLine(COLORS.arbmEntry, LineStyle.Solid, 2, (trade) => trade.entry);
      mapLine(COLORS.arbmStop, LineStyle.Solid, 2, (trade, k) => trade.stopPath[k] ?? trade.stopPath[trade.stopPath.length - 1]);
      for (const n of [0, 1, 2] as const) mapLine(COLORS.arbmTarget, LineStyle.Dashed, 1, (trade) => trade.targets[n]);
      for (const [trend, color] of [[arbm.trendHigh, COLORS.arbmTrendHigh], [arbm.trendLow, COLORS.arbmTrendLow]] as const) {
        if (!trend) continue;
        const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
        s.setData([{ time: time(bars[trend.from.index].t), value: trend.from.price }, { time: time(bars[bars.length - 1].t), value: trend.last }]);
      }
      for (const trade of arbm.trades) {
        const long = trade.dir === 1;
        markers.push({
          time: time(bars[trade.signalIndex].t),
          position: long ? "belowBar" : "aboveBar",
          shape: long ? "arrowUp" : "arrowDown",
          color: long ? COLORS.up : COLORS.down,
          text: long ? "Breakout, Long" : "Breakout, Short",
        });
        for (const e of trade.events) {
          const text = e.kind === "tp1" ? "TP1 · stop to entry" : e.kind === "tp2" ? "TP2 · stop to TP1" : e.kind === "tp3" ? "TP3 hit (closed)"
            : trade.outcome === "stop" ? "Stop loss hit" : trade.outcome === "breakeven" ? "Out at entry" : "Out at TP1";
          const good = e.kind !== "stop" || trade.outcome !== "stop";
          markers.push({
            time: time(bars[e.index].t),
            position: long === (e.kind === "stop") ? "belowBar" : "aboveBar",
            shape: "circle",
            color: e.kind === "stop" ? (good ? COLORS.arbmEntry : COLORS.arbmStop) : e.kind === "tp3" ? COLORS.arbmTarget : COLORS.arbmEntry,
            text,
            size: 0.7,
          });
        }
      }
    }
    if (markers.length) {
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      createSeriesMarkers(candleSeries, markers);
    }

    for (const d of drawings) {
      if (d.kind === "hline") {
        candleSeries.createPriceLine({ price: d.price, color: COLORS.drawing, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" });
        continue;
      }
      const ia = barIndexAt(bars, d.a.t);
      const ib = barIndexAt(bars, d.b.t);
      if (ia == null || ib == null || ia === ib) continue;
      const [p, q] = ia < ib ? [{ i: ia, v: d.a.price }, { i: ib, v: d.b.price }] : [{ i: ib, v: d.b.price }, { i: ia, v: d.a.price }];
      const s = chart.addSeries(LineSeries, { color: COLORS.drawing, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData([{ time: time(bars[p.i].t), value: p.v }, { time: time(bars[q.i].t), value: q.v }]);
    }
    if (pending) {
      const i = barIndexAt(bars, pending.t);
      if (i != null) {
        createSeriesMarkers(candleSeries, [{ time: time(bars[i].t), position: "atPriceMiddle", price: pending.price, shape: "circle", color: COLORS.drawing, size: 1 }]);
      }
    }

    let pane = 1;
    for (const key of paneKeys) {
      if (key === "rsi" && ind.rsi) {
        const r = line(ind.rsi, COLORS.rsi, { pane, title: " " });
        guide(r, 70);
        guide(r, 30);
      } else if (key === "macd" && ind.macd) {
        const m = ind.macd;
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        hist.setData(m.line.flatMap((v, i) => {
          const s = m.signal[i];
          if (v == null || s == null) return [];
          const h = v - s;
          return [{ time: time(bars[i].t), value: h, color: h >= 0 ? "rgba(8,153,129,0.5)" : "rgba(242,54,69,0.5)" }];
        }));
        line(m.line, COLORS.macd, { pane, title: " " });
        line(m.signal, COLORS.signal, { pane });
      } else if (key === "stoch" && ind.stoch) {
        const k = line(ind.stoch.k, COLORS.macd, { pane, title: " " });
        line(ind.stoch.d, COLORS.signal, { pane });
        guide(k, 80);
        guide(k, 20);
      } else if (key === "adx" && ind.adx) {
        const main = line(ind.adx.adx, theme.dark || settings.dark ? "#e2e8f0" : "#0f172a", { pane, width: 2, title: " " });
        line(ind.adx.plusDi, COLORS.up, { pane });
        line(ind.adx.minusDi, COLORS.down, { pane });
        guide(main, 25);
      } else if (key === "atr" && ind.adx) {
        line(ind.adx.atr, COLORS.ma50, { pane, title: " " });
      }
      pane += 1;
    }
    const allPanes = chart.panes();
    if (allPanes.length > 1) {
      allPanes[0].setStretchFactor(3.4);
      for (let k = 1; k < allPanes.length; k += 1) {
        allPanes[k].setStretchFactor(1);
        // Log/% apply to price only; oscillator panes keep their natural scale.
        allPanes[k].priceScale("right").applyOptions({ mode: PriceScaleMode.Normal });
      }
    }
    // Pane legends sit at each pane's top edge, which moves when panes are resized.
    const measurePanes = () => {
      const tops: number[] = [];
      let y = 0;
      for (const p of chart.panes()) {
        tops.push(y);
        y += p.getHeight() + 1;
      }
      setPaneTops((prev) => (prev.length === tops.length && prev.every((v, i) => Math.abs(v - tops[i]) < 1) ? prev : tops));
    };
    const raf = requestAnimationFrame(measurePanes);

    const indexByTime = new Map(bars.map((b, i) => [String(time(b.t)), i]));
    const onMove = (param: MouseEventParams<Time>) => {
      setHoverIndex(param.time != null ? indexByTime.get(String(param.time)) ?? null : null);
      measurePanes();
    };
    const onClick = (param: MouseEventParams<Time>) => clickRef.current(param);
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);

    const ts = chart.timeScale();
    if (logicalRef.current && viewSymbolRef.current === symbol) {
      // When the latest bar was in view, keep it in view as history loads or new bars arrive.
      const saved = logicalRef.current;
      const shift = saved.to >= barCountRef.current - 1 ? bars.length - barCountRef.current : 0;
      ts.setVisibleLogicalRange({ from: saved.from + shift, to: saved.to + shift });
    } else if (intradayTf) {
      ts.setVisibleLogicalRange({ from: Math.max(0, bars.length - INTRADAY_TIMEFRAMES[intradayTf].visibleBars) - 0.5, to: bars.length + 3 });
    } else {
      const option = RANGES.find((r) => r.label === range) ?? RANGES[RANGES.length - 1];
      if (option.months == null) {
        ts.fitContent();
      } else {
        const from = new Date(lastT);
        from.setMonth(from.getMonth() - option.months);
        const firstIndex = Math.max(0, bars.findIndex((b) => b.t >= from.getTime()));
        ts.setVisibleLogicalRange({ from: firstIndex - 0.5, to: bars.length + 3 });
      }
    }

    return () => {
      logicalRef.current = ts.getVisibleLogicalRange();
      barCountRef.current = bars.length;
      viewSymbolRef.current = symbol;
      cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
    // paneKeys is derived from settings.on, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, ind, patterns, arbm, pivots, range, resetNonce, settings, sr, symbol, themeVersion, drawings, pending, tf, intradayTf]);

  // Plan levels move with the live price, so they are patched onto the existing series instead of rebuilding the chart.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const lines = levels.map((level) =>
      series.createPriceLine({ price: level.value, color: level.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: level.label }));
    return () => {
      if (candleRef.current === series) lines.forEach((l) => series.removePriceLine(l));
    };
  }, [levels, bars, ind, patterns, arbm, pivots, range, resetNonce, settings, sr, themeVersion, drawings, pending]);

  const download = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const link = document.createElement("a");
    link.download = `${symbol}-${tfShortOf(tf)}-${dayString(bars[bars.length - 1].t)}.png`;
    link.href = chart.takeScreenshot().toDataURL("image/png");
    link.click();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const ts = chartRef.current?.timeScale();
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (ctrl && event.shiftKey && key === "s") { handled(); download(); return; }
    if (ctrl && key === "l") { handled(); setScale("log"); return; }
    if (ctrl && key === "p") { handled(); setScale("percent"); return; }
    if (ctrl && key === "z") { handled(); undo(); return; }
    if (ctrl && key === "y") { handled(); redoLast(); return; }
    if (event.altKey && key === "r") { handled(); resetView(); return; }
    if (ctrl || event.altKey) return;
    if (key === "d" || key === "w" || key === "m") { handled(); setTimeframe(key.toUpperCase() as ChartTimeframe); return; }
    if (key === "t") { handled(); chooseTool("trend"); return; }
    if (key === "h") { handled(); chooseTool("hline"); return; }
    if (key === "?") { handled(); setShowKeys((v) => !v); return; }
    if (key === "f") { handled(); toggleFullscreen(); return; }
    if (event.key === "Escape" && (tool !== "none" || pending)) { handled(); setTool("none"); setPending(null); return; }
    if (!ts) return;
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const span = r.to - r.from;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      handled();
      const shift = Math.max(1, Math.round(span * 0.1)) * (event.key === "ArrowLeft" ? -1 : 1);
      ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      handled();
      const factor = event.key === "ArrowUp" ? 0.8 : 1.25;
      const next = Math.max(10, span * factor);
      ts.setVisibleLogicalRange({ from: r.to - next, to: r.to });
    }
  };

  if (intradayTf && bars.length < 2) {
    return (
      <div className="flex h-[380px] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50">
        {intra.loading ? (
          <>
            <div className="h-2 w-48 animate-pulse rounded-full bg-slate-200" />
            <span className="text-xs font-semibold text-slate-400">Loading {INTRADAY_TIMEFRAMES[intradayTf].label} candles from Fyers…</span>
          </>
        ) : (
          <span className="max-w-md text-center text-xs font-semibold text-slate-500">
            {intra.error ?? `No ${INTRADAY_TIMEFRAMES[intradayTf].label} candles from Fyers for ${symbol}.`}
          </span>
        )}
        <button type="button" onClick={() => setTimeframe("D")} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-white">
          Back to daily
        </button>
      </div>
    );
  }

  if (candles.length < 2) {
    return (
      <div className="flex h-[380px] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50">
        <div className="h-2 w-48 animate-pulse rounded-full bg-slate-200" />
        <div className="h-2 w-32 animate-pulse rounded-full bg-slate-200" />
        <span className="text-xs font-semibold text-slate-400">Loading daily history…</span>
      </div>
    );
  }

  const activeIndex = hoverIndex ?? bars.length - 1;
  const active = bars[Math.min(activeIndex, bars.length - 1)];
  const previous = activeIndex > 0 ? bars[activeIndex - 1] : null;
  const activeChange = previous ? ((active.close - previous.close) / previous.close) * 100 : null;
  const activePatterns = settings.on.patterns ? patternsByIndex.get(activeIndex) ?? [] : [];
  const segment = "flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50";
  const segmentButton = (on: boolean) =>
    `px-2.5 py-1 text-[11px] font-black transition ${on ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`;
  const smallButton = (on = false) =>
    `rounded-lg border px-2 py-1 text-[11px] font-black transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"}`;
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold transition ${on ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500 hover:text-slate-800"}`;
  const toolHint = tool === "trend" ? (pending ? "Click the second point" : "Click the first point of the trend line") : tool === "hline" ? "Click a price for the horizontal line" : null;
  const tfShort = tfShortOf(tf);
  const barTone = active.close >= active.open ? "text-[#089981]" : "text-[#f23645]";
  const at = (s: Series | (number | null)[]) => s[activeIndex] ?? null;
  const macdHist = ind.macd && ind.macd.line[activeIndex] != null && ind.macd.signal[activeIndex] != null
    ? ind.macd.line[activeIndex]! - ind.macd.signal[activeIndex]!
    : null;
  // themeVersion re-renders this when the app theme flips.
  const appDark = themeVersion >= 0 && document.documentElement.getAttribute("data-theme") === "dark";
  const dark = settings.dark || appDark;

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-theme={settings.dark ? "dark" : undefined}
      style={{ color: "var(--foreground)" }}
      className={`relative border border-slate-200 bg-white p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${fullscreen ? "overflow-auto rounded-none" : "rounded-2xl"}`}
      aria-label={`${symbol} chart. Press ? for keyboard shortcuts.`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {intraday && (
            <div className={segment} role="group" aria-label="Intraday timeframe (Fyers)">
              {INTRADAY_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  title={`${INTRADAY_TIMEFRAMES[key].label} candles from Fyers`}
                  onClick={() => setTimeframe(key)}
                  className={segmentButton(tf === key)}
                  aria-pressed={tf === key}
                >
                  {INTRADAY_TIMEFRAMES[key].short}
                </button>
              ))}
            </div>
          )}
          <div className={segment} role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button key={t.key} type="button" title={`${t.label} (${t.hotkey})`} onClick={() => setTimeframe(t.key)} className={segmentButton(tf === t.key)} aria-pressed={tf === t.key}>
                {t.label}
              </button>
            ))}
          </div>
          {!intradayTf && (
            <div className={segment} role="group" aria-label="Visible range">
              {RANGES.map((r) => (
                <button key={r.label} type="button" onClick={() => chooseRange(r.label)} className={segmentButton(range === r.label)} aria-pressed={range === r.label}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
          {intradayTf && intra.error && (
            <span className="text-[11px] font-semibold text-amber-700" title={intra.error}>⚠ Refresh failed; showing last data</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => chooseTool("trend")} aria-pressed={tool === "trend"} title="Trend line (T): click two points" className={smallButton(tool === "trend")}>╱ Line</button>
          <button type="button" onClick={() => chooseTool("hline")} aria-pressed={tool === "hline"} title="Horizontal line (H): click a price" className={smallButton(tool === "hline")}>― H-line</button>
          <button type="button" onClick={undo} disabled={!drawings.length} title="Undo drawing (Ctrl+Z)" className={`${smallButton()} disabled:opacity-40`}>↶</button>
          <button type="button" onClick={redoLast} disabled={!redo.length} title="Redo drawing (Ctrl+Y)" className={`${smallButton()} disabled:opacity-40`}>↷</button>
          <button type="button" onClick={() => commitDrawings([])} disabled={!drawings.length} title="Remove all drawings on this stock" className={`${smallButton()} disabled:opacity-40`}>Clear</button>
          <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
          <button type="button" onClick={() => setScale("log")} aria-pressed={settings.scale === "log"} title="Logarithmic scale (Ctrl+L)" className={smallButton(settings.scale === "log")}>Log</button>
          <button type="button" onClick={() => setScale("percent")} aria-pressed={settings.scale === "percent"} title="Percent scale from the first visible bar (Ctrl+P)" className={smallButton(settings.scale === "percent")}>%</button>
          <button type="button" onClick={resetView} title="Reset view (Alt+R)" className={smallButton()}>Reset</button>
          <button type="button" onClick={download} title="Download PNG (Ctrl+Shift+S)" className={smallButton()}>PNG</button>
          <button
            type="button"
            onClick={() => update({ ...settings, dark: !settings.dark })}
            disabled={appDark}
            aria-pressed={dark}
            title={appDark ? "The app is already in dark mode" : "Dark chart (like TradingView) while the app stays light"}
            className={`${smallButton(dark)} disabled:opacity-60`}
          >
            ☾ Dark
          </button>
          <button type="button" onClick={toggleFullscreen} aria-pressed={fullscreen} title="Full screen (F); Esc to leave" className={smallButton(fullscreen)}>⛶ {fullscreen ? "Exit" : "Full screen"}</button>
          <button type="button" onClick={() => setShowKeys((v) => !v)} aria-expanded={showKeys} title="Keyboard shortcuts (?)" className={smallButton(showKeys)}>?</button>
        </div>
      </div>

      {showKeys && (
        <div className="mb-2 grid gap-x-6 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 sm:grid-cols-2">
          <div className="col-span-full text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Shortcuts · click the chart first</div>
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex justify-between gap-3"><kbd className="font-mono font-bold text-slate-800">{keys}</kbd><span>{action}</span></div>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Indicators">
        <span className="text-[10.5px] font-black uppercase tracking-[0.14em] text-slate-400">Overlays</span>
        {OVERLAYS.map((t) => (
          <button key={t.key} type="button" title={t.hint} onClick={() => toggle(t.key)} aria-pressed={settings.on[t.key]} className={chip(settings.on[t.key])}>
            {settings.on[t.key] ? "✓ " : ""}{t.label}
          </button>
        ))}
        <span className="ml-2 text-[10.5px] font-black uppercase tracking-[0.14em] text-slate-400">Panes</span>
        {PANES.map((t) => (
          <button key={t.key} type="button" title={t.hint} onClick={() => toggle(t.key)} aria-pressed={settings.on[t.key]} className={chip(settings.on[t.key])}>
            {settings.on[t.key] ? "✓ " : ""}{t.label}
          </button>
        ))}
      </div>

      {(activePatterns.length > 0 || toolHint) && (
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          {activePatterns.map((p) => (
            <span key={p.key} title={CANDLE_PATTERNS[p.key].desc} className={`font-bold ${p.bias === "bullish" ? "text-emerald-700" : "text-rose-700"}`}>
              {p.bias === "bullish" ? "▲" : "▼"} {p.label}
            </span>
          ))}
          {toolHint && <span className="font-bold text-blue-700">✎ {toolHint} · Esc to cancel</span>}
        </div>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className={`w-full ${tool !== "none" ? "cursor-crosshair" : ""}`}
          role="img"
          aria-label={`${symbol} ${tfNameOf(tf)} candlestick chart`}
        />
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 space-y-0.5 font-mono text-[11px] text-slate-500">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="font-sans text-[13px] font-black text-slate-800">{symbol}</span>
            <span className="font-sans font-bold text-slate-400">· {tfShort} · NSE</span>
            <span>O<b className={`ml-1 ${barTone}`}>{formatPrice(active.open)}</b></span>
            <span>H<b className={`ml-1 ${barTone}`}>{formatPrice(active.high)}</b></span>
            <span>L<b className={`ml-1 ${barTone}`}>{formatPrice(active.low)}</b></span>
            <span>C<b className={`ml-1 ${barTone}`}>{formatPrice(active.close)}</b></span>
            {activeChange != null && previous && (
              <b className={barTone}>{active.close - previous.close >= 0 ? "+" : ""}{formatPrice(active.close - previous.close)} ({formatPercent(activeChange)})</b>
            )}
            <span className="font-sans text-slate-400">{dateLabel(active.t, tf)}</span>
          </div>
          {settings.on.volume && (
            <LegendRow name="Vol" onRemove={() => toggle("volume")}>
              <b className={barTone}>{formatVolume(active.volume)}</b>
            </LegendRow>
          )}
          {ind.ma && (
            <LegendRow name="MA" inputs={paramSummary("ma", params)} onEdit={() => setEditing("ma")} onRemove={() => toggle("ma")}>
              <Val v={at(ind.ma[0])} color={COLORS.ma20} />
              <Val v={at(ind.ma[1])} color={COLORS.ma50} />
              <Val v={at(ind.ma[2])} color={COLORS.ma200} />
            </LegendRow>
          )}
          {ind.bb && (
            <LegendRow name="BB" inputs={paramSummary("bb", params)} onEdit={() => setEditing("bb")} onRemove={() => toggle("bb")}>
              <Val v={at(ind.bb.mid)} color={COLORS.bb} />
              <Val v={at(ind.bb.upper)} color={COLORS.bb} />
              <Val v={at(ind.bb.lower)} color={COLORS.bb} />
            </LegendRow>
          )}
          {ind.st && (
            <LegendRow name="Supertrend" inputs={paramSummary("st", params)} onEdit={() => setEditing("st")} onRemove={() => toggle("st")}>
              {at(ind.st.up) != null ? <Val v={at(ind.st.up)} color={COLORS.up} /> : <Val v={at(ind.st.down)} color={COLORS.down} />}
            </LegendRow>
          )}
          {ind.ichi && (
            <LegendRow name="Ichimoku" inputs="9 26 52 26" onRemove={() => toggle("ichi")}>
              <Val v={at(ind.ichi.tenkan)} color={COLORS.tenkan} />
              <Val v={at(ind.ichi.kijun)} color={COLORS.kijun} />
              <Val v={at(ind.ichi.spanA)} color={COLORS.spanA} />
              <Val v={at(ind.ichi.spanB)} color={COLORS.spanB} />
            </LegendRow>
          )}
          {arbm && (
            <LegendRow name="Regression Breakout" inputs={paramSummary("arbm", params)} onEdit={() => setEditing("arbm")} onRemove={() => toggle("arbm")}>
              <Val v={at(arbm.bands.upper)} color={arbm.bands.squeeze[activeIndex] ? COLORS.arbmSqueeze : COLORS.arbmBand} />
              <Val v={at(arbm.bands.lower)} color={arbm.bands.squeeze[activeIndex] ? COLORS.arbmSqueeze : COLORS.arbmBand} />
              {arbm.bands.squeeze[activeIndex] && <span className="font-sans font-bold text-slate-400">squeeze</span>}
            </LegendRow>
          )}
        </div>
        {paneKeys.map((key, k) => {
          const top = paneTops[k + 1];
          if (top == null) return null;
          return (
            <div key={key} className="pointer-events-none absolute left-2 z-10 font-mono text-[11px] text-slate-500" style={{ top: top + 4 }}>
              {key === "rsi" && ind.rsi && (
                <LegendRow name="RSI" inputs={paramSummary("rsi", params)} onEdit={() => setEditing("rsi")} onRemove={() => toggle("rsi")}>
                  <Val v={at(ind.rsi)} color={COLORS.rsi} digits={2} />
                </LegendRow>
              )}
              {key === "macd" && ind.macd && (
                <LegendRow name="MACD" inputs="12 26 9" onRemove={() => toggle("macd")}>
                  <Val v={macdHist} color={(macdHist ?? 0) >= 0 ? COLORS.up : COLORS.down} digits={2} />
                  <Val v={at(ind.macd.line)} color={COLORS.macd} digits={2} />
                  <Val v={at(ind.macd.signal)} color={COLORS.signal} digits={2} />
                </LegendRow>
              )}
              {key === "stoch" && ind.stoch && (
                <LegendRow name="Stoch" inputs="14 3 3" onRemove={() => toggle("stoch")}>
                  <Val v={at(ind.stoch.k)} color={COLORS.macd} digits={2} />
                  <Val v={at(ind.stoch.d)} color={COLORS.signal} digits={2} />
                </LegendRow>
              )}
              {key === "adx" && ind.adx && (
                <LegendRow name="ADX" inputs="14" onRemove={() => toggle("adx")}>
                  <Val v={at(ind.adx.adx)} color={settings.dark || appDark ? "#e2e8f0" : "#0f172a"} digits={2} />
                  <Val v={at(ind.adx.plusDi)} color={COLORS.up} digits={2} />
                  <Val v={at(ind.adx.minusDi)} color={COLORS.down} digits={2} />
                </LegendRow>
              )}
              {key === "atr" && ind.adx && (
                <LegendRow name="ATR" inputs="14" onRemove={() => toggle("atr")}>
                  <Val v={at(ind.adx.atr)} color={COLORS.ma50} />
                </LegendRow>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
        {settings.on.pivots && pivots && <Legend color={COLORS.pivot} label={`Pivots from ${pivots.label}`} dashed />}
        {levels.map((level) => <Legend key={level.label} color={level.color} label={level.label} dashed />)}
        {settings.on.levels && sr.length > 0 && (
          <span title="S/R = clustered swing highs/lows; ×n = touches; ↺ = flipped (old resistance now support, or the reverse)" className="inline-flex gap-3">
            <Legend color={COLORS.support} label="Support" dashed />
            <Legend color={COLORS.resistance} label="Resistance" dashed />
            <span>×n touches · ↺ flipped</span>
          </span>
        )}
        {settings.on.patterns && <span>Patterns: last 120 bars · context only, no backtested edge</span>}
        <span className="ml-auto text-slate-400">Scroll to zoom · drag to pan · hover a legend row for ⚙ settings · ? for shortcuts</span>
      </div>
      {arbm && <ArbmPanel map={arbm} bars={bars} timeframe={tf} />}
      {editing && (
        <ParamsDialog
          key={editing}
          group={editing}
          params={params}
          onClose={() => setEditing(null)}
          onSave={(next) => { saveParams(next); setEditing(null); }}
        />
      )}
    </div>
  );
}

const GROUP_TITLES: Record<ParamGroup, string> = {
  ma: "Moving averages",
  bb: "Bollinger Bands",
  st: "Supertrend",
  rsi: "RSI",
  arbm: "Regression Breakout",
};

function ParamsDialog({ group, params, onClose, onSave }: { group: ParamGroup; params: ChartParams; onClose: () => void; onSave: (next: ChartParams) => void }) {
  const keys = PARAM_GROUPS[group] as readonly ParamKey[];
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String(params[k])])));
  const submit = () => {
    const next = { ...params };
    for (const k of keys) next[k] = cleanParam(k, draft[k]);
    onSave(next);
  };
  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-slate-950/40 pt-24"
      onClick={onClose}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        if (e.key === "Enter") submit();
      }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-label={`${GROUP_TITLES[group]} settings`} onClick={(e) => e.stopPropagation()} className="w-80 rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <span className="text-sm font-black text-slate-800">{GROUP_TITLES[group]}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800">✕</button>
        </div>
        <div className="px-4 pt-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Inputs</div>
        <div className="space-y-2 px-4 py-2">
          {keys.map((k, n) => {
            const d = PARAM_DEFS[k];
            return (
              <label key={k} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>{d.label}</span>
                <input
                  type="number"
                  autoFocus={n === 0}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right font-mono text-xs text-slate-800 outline-none focus:border-blue-400"
                />
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5">
          <button type="button" onClick={() => setDraft(Object.fromEntries(keys.map((k) => [k, String(DEFAULT_PARAMS[k])])))} className="text-xs font-bold text-slate-500 hover:text-slate-800">
            Defaults
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
            <button type="button" onClick={submit} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-bold text-white">Ok</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ name, inputs, onEdit, onRemove, children }: { name: string; inputs?: string; onEdit?: () => void; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="group pointer-events-auto flex w-fit flex-wrap items-baseline gap-x-2 rounded px-1 -mx-1 hover:bg-slate-100/80">
      <span className="font-sans font-bold text-slate-600">{name}</span>
      {inputs && <span className="text-slate-400">{inputs}</span>}
      {children}
      <span className="invisible inline-flex gap-1 font-sans group-hover:visible">
        {onEdit && <button type="button" onClick={onEdit} title="Settings" aria-label={`${name} settings`} className="px-0.5 text-slate-500 hover:text-slate-900">⚙</button>}
        <button type="button" onClick={onRemove} title="Remove" aria-label={`Remove ${name}`} className="px-0.5 text-slate-500 hover:text-rose-600">✕</button>
      </span>
    </div>
  );
}

function Val({ v, color, digits }: { v: number | null; color: string; digits?: number }) {
  return <b style={{ color }}>{v == null ? "—" : digits != null ? v.toFixed(digits) : formatPrice(v)}</b>;
}

function ArbmPanel({ map, bars, timeframe }: { map: ArbmMap; bars: Candle[]; timeframe: Timeframe }) {
  const last = bars.length - 1;
  const { upper, lower, squeeze, widthPct } = map.bands;
  const open = map.open;
  const lastTrade = map.trades[map.trades.length - 1] ?? null;
  const { indicator, real } = map.stats;
  const card = "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2";
  const head = "text-[10.5px] font-black uppercase tracking-[0.14em] text-slate-400";
  const row = "flex justify-between gap-3";
  const signed = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
  const tone = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-700");
  const hit = (trade: ArbmTrade, kind: "tp1" | "tp2") => trade.events.some((e) => e.kind === kind);
  const currentStop = open ? open.stopPath[open.stopPath.length - 1] ?? open.initialStop : null;
  const outcomeLabel: Record<ArbmTrade["outcome"], string> = {
    tp3: "TP3 hit", stop: "Stopped out", breakeven: "Out at entry after TP1", trail: "Out at TP1 after TP2", open: "Open",
  };

  return (
    <div className="mt-3 grid gap-2 text-[11px] text-slate-600 md:grid-cols-4">
      <div className={card}>
        <div className={head}>Channel now</div>
        <div className="mt-1 font-black text-slate-800">
          {upper[last] == null ? "Needs 150 bars of history" : squeeze[last] ? "In a squeeze (grey)" : "Normal width"}
        </div>
        {upper[last] != null && (
          <div className="mt-1 space-y-0.5 font-mono">
            <div className={row}><span>Upper band</span><b className="text-slate-800">{formatPrice(upper[last]!)}</b></div>
            <div className={row}><span>Lower band</span><b className="text-slate-800">{formatPrice(lower[last]!)}</b></div>
            {widthPct[last] != null && <div className={row}><span title="0% = narrowest of the last 100 bars">Width rank</span><b className="text-slate-800">{widthPct[last]!.toFixed(0)}%</b></div>}
          </div>
        )}
      </div>

      <div className={card}>
        <div className={head}>{open ? "Open trade" : "Last trade"}</div>
        {open ? (
          <div className="mt-1 space-y-0.5 font-mono">
            <div className="font-sans font-black text-slate-800">{open.dir === 1 ? "Long" : "Short"} from {dateLabel(open.signalT, timeframe)}</div>
            <div className={row}><span>Entry</span><b>{formatPrice(open.entry)}</b></div>
            <div className={row}><span>Stop now</span><b className="text-rose-700">{formatPrice(currentStop!)}</b></div>
            {open.targets.map((tp, n) => (
              <div key={n} className={row}><span>TP{n + 1}{n < 2 && hit(open, n === 0 ? "tp1" : "tp2") ? " ✓" : ""}</span><b className="text-emerald-700">{formatPrice(tp)}</b></div>
            ))}
            <div className={row}><span>P/L now</span><b className={tone(open.returnPct)}>{signed(open.returnPct)}%</b></div>
          </div>
        ) : lastTrade ? (
          <div className="mt-1 space-y-0.5 font-mono">
            <div className="font-sans font-black text-slate-800">{lastTrade.dir === 1 ? "Long" : "Short"} from {dateLabel(lastTrade.signalT, timeframe)}</div>
            <div className={row}><span>Result</span><b>{outcomeLabel[lastTrade.outcome]}</b></div>
            <div className={row}><span>Return</span><b className={tone(lastTrade.returnPct)}>{signed(lastTrade.returnPct)}%</b></div>
            <div className={row}><span>Initial stop</span><b>{((Math.abs(lastTrade.entry - lastTrade.initialStop) / lastTrade.entry) * 100).toFixed(1)}% away</b></div>
          </div>
        ) : (
          <div className="mt-1 text-slate-500">No breakout from a squeeze in this history.</div>
        )}
      </div>

      <div className={card}>
        <div className={head} title="Exactly as GainzAlgo's on-chart table counts it">Map performance (indicator&apos;s own)</div>
        <div className="mt-1 space-y-0.5 font-mono">
          <div className={row}><span>Total signals</span><b className="text-slate-800">{indicator.trades}</b></div>
          <div className={row}><span>Win rate</span><b className={indicator.winRate >= 50 ? "text-emerald-700" : "text-rose-700"}>{indicator.winRate.toFixed(1)}%</b></div>
          <div className={row}><span>Trade Sharpe</span><b className="text-slate-800">{indicator.sharpe.toFixed(2)}</b></div>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">Counts &quot;TP1 hit, then out at entry&quot; as a win.</div>
      </div>

      <div className={card}>
        <div className={head}>Real result on this chart</div>
        <div className="mt-1 space-y-0.5 font-mono">
          <div className={row}><span>Closed trades</span><b className="text-slate-800">{real.trades}</b></div>
          <div className={row}><span>Made money</span><b className="text-slate-800">{real.winRate.toFixed(1)}%</b></div>
          <div className={row}><span>Avg per trade</span><b className={tone(real.avgReturnPct)}>{signed(real.avgReturnPct)}%</b></div>
          <div className={row}><span>Avg R</span><b className={tone(real.avgR)}>{signed(real.avgR)}R</b></div>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">Before costs. Across NSE (2022–26) it lost −0.09R a trade with a ~16% median stop.</div>
      </div>
    </div>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {label}
    </span>
  );
}
