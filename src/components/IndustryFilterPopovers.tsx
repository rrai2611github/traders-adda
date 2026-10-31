"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type IndustryItem = { industry: string; subgroup: string };

export function buildGroupMap(items: IndustryItem[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.industry || !item.subgroup) continue;
    let subs = map.get(item.industry);
    if (!subs) {
      subs = new Set<string>();
      map.set(item.industry, subs);
    }
    subs.add(item.subgroup);
  }
  return map;
}

function isGroupFull(groupMap: Map<string, Set<string>>, group: string, picked: Set<string>): boolean {
  const subs = groupMap.get(group);
  return Boolean(subs && subs.size > 0 && [...subs].every((sub) => picked.has(sub)));
}

export function industryLabel(groupMap: Map<string, Set<string>>, picked: Set<string>): string {
  if (!picked.size) return "All industries";
  const full = [...groupMap.keys()].filter((group) => isGroupFull(groupMap, group, picked));
  const covered = new Set(full.flatMap((group) => [...(groupMap.get(group) ?? [])]));
  if (covered.size === picked.size && [...picked].every((sub) => covered.has(sub))) {
    return full.length === 1 ? full[0] : `${full.length} industries`;
  }
  return `${picked.size} subgroup${picked.size === 1 ? "" : "s"}`;
}

export function subgroupLabel(picked: Set<string>): string {
  return picked.size ? `${picked.size} subgroup${picked.size === 1 ? "" : "s"}` : "All subgroups";
}

type PopoverProps = {
  idPrefix: string;
  pool: IndustryItem[];
  groupMap: Map<string, Set<string>>;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel: string;
};

export function IndustryFilterPopovers({ idPrefix, pool, groupMap, picked, onChange, allLabel }: PopoverProps) {
  const [open, setOpen] = useState<"ind" | "sub" | null>(null);
  const [indQuery, setIndQuery] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const industryRows = useMemo(() => {
    const counts = new Map<string, number>();
    pool.forEach((item) => counts.set(item.industry, (counts.get(item.industry) ?? 0) + 1));
    const listed = new Set(counts.keys());
    groupMap.forEach((subs, group) => {
      if ([...subs].some((sub) => picked.has(sub))) listed.add(group);
    });
    return [...listed]
      .map((group) => ({ group, count: counts.get(group) ?? 0, checked: isGroupFull(groupMap, group, picked) }))
      .sort((left, right) => right.count - left.count || left.group.localeCompare(right.group));
  }, [groupMap, picked, pool]);

  const subgroupRows = useMemo(() => {
    const counts = new Map<string, number>();
    pool.forEach((item) => counts.set(item.subgroup, (counts.get(item.subgroup) ?? 0) + 1));
    const inPool = new Set(pool.map((item) => item.industry));
    return [...groupMap.entries()]
      .filter(([group, subs]) => inPool.has(group) || [...subs].some((sub) => picked.has(sub)))
      .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))
      .map(([group, subs]) => ({
        group,
        subs: [...subs].sort().map((sub) => ({ sub, count: counts.get(sub) ?? 0, checked: picked.has(sub) })),
      }));
  }, [groupMap, picked, pool]);

  const visibleIndustryRows = useMemo(() => {
    const q = indQuery.trim().toLowerCase();
    return q ? industryRows.filter((row) => row.group.toLowerCase().includes(q)) : industryRows;
  }, [indQuery, industryRows]);

  const visibleSubgroupRows = useMemo(() => {
    const q = subQuery.trim().toLowerCase();
    if (!q) return subgroupRows;
    return subgroupRows
      .map((entry) =>
        entry.group.toLowerCase().includes(q)
          ? entry
          : { ...entry, subs: entry.subs.filter((item) => item.sub.toLowerCase().includes(q)) },
      )
      .filter((entry) => entry.subs.length > 0);
  }, [subQuery, subgroupRows]);

  const toggleIndustry = (group: string, on: boolean) => {
    const next = new Set(picked);
    (groupMap.get(group) ?? new Set<string>()).forEach((sub) => {
      if (on) next.add(sub);
      else next.delete(sub);
    });
    onChange(next);
  };

  const toggleSubgroup = (sub: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(sub);
    else next.delete(sub);
    onChange(next);
  };

  const clearAll = () => onChange(new Set());

  return (
    <div className="flex flex-wrap gap-2" ref={wrapRef}>
      <div className="relative">
        <button
          id={`${idPrefix}-ind`}
          type="button"
          aria-expanded={open === "ind"}
          onClick={() => setOpen((current) => (current === "ind" ? null : "ind"))}
          className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-muted shadow-sm"
        >
          {industryLabel(groupMap, picked)} ▾
        </button>
        {open === "ind" ? (
          <div id={`${idPrefix}-indpop`} className="absolute left-0 z-40 mt-1 w-[22rem] rounded-xl border border-border bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between pb-2">
              <b className="text-base font-black text-foreground">Industries</b>
              <button type="button" onClick={clearAll} className="text-sm font-bold text-[#16894f]">Clear</button>
            </div>
            <input
              type="search"
              value={indQuery}
              onChange={(event) => setIndQuery(event.target.value)}
              placeholder="Find an industry"
              className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none"
            />
            <div className="max-h-72 overflow-y-auto">
              {visibleIndustryRows.map((row) => (
                <label key={row.group} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    data-g={row.group}
                    checked={row.checked}
                    onChange={(event) => toggleIndustry(row.group, event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="flex-1 truncate text-foreground">{row.group}</span>
                  <i className="not-italic text-slate-400">{row.count}</i>
                </label>
              ))}
            </div>
            <div className="mt-1 border-t border-border pt-2 text-xs font-semibold text-slate-400">
              {picked.size ? `${picked.size} subgroup${picked.size === 1 ? "" : "s"} picked` : allLabel}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          id={`${idPrefix}-sub`}
          type="button"
          aria-expanded={open === "sub"}
          onClick={() => setOpen((current) => (current === "sub" ? null : "sub"))}
          className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-muted shadow-sm"
        >
          {subgroupLabel(picked)} ▾
        </button>
        {open === "sub" ? (
          <div id={`${idPrefix}-subpop`} className="absolute left-0 z-40 mt-1 w-[22rem] rounded-xl border border-border bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between pb-2">
              <b className="text-base font-black text-foreground">Industry subgroups</b>
              <button type="button" onClick={clearAll} className="text-sm font-bold text-[#16894f]">Clear</button>
            </div>
            <input
              type="search"
              value={subQuery}
              onChange={(event) => setSubQuery(event.target.value)}
              placeholder="Find a subgroup"
              className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none"
            />
            <div className="max-h-72 overflow-y-auto">
              {visibleSubgroupRows.map((entry) => (
                <div key={entry.group}>
                  <div className="px-1 pt-2 text-[11px] font-black uppercase tracking-wide text-slate-400">{entry.group}</div>
                  {entry.subs.map((item) => (
                    <label key={item.sub} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        data-i={item.sub}
                        checked={item.checked}
                        onChange={(event) => toggleSubgroup(item.sub, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1 truncate text-foreground">{item.sub}</span>
                      <i className="not-italic text-slate-400">{item.count}</i>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-1 border-t border-border pt-2 text-xs font-semibold text-slate-400">
              {picked.size ? `${picked.size} picked` : allLabel}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
