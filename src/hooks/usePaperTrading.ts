"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaperSnapshot } from "@/lib/paper/paperServer";
import type { TodaysPick } from "@/lib/screen/todaysPicks";
import { isDemoPaperOrder, type PaperOrder } from "@/lib/screen/paperTrading";

/** Where the portfolio lived before it moved to the server; read once to migrate, then left as a backup. */
const LEGACY_KEY = "sa.paperTrading.v1";
const MIGRATED_KEY = "sa.paperTrading.v1.migrated";
const POLL_MS = 4_000;

const EMPTY: PaperSnapshot["engine"] = { running: false, lastTickAt: null, pausedReason: null, source: "", quoteAgeMs: null, alerts: false, lastError: null };

async function call(body: unknown): Promise<PaperSnapshot> {
  const response = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json()) as PaperSnapshot & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `Paper request failed (${response.status}).`);
  return json;
}

/**
 * The paper portfolio now lives on the server, where an engine advances orders against live quotes
 * whether or not this page is open. This hook shows that state and sends actions to it.
 */
export function usePaperTrading() {
  const [snapshot, setSnapshot] = useState<PaperSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/paper", { cache: "no-store" });
        const json = (await response.json()) as PaperSnapshot & { error?: string };
        if (!response.ok) throw new Error(json.error ?? `Paper portfolio request failed (${response.status}).`);
        if (disposed) return;
        setSnapshot(json);
        await migrateLegacy(json);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Paper portfolio is unavailable.");
      }
    };
    const migrateLegacy = async (current: PaperSnapshot) => {
      if (current.orders.some((order) => !isDemoPaperOrder(order))) return;
      const raw = window.localStorage.getItem(LEGACY_KEY);
      if (raw === null || window.localStorage.getItem(MIGRATED_KEY) !== null) return;
      const saved = JSON.parse(raw) as { initialCapital?: number; orders?: unknown[] };
      if (!Array.isArray(saved.orders) || !saved.orders.length || typeof saved.initialCapital !== "number") return;
      const next = await call({ action: "import", portfolio: { initialCapital: saved.initialCapital, orders: saved.orders } });
      window.localStorage.setItem(MIGRATED_KEY, raw); // keep the browser copy as a backup
      if (!disposed) setSnapshot(next);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, [visible]);

  const act = useCallback(async (body: unknown): Promise<boolean> => {
    try {
      setSnapshot(await call(body));
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paper action failed.");
      return false;
    }
  }, []);

  const orders: PaperOrder[] = snapshot?.orders ?? [];
  const trackedSymbols = orders.filter((order) => !isDemoPaperOrder(order) && (order.status === "pending" || order.status === "open")).map((order) => order.symbol);

  return {
    initialCapital: snapshot?.initialCapital ?? 500_000,
    orders,
    snapshot,
    engine: snapshot?.engine ?? EMPTY,
    hydrated: snapshot !== null,
    connected: snapshot !== null && snapshot.engine.running && snapshot.engine.pausedReason === null && trackedSymbols.length > 0,
    error,
    clearError: () => setError(null),
    approve: (pick: TodaysPick, signalDate: string) => act({ action: "approve", pick, signalDate }),
    cancel: (id: string) => void act({ action: "cancel", id }),
    closeNow: (id: string, exitPrice: number) => void act({ action: "close", id, exitPrice }),
    setCapital: (value: number) => void act({ action: "capital", value }),
    removeDemo: () => void act({ action: "removeDemo" }),
    trackedSymbols,
  };
}
