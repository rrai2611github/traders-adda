"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "sa.accountSize.v1";
const DEFAULT_ACCOUNT_SIZE = 500_000;

function read(): number {
  if (typeof window === "undefined") return DEFAULT_ACCOUNT_SIZE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw != null ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACCOUNT_SIZE;
  } catch {
    return DEFAULT_ACCOUNT_SIZE;
  }
}

/**
 * Account size for the position-size calculator, persisted to localStorage so
 * it does not need re-entering on every stock. Same hydration pattern as
 * `useWatchlist`: default on the server and first paint, then read storage.
 */
export function useAccountSize() {
  const [accountSize, setAccountSizeState] = useState(DEFAULT_ACCOUNT_SIZE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Deliberately synchronous: the first client render must match the server's
    // DEFAULT_ACCOUNT_SIZE markup exactly, so storage is only read after mount
    // (same hydration pattern as useWatchlist). Deferring to a callback would
    // reintroduce the server/client mismatch this avoids.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountSizeState(read());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(accountSize));
    } catch {
      // Storage can be unavailable (private mode, quota) — keep state in memory.
    }
  }, [accountSize, hydrated]);

  const setAccountSize = (value: number) => {
    if (Number.isFinite(value) && value > 0) setAccountSizeState(value);
  };

  return { accountSize, setAccountSize };
}
