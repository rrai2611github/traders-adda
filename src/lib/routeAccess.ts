export type RouteAccess =
  | { kind: "allow" }
  | { kind: "redirect" }
  | { kind: "forbidden"; error: string };

const ADMIN_PAGES = ["/admin", "/performance", "/radar", "/scalp"];
const USER_PAGES = ["/", "/assistant", "/backtest", "/playbook", "/positions", "/tracker"];
const USER_API_PREFIXES = ["/api/market", "/api/assistant", "/api/member/backtest", "/api/paper", "/api/user/watchlist", "/api/user/saved-scans", "/api/positions", "/api/tracker", "/api/strategy-health"];
const ADMIN_API_PREFIXES = ["/api/paper/index", "/api/scalp"];

function matchesPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function routeAccess(pathname: string, isApi: boolean, role: string): RouteAccess {
  if (role === "admin") return { kind: "allow" };

  if (matchesPath(pathname, ADMIN_PAGES) || matchesPath(pathname, ADMIN_API_PREFIXES)) {
    return isApi ? { kind: "forbidden", error: "Admin access is required." } : { kind: "redirect" };
  }
  if (isApi) {
    return matchesPath(pathname, USER_API_PREFIXES)
      ? { kind: "allow" }
      : { kind: "forbidden", error: "This feature is only available to administrators." };
  }
  return USER_PAGES.includes(pathname) ? { kind: "allow" } : { kind: "redirect" };
}
