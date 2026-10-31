"use client";

import { useEffect, useState } from "react";
import type { IndexContext } from "@/lib/market/indexContext";

export function useIndexContext(mode: "completed" | "live") {
  const [state, setState] = useState<{ context: IndexContext | null; error: string | null }>({ context: null, error: null });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setState({ context: null, error: null });
    const load = async () => {
      try {
        const response = await fetch(`/api/market/index-analysis?mode=${mode}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Index analysis unavailable (HTTP ${response.status}).`);
        const context: IndexContext = await response.json();
        if (alive) setState({ context, error: null });
      } catch (error) {
        if (alive) setState((prior) => ({ ...prior, error: error instanceof Error ? error.message : "Index analysis failed." }));
      } finally {
        if (alive) timer = setTimeout(load, 60_000);
      }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [mode]);
  return state;
}
