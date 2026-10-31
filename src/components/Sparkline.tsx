import type { PricePoint } from "@/lib/market/types";

interface SparklineProps {
  points: PricePoint[];
  /** Session baseline; the line is tinted against it and drawn as a reference. */
  baseline?: number;
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({
  points,
  baseline,
  width = 96,
  height = 28,
  className = "",
}: SparklineProps) {
  if (points.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden />;
  }

  const values = points.map((p) => p.p);
  const min = Math.min(...values, baseline ?? Infinity);
  const max = Math.max(...values, baseline ?? -Infinity);
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / span) * height;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.p).toFixed(2)}`).join(" ");
  const last = values[values.length - 1];
  const reference = baseline ?? values[0];
  const stroke = last >= reference ? "var(--up)" : "var(--down)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Intraday price trend"
    >
      {baseline !== undefined && (
        <line
          x1={0}
          x2={width}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--border)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      )}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
