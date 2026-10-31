"use client";

import { useEffect, useId, useRef, useState } from "react";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  kind: string;
  sector?: string;
}

interface SymbolSearchProps {
  onSelect: (symbol: string) => void;
  /** Symbols already on the watchlist, shown as "Added". */
  existing: string[];
}

export function SymbolSearch({ onSelect, existing }: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // Clears stale results from a previous non-empty query; this depends
      // on a changing input, so it cannot be a lazy initial state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/market/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const json = await res.json();
        setResults(json.results ?? []);
        setResultsFor(trimmed);
        setActiveIndex(0);
      } catch {
        // Aborted or failed request — keep the previous suggestions.
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const choose = (symbol: string) => {
    onSelect(symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex].symbol);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-72">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search any stock"
        aria-label="Search instruments"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        autoComplete="off"
        className="w-full rounded-md border border-border bg-raised px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
      />

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-raised shadow-xl"
        >
          {results.map((result, index) => {
            const added = existing.includes(result.symbol);
            return (
              <li key={result.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  disabled={added}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(result.symbol)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    index === activeIndex ? "bg-accent/10" : ""
                  } ${added ? "cursor-not-allowed opacity-50" : "hover:bg-accent/10"}`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{result.symbol}</span>
                    <span className="block truncate text-xs text-muted">
                      {result.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {added ? "Added" : (result.sector ?? result.kind)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && results.length === 0 && query.trim() !== "" && resultsFor === query.trim() && (
        <p role="status" className="absolute z-20 mt-1 w-full rounded-md border border-border bg-raised px-3 py-2.5 text-sm text-muted shadow-xl">
          No NSE stock or index matches &ldquo;{query.trim()}&rdquo;. Try the symbol (e.g. TCS) or part of the company name.
        </p>
      )}
    </div>
  );
}
