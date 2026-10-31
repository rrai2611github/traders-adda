"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isUniverseKey, UNIVERSE_STORAGE_KEY, type UniverseKey } from "@/lib/screen/universeFilter";

const listeners = new Set<() => void>();

function read(): UniverseKey {
  try {
    const value = window.localStorage.getItem(UNIVERSE_STORAGE_KEY);
    return isUniverseKey(value) ? value : "all";
  } catch {
    return "all";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Scanner universe (All NSE, Nifty indices or F&O), remembered in localStorage. */
export function useUniverse(): [UniverseKey, (key: UniverseKey) => void] {
  const universe = useSyncExternalStore(subscribe, read, () => "all" as const);
  const setUniverse = useCallback((key: UniverseKey) => {
    try {
      window.localStorage.setItem(UNIVERSE_STORAGE_KEY, key);
    } catch {
      // Storage can be unavailable (private mode); the view then stays on All NSE.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [universe, setUniverse];
}
