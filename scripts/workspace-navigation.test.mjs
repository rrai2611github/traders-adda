import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_NAVIGATION, workspaceForLocation } from "../src/lib/workspaceNavigation.ts";
import { DEFAULT_ROUTE, routeHash } from "../src/lib/appRoute.ts";

test("desktop, mobile and command palette share exactly five ordered destinations", () => {
  assert.deepEqual(WORKSPACE_NAVIGATION.map(({ label }) => label), [
    "Today", "Portfolio", "Research", "Results", "Assistant",
  ]);
  assert.equal(new Set(WORKSPACE_NAVIGATION.map(({ href }) => href)).size, 5);
  for (const item of WORKSPACE_NAVIGATION) {
    const url = new URL(item.href, "http://localhost");
    assert.equal(workspaceForLocation(url.pathname, url.hash), item.key);
  }
});

test("results subpages and portfolio deep links retain their parent destination", () => {
  for (const pathname of ["/performance", "/radar", "/backtest"]) {
    assert.equal(workspaceForLocation(pathname), "results");
  }
  for (const hash of ["", "#strategy-check", "#order-approvals", "#email-activity"]) {
    assert.equal(workspaceForLocation("/positions", hash), "portfolio");
  }
  assert.equal(workspaceForLocation("/assistant"), "assistant");
  assert.equal(workspaceForLocation("/tracker"), "portfolio");
  assert.equal(workspaceForLocation("/scalp"), "research");
  assert.equal(workspaceForLocation("/playbook"), "research"); // the playbook teaches the research tools
});

test("existing dashboard tools belong to Research, while metrics remain in Today", () => {
  for (const nav of ["monthly", "bottomed", "research", "directory", "picks", "screens", "signals", "scanners", "rsi-edge", "market", "watchlist", "journal", "learn"]) {
    assert.equal(workspaceForLocation("/", routeHash({ ...DEFAULT_ROUTE, nav })), "research", nav);
  }
  assert.equal(workspaceForLocation("/", ""), "today");
  for (const metric of ["above50", "above200", "advancing", "buyReady", "shortReady"]) {
    assert.equal(workspaceForLocation("/", routeHash({ ...DEFAULT_ROUTE, nav: "metrics", metric })), "today");
  }
});
