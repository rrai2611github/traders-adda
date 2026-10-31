"use client";

import { useNow } from "@/hooks/useNow";
import { formatCountdown, formatIstTime } from "@/lib/format";
import type { ConnectionState, MarketStatus } from "@/lib/market/types";
import type { DataSourceInfo } from "@/hooks/useMarketStream";

const PHASE_STYLES: Record<MarketStatus["phase"], string> = {
  OPEN: "bg-up/15 text-up border-up/30",
  PRE_OPEN: "bg-warn/15 text-warn border-warn/30",
  CLOSED: "bg-muted/10 text-muted border-border",
  HOLIDAY: "bg-muted/10 text-muted border-border",
  WEEKEND: "bg-muted/10 text-muted border-border",
};

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  live: "Streaming",
  connecting: "Connecting…",
  polling: "Polling (5s)",
  offline: "Disconnected",
};

const CONNECTION_STYLES: Record<ConnectionState, string> = {
  live: "bg-up",
  connecting: "bg-warn",
  polling: "bg-accent",
  offline: "bg-down",
};

interface MarketStatusBarProps {
  status: MarketStatus | null;
  connection: ConnectionState;
  dataSource: DataSourceInfo | null;
  lastUpdate: number | null;
}

export function MarketStatusBar({
  status,
  connection,
  dataSource,
  lastUpdate,
}: MarketStatusBarProps) {
  const now = useNow(1000);

  const phase = status?.phase ?? "CLOSED";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${PHASE_STYLES[phase]}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${status?.isLive ? "bg-up pulse-dot" : "bg-current"}`}
        />
        {status?.label ?? "Loading…"}
      </span>

      {status?.nextTransition && status.nextTransitionLabel && now !== null && (
        <span className="text-muted">
          {status.nextTransitionLabel} in{" "}
          <span className="font-semibold text-slate-900">
            {formatCountdown(status.nextTransition, now)}
          </span>
        </span>
      )}

      <span className="inline-flex items-center gap-1.5 text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_STYLES[connection]}`} />
        {CONNECTION_LABELS[connection]}
      </span>

      {lastUpdate && now !== null && (
        <span className="text-muted">
          Updated <span className="font-semibold text-slate-900">{formatIstTime(lastUpdate)}</span> IST
        </span>
      )}

      {now !== null && (
        <span className="ml-auto font-mono text-muted">{formatIstTime(now)} IST</span>
      )}

      {dataSource && !dataSource.isRealtime && (
        <span className="rounded border border-warn/30 bg-warn/10 px-2 py-0.5 text-warn">
          {dataSource.label}
        </span>
      )}
    </div>
  );
}
