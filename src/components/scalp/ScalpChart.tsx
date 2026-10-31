"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "@/lib/scalp/scalpLogic";

export interface ChartLine {
  key: string;
  title: string;
  color: string;
  points: { t: number; v: number }[];
  dashed?: boolean;
}

export interface ChartLevel {
  price: number;
  title: string;
  color: string;
}

export interface ChartMarker {
  t: number;
  up: boolean;
  text: string;
}

// Lightweight Charts renders timestamps as UTC; shift by +5:30 so the axis reads IST.
const ist = (t: number) => (Math.floor(t / 1000) + 19_800) as UTCTimestamp;

const UP = "#22c55e";
const DOWN = "#ef4444";

export function ScalpChart({ title, subtitle, bars, lines = [], levels = [], markers = [], showVolume = true, height = 420 }: {
  title: string;
  subtitle?: string;
  bars: Bar[];
  lines?: ChartLine[];
  levels?: ChartLevel[];
  markers?: ChartMarker[];
  showVolume?: boolean;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeries = useRef(new Map<string, ISeriesApi<"Line">>());
  const priceLines = useRef<IPriceLine[]>([]);
  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const api = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { color: "#0b1220" },
        textColor: "#94a3b8",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderColor: "#334155", scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: 0 },
    });
    candles.current = api.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceLineStyle: LineStyle.Dotted,
    });
    volume.current = api.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    markerApi.current = createSeriesMarkers(candles.current, []);
    chart.current = api;
    const series = lineSeries.current;
    return () => {
      api.remove();
      chart.current = null;
      series.clear();
      priceLines.current = [];
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const api = chart.current;
    const candle = candles.current;
    if (!api || !candle) return;
    candle.setData(bars.map((b) => ({ time: ist(b.t), open: b.open, high: b.high, low: b.low, close: b.close })));
    const hasVolume = showVolume && bars.some((b) => b.volume > 0);
    volume.current?.setData(hasVolume
      ? bars.map((b) => ({ time: ist(b.t), value: b.volume, color: b.close >= b.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)" }))
      : []);

    const keep = new Set(lines.map((l) => l.key));
    for (const [key, s] of lineSeries.current) {
      if (!keep.has(key)) {
        api.removeSeries(s);
        lineSeries.current.delete(key);
      }
    }
    for (const line of lines) {
      let s = lineSeries.current.get(line.key);
      if (!s) {
        s = api.addSeries(LineSeries, {
          color: line.color, lineWidth: 1, title: line.title, priceLineVisible: false, crosshairMarkerVisible: false,
          lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        });
        lineSeries.current.set(line.key, s);
      }
      s.setData(line.points.map((p) => ({ time: ist(p.t), value: p.v })));
    }

    for (const pl of priceLines.current) candle.removePriceLine(pl);
    priceLines.current = levels.map((level) => candle.createPriceLine({
      price: level.price, color: level.color, title: level.title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
    }));

    const barTimes = new Set(bars.map((b) => b.t));
    const marks: SeriesMarker<Time>[] = markers
      .filter((m) => barTimes.has(m.t))
      .map((m) => ({
        time: ist(m.t), position: m.up ? "belowBar" : "aboveBar", shape: m.up ? "arrowUp" : "arrowDown",
        color: m.up ? UP : DOWN, text: m.text,
      }));
    markerApi.current?.setMarkers(marks);

    if (!fitted.current && (bars.length || lines.some((l) => l.points.length))) {
      api.timeScale().fitContent();
      fitted.current = true;
    }
  }, [bars, lines, levels, markers, showVolume]);

  const last = bars[bars.length - 1];
  const first = bars[0];
  const change = last && first ? last.close - first.open : null;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0b1220]">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-100">{title}</div>
          {subtitle ? <div className="truncate text-[11px] text-slate-400">{subtitle}</div> : null}
        </div>
        {last ? (
          <div className="text-right font-mono">
            <div className="text-sm font-bold text-slate-100">{last.close.toFixed(2)}</div>
            {change != null ? (
              <div className={`text-[11px] ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
                {change >= 0 ? "+" : ""}{change.toFixed(2)} today
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div ref={el} style={{ height }} className="relative w-full">
        {!bars.length && !lines.some((l) => l.points.length) ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-slate-500">No 1-minute bars yet</div>
        ) : null}
      </div>
    </section>
  );
}
