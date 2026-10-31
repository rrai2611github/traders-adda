"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
/** What the person chose: a fixed theme, or "auto" to follow the device's light/dark setting. */
export type ThemePreference = Theme | "auto";
export const THEME_STORAGE_KEY = "traders-adda:theme";

const listeners = new Set<() => void>();

// The inline script in app/layout.tsx applies the saved theme before first paint; this reads it back.
function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "auto" ? saved : "light";
  } catch {
    return "light";
  }
}

const deviceIsDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(preference: ThemePreference) {
  const next: Theme = preference === "auto" ? (deviceIsDark() ? "dark" : "light") : preference;
  document.documentElement.setAttribute("data-theme", next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the theme still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // While on Auto, follow the device when it switches (for example at sunset).
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onDeviceChange = () => { if (readPreference() === "auto") apply("auto"); };
  media.addEventListener("change", onDeviceChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onDeviceChange);
  };
}

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = { light: "dark", dark: "auto", auto: "light" };

/**
 * Light/dark theme stored in localStorage and applied as `data-theme` on <html>.
 * Returns [shown theme, flip light/dark, saved preference, step through light → dark → auto].
 */
export function useTheme(): [Theme, () => void, ThemePreference, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as const);
  const preference = useSyncExternalStore(subscribe, readPreference, () => "light" as const);
  const toggle = useCallback(() => apply(read() === "dark" ? "light" : "dark"), []);
  const cycle = useCallback(() => apply(NEXT_PREFERENCE[readPreference()]), []);
  return [theme, toggle, preference, cycle];
}
