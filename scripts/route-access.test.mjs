import test from "node:test";
import assert from "node:assert/strict";
import { routeAccess } from "../src/lib/routeAccess.ts";

test("members can reach saved scans and the fixed member backtest, but not admin routes", () => {
  assert.deepEqual(routeAccess("/api/user/saved-scans", true, "user"), { kind: "allow" });
  assert.deepEqual(routeAccess("/api/member/backtest", true, "user"), { kind: "allow" });
  assert.deepEqual(routeAccess("/backtest", false, "user"), { kind: "allow" });
  assert.deepEqual(routeAccess("/api/backtest", true, "user"), {
    kind: "forbidden",
    error: "This feature is only available to administrators.",
  });
  assert.deepEqual(routeAccess("/performance", false, "user"), { kind: "redirect" });
});

test("admins retain access while regular accounts cannot reach admin APIs", () => {
  assert.deepEqual(routeAccess("/api/backtest", true, "admin"), { kind: "allow" });
  assert.deepEqual(routeAccess("/api/scalp/desk", true, "user"), {
    kind: "forbidden",
    error: "Admin access is required.",
  });
  assert.deepEqual(routeAccess("/radar", false, "user"), { kind: "redirect" });
});
