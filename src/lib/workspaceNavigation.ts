export type WorkspaceKey = "today" | "portfolio" | "research" | "results" | "assistant";

export const WORKSPACE_NAVIGATION = [
  { key: "today", label: "Today", href: "/", icon: "today" },
  { key: "portfolio", label: "Portfolio", href: "/positions", icon: "journal" },
  { key: "research", label: "Research", href: "/#scanner-directory", icon: "setups" },
  { key: "results", label: "Results", href: "/performance", icon: "breadth" },
  { key: "assistant", label: "Assistant", href: "/assistant", icon: "search" },
] as const;

export function workspaceForLocation(pathname: string, hash = ""): WorkspaceKey {
  if (pathname === "/positions" || pathname === "/tracker") return "portfolio";
  if (pathname === "/performance" || pathname === "/backtest" || pathname === "/radar") return "results";
  if (pathname === "/assistant") return "assistant";
  if (pathname === "/playbook") return "research";
  if (pathname.startsWith("/scalp")) return "research";
  if (pathname === "/" && hash && !hash.startsWith("#metric-")) return "research";
  return "today";
}
