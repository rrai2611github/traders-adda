"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type NavIconName } from "./NavIcons";

const TABS: ReadonlyArray<{ href: string; label: string; icon: NavIconName }> = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/positions", label: "Positions", icon: "journal" },
  { href: "/tracker", label: "Live check", icon: "breadth" },
  { href: "/backtest", label: "Backtest", icon: "signals" },
  { href: "/radar", label: "Emails", icon: "picks" },
];

/**
 * The five pages you use every week, one thumb-tap apart at the bottom of a phone screen. Shown only on those pages and only on narrow
 * screens (the stylesheet hides it from 640px up, where the sidebar and the top buttons do the job).
 */
export function MobileTabBar() {
  const pathname = usePathname();
  if (!TABS.some((tab) => tab.href === pathname)) return null;
  return (
    <nav aria-label="Main tabs" className="tabbar">
      {TABS.map((tab) => {
        const current = tab.href === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className="tabbar-item"
            onClick={(event) => {
              // The Dashboard shows its views from the address hash, so "Today" while on the Dashboard must reset that itself.
              if (tab.href === "/" && current) {
                event.preventDefault();
                window.history.pushState(null, "", "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          >
            <NavIcon name={tab.icon} size={20} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
