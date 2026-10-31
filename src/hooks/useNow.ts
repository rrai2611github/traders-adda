"use client";

import { useSyncExternalStore } from "react";

/**
 * Current time, rounded down to `stepMs`, re-rendering once per step.
 * Null on the server and during hydration so clocks never mismatch.
 */
export function useNow(stepMs = 1000): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, Math.min(stepMs, 1000));
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / stepMs) * stepMs,
    () => null,
  );
}
