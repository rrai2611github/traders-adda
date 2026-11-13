"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";

type Dir = "asc" | "desc";
interface SortState { col: number; dir: Dir }
type Value = number | string | null;

/**
 * Turns the text a cell shows into a sortable value. A cell that starts with a number (after an optional
 * sign or ₹) sorts by that number, so "₹2,255.80 +7.41%" sorts by price and "−3.2%" by −3.2; "—", "n/a"
 * and empty cells sort last; anything else sorts as text.
 */
export function cellSortValue(text: string): Value {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || /^(—|–|-|n\/a|na|unknown|none)$/i.test(clean)) return null;
  const match = clean.match(/^[+−-]?\s*₹?\s*[+−-]?\d[\d,]*(\.\d+)?/);
  if (match) {
    const negative = /^[−-]|₹\s*[−-]/.test(match[0]);
    const number = Number(match[0].replace(/[^\d.]/g, ""));
    if (Number.isFinite(number)) return negative ? -number : number;
  }
  return clean.toLowerCase();
}

function compare(a: Value, b: Value, dir: Dir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // blanks stay at the bottom in both directions
  if (b == null) return -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
  if (typeof a === "number") return -1; // numbers before text
  if (typeof b === "number") return 1;
  return a.localeCompare(b) * sign;
}

/**
 * Click-to-sort for any screener table, without per-column code. Clicking a header cell sorts by what that
 * column shows: first click high→low for numbers (A→Z for text), second click reverses, third goes back to the
 * table's own order. The rows stay React-rendered: the hook reads cell text after render and reorders the
 * source array, so live updates keep sorting correctly.
 *
 * Usage: `const { bindTable, rows: sortedRows } = useHeaderSort(rows, (row) => row.symbol)`; put `ref={bindTable}` on
 * the table, `data-sort-key={key}` on each row's `<tr>`, and render `sortedRows`. Destructure the result (do not keep
 * it in one object): passing `bindTable` as a ref would otherwise make React's lint treat `rows` as a ref value.
 */
export function useHeaderSort<T>(rows: T[], keyOf: (row: T) => string) {
  // A callback ref (not useRef): tables often appear after a loading state, and the wiring must follow the element.
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const bindTable = useCallback((element: HTMLTableElement | null) => setTable(element), []);
  const [sort, setSort] = useState<SortState | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  // `keyOf` is normally an inline arrow, so its identity changes every render; it only maps a row to its key,
  // so the order depends on rows/sort/order alone and it is left out of the dependency list on purpose.
  const sortedRows = useMemo(() => {
    if (!sort || !order) return rows;
    const rank = new Map(order.map((key, index) => [key, index]));
    return rows
      .map((row, index) => ({ row, index, rank: rank.get(keyOf(row)) }))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
      .map((item) => item.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, order]);

  const cycle = useCallback((col: number, numeric: boolean) => {
    setSort((current) => {
      const first: Dir = numeric ? "desc" : "asc";
      if (!current || current.col !== col) return { col, dir: first };
      if (current.dir === first) return { col, dir: first === "desc" ? "asc" : "desc" };
      return null; // third click: back to the table's own order
    });
  }, []);

  // Header wiring: every header cell becomes a keyboard-reachable sort control, and shows the current direction.
  useLayoutEffect(() => {
    if (!table) return;
    table.classList.add("sortable-table");
    const headers = Array.from(table.tHead?.rows[0]?.cells ?? []) as HTMLTableCellElement[];
    headers.forEach((th, index) => {
      th.tabIndex = 0;
      th.dataset.sortable = "true";
      th.setAttribute("aria-sort", sort?.col === index ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
    });
  });

  useLayoutEffect(() => {
    const head = table?.tHead;
    if (!table || !head) return;
    const columnIsNumeric = (col: number) => {
      const rowsInBody = Array.from(table.tBodies[0]?.rows ?? []).filter((row) => row.dataset.sortKey != null).slice(0, 12);
      return rowsInBody.some((row) => typeof cellSortValue(row.cells[col]?.textContent ?? "") === "number");
    };
    const onActivate = (target: EventTarget | null) => {
      const th = (target as HTMLElement | null)?.closest("th");
      if (!th || th.parentElement !== head.rows[0]) return;
      // Clicks on controls inside a header (help icons, buttons) keep their own behaviour.
      const element = target as HTMLElement;
      if (element !== th && element.closest("button, a, input, select")) return;
      cycle(th.cellIndex, columnIsNumeric(th.cellIndex));
    };
    const onClick = (event: MouseEvent) => onActivate(event.target);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if ((event.target as HTMLElement).tagName !== "TH") return;
      event.preventDefault();
      onActivate(event.target);
    };
    head.addEventListener("click", onClick);
    head.addEventListener("keydown", onKey);
    return () => {
      head.removeEventListener("click", onClick);
      head.removeEventListener("keydown", onKey);
    };
  }, [cycle, table]);

  // After each render, read the sorted column's displayed values and settle on an order (stable: ties keep the source order).
  // Deliberately runs after every render and sets state: the order is derived from the text the table
  // actually displays, which only exists in the DOM after render. setOrder only fires when the order changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!sort) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (order) setOrder(null);
      return;
    }
    const body = table?.tBodies[0];
    if (!body) return;
    const values = new Map<string, Value>();
    for (const tr of Array.from(body.rows)) {
      const key = tr.dataset.sortKey;
      if (key != null) values.set(key, cellSortValue(tr.cells[sort.col]?.textContent ?? ""));
    }
    const next = rows
      .map((row, index) => ({ key: keyOf(row), index }))
      .sort((a, b) => compare(values.get(a.key) ?? null, values.get(b.key) ?? null, sort.dir) || a.index - b.index)
      .map((item) => item.key);
    if (!order || order.length !== next.length || order.some((key, index) => key !== next[index])) setOrder(next);
  });

  return { bindTable, rows: sortedRows };
}
