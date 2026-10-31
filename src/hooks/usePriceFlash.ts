"use client";

import { useEffect, useRef, useState } from "react";

type Flash = "" | "flash-up" | "flash-down";

/** Returns a short-lived CSS class whenever `value` moves, for tick highlighting. */
export function usePriceFlash(value: number | undefined): Flash {
  const previous = useRef<number | undefined>(value);
  const [flash, setFlash] = useState<Flash>("");

  useEffect(() => {
    if (value === undefined) return;
    const before = previous.current;
    previous.current = value;
    if (before === undefined || before === value) return;

    setFlash(value > before ? "flash-up" : "flash-down");
    const timer = setTimeout(() => setFlash(""), 600);
    return () => clearTimeout(timer);
  }, [value]);

  return flash;
}
