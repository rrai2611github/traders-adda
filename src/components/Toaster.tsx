"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT } from "@/lib/toast";

/** Shows each confirmation for a few seconds, above the phone tab bar. Announced politely to screen readers. */
export function Toaster() {
  const [items, setItems] = useState<Array<{ id: number; text: string }>>([]);
  useEffect(() => {
    let next = 1;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (event: Event) => {
      const id = next++;
      setItems((list) => [...list.slice(-2), { id, text: String((event as CustomEvent<string>).detail) }]);
      const timer = setTimeout(() => { timers.delete(timer); setItems((list) => list.filter((item) => item.id !== id)); }, 3500);
      timers.add(timer);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => { window.removeEventListener(TOAST_EVENT, onToast); timers.forEach(clearTimeout); };
  }, []);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((item) => <div key={item.id} className="toast toast-ok">{item.text}</div>)}
    </div>
  );
}
