"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GLOSSARY, type TermKey } from "@/lib/glossary";

const POPOVER_WIDTH = 288;
const MARGIN = 8;

interface Placement { left: number; width: number; top?: number; bottom?: number }

/**
 * A word with a dotted underline that explains itself when tapped or clicked (or focused and pressed with the keyboard). It works on
 * phones, which have no hover, and the note is placed against the screen, not the page, so it never widens the page or hides off the edge.
 */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const term = GLOSSARY[k];
  const [place, setPlace] = useState<Placement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!place) return;
    const close = () => setPlace(null);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !note.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [place]);

  const toggle = () => {
    if (place) { setPlace(null); return; }
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(rect.left, MARGIN), window.innerWidth - width - MARGIN);
    // Below the word, unless there is little room underneath.
    const below = window.innerHeight - rect.bottom > 190;
    setPlace(below ? { left, width, top: rect.bottom + 6 } : { left, width, bottom: window.innerHeight - rect.top + 6 });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={place != null}
        aria-describedby={place ? id : undefined}
        title={`What is ${term.name}?`}
        className="cursor-help border-b border-dotted border-current bg-transparent p-0 text-inherit [font:inherit] [letter-spacing:inherit] [text-transform:inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8951c]"
      >
        {children ?? term.name}
      </button>
      {place && (
        <span
          ref={note}
          id={id}
          role="tooltip"
          style={{ position: "fixed", left: place.left, width: place.width, top: place.top, bottom: place.bottom }}
          className="z-[60] block rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[12px] font-normal normal-case leading-5 tracking-normal text-slate-700 shadow-[0_12px_32px_rgba(7,16,38,0.22)]"
        >
          <span className="block text-[11px] font-black uppercase tracking-wide text-accent">{term.name}</span>
          {term.text}
        </span>
      )}
    </>
  );
}

/** Every word, for the About page. */
export function GlossaryList() {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {(Object.keys(GLOSSARY) as TermKey[]).map((key) => (
        <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <dt className="text-sm font-black text-slate-900">{GLOSSARY[key].name}</dt>
          <dd className="mt-1 text-[13px] leading-5 text-slate-600">{GLOSSARY[key].text}</dd>
        </div>
      ))}
    </dl>
  );
}
