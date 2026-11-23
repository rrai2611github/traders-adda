import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";

const { authDbPool } = await import("../src/lib/auth-db.ts");
const { recordAdminAction, recentAdminActions } = await import("../src/lib/admin-audit.ts");

test("admin actions are recorded and returned newest-first with a bounded limit", async () => {
  const statements = [];
  const rows = [{
    id: "14",
    actor_email: "admin@example.com",
    target_email: "member@example.com",
    action: "role_changed",
    details: { from: "user", to: "admin" },
    created_at: "2026-11-23T06:00:00.000Z",
  }];
  const originalQuery = authDbPool.query;
  authDbPool.query = async (statement, values = []) => {
    statements.push({ sql: statement.replace(/\s+/g, " ").trim(), values });
    return { rows: statement.includes("INSERT INTO admin_audit_events") ? [] : rows };
  };
  try {
    await recordAdminAction({
      actorUserId: "admin-id",
      actorEmail: "admin@example.com",
      targetUserId: "member-id",
      targetEmail: "member@example.com",
      action: "role_changed",
      details: { from: "user", to: "admin" },
    });
    assert.deepEqual(await recentAdminActions(10), rows);
    assert.deepEqual(statements[0].values, [
      "admin-id",
      "admin@example.com",
      "member-id",
      "member@example.com",
      "role_changed",
      JSON.stringify({ from: "user", to: "admin" }),
    ]);
    assert.match(statements[1].sql, /ORDER BY created_at DESC, id DESC LIMIT \$1$/);
    assert.deepEqual(statements[1].values, [10]);
    await assert.rejects(() => recentAdminActions(101), /limit must be from 1 to 100/);
  } finally {
    authDbPool.query = originalQuery;
  }
});
