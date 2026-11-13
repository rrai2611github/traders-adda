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
  equitiesOnly?: boolean;
  label?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  onChoose?: (stock: SearchResult) => void;
}

export function SymbolSearch({ onSelect, existing, equitiesOnly = false, label = "Search instruments", fullWidth = false, disabled = false, onChoose }: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
        if (!res.ok) throw new Error(json.error ?? `Stock search failed (${res.status}).`);
        if (controller.signal.aborted) return;
        setResults((json.results ?? []).filter((stock: SearchResult) => !equitiesOnly || stock.kind === "EQUITY"));
        setResultsFor(trimmed);
        setActiveIndex(0);
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Stock search unavailable.");
          setResults([]);
          setResultsFor(trimmed);
        }
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, equitiesOnly]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const choose = (symbol: string) => {
    const stock = results.find((r) => r.symbol === symbol);
    if (stock && onChoose) onChoose(stock);
    onSelect(symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { setOpen(false); return; }
    if (!open || !results.length || resultsFor !== query.trim()) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!existing.includes(results[activeIndex].symbol)) choose(results[activeIndex].symbol);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${fullWidth ? "" : "sm:w-72"}`}>
      <input
        type="text"
        role="combobox"
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setError(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={equitiesOnly ? "Type company name or symbol..." : "Search any stock"}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0 && resultsFor === query.trim()}
        aria-activedescendant={open && results.length > 0 && resultsFor === query.trim() ? `${listId}-${activeIndex}` : undefined}
        aria-controls={listId}
        autoComplete="off"
        className="w-full rounded-md border border-border bg-raised px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
      />

      {open && results.length > 0 && resultsFor === query.trim() && (
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
                  id={`${listId}-${index}`}
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
                    <span className={`block text-xs text-muted ${fullWidth ? "break-words" : "truncate"}`}>
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
      {open && error && <p role="alert" className="absolute z-20 mt-1 w-full rounded-md border border-border bg-raised p-3 text-sm text-rose-700 shadow-xl">{error}</p>}
      {open && !error && results.length === 0 && query.trim() !== "" && resultsFor === query.trim() && (
        <p role="status" className="absolute z-20 mt-1 w-full rounded-md border border-border bg-raised px-3 py-2.5 text-sm text-muted shadow-xl">
          No NSE stock or index matches &ldquo;{query.trim()}&rdquo;. Try the symbol (e.g. TCS) or part of the company name.
        </p>
      )}
    </div>
  );
}
