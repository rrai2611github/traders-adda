import { auth } from "@/lib/auth";
import { adminSessionFromRequest } from "@/lib/auth-session";
import { requireAuthDb } from "@/lib/auth-db";
import { recordAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";
const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  if (!await adminSessionFromRequest(request)) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const url = new URL(request.url);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : MAX_PAGE_SIZE;
    const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
    const rawSearch = url.searchParams.get("searchValue")?.trim() ?? "";
    const rawSearchField = url.searchParams.get("searchField") ?? "email";
    const searchField = rawSearchField === "name" || rawSearchField === "email" ? rawSearchField : null;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || !Number.isSafeInteger(offset) || offset < 0) {
      return Response.json({ error: `Use a limit from 1 to ${MAX_PAGE_SIZE} and a non-negative integer offset.` }, { status: 400 });
    }
    if (rawSearch.length > 100 || !searchField) {
      return Response.json({ error: "Search by name or email with a query of at most 100 characters." }, { status: 400 });
    }
    const result = await auth.api.listUsers({
      headers: request.headers,
      query: {
        limit,
        offset,
        sortBy: "createdAt",
        sortDirection: "desc",
        ...(rawSearch ? { searchValue: rawSearch, searchField, searchOperator: "contains" as const } : {}),
      },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin-users] list failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load users." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

interface AdminAction {
  action?: string;
  userId?: string;
  role?: string;
}

export async function POST(request: Request) {
  const session = await adminSessionFromRequest(request);
  if (!session) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body = await request.json() as AdminAction;
    if (!body.userId || body.userId === session.user.id) {
      return Response.json({ error: "Choose another user; you cannot change your own account here." }, { status: 400 });
    }
    const targetResult = await requireAuthDb().query<{ email: string; role: string; banned: boolean }>(
      `SELECT email, role, COALESCE(banned, false) AS banned FROM "user" WHERE id = $1`,
      [body.userId],
    );
    const target = targetResult.rows[0];
    if (!target) return Response.json({ error: "The selected account no longer exists." }, { status: 404 });

    if (body.action === "role" && (body.role === "user" || body.role === "admin")) {
      if (body.role === "user") {
        const remaining = await requireAuthDb().query(
          `SELECT count(*)::int AS count FROM "user" WHERE role = 'admin' AND id <> $1`,
          [body.userId],
        );
        if (remaining.rows[0]?.count === 0) return Response.json({ error: "The last administrator cannot be demoted." }, { status: 409 });
      }
      const result = await auth.api.setRole({ headers: request.headers, body: { userId: body.userId, role: body.role } });
      await recordActionOrReport({
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        targetUserId: body.userId,
        targetEmail: target.email,
        action: "role_changed",
        details: { from: target.role, to: body.role },
      });
      return Response.json(result);
    }

    if (body.action === "ban") {
      const result = await auth.api.banUser({
        headers: request.headers,
        body: { userId: body.userId, banReason: "Access disabled by an administrator." },
      });
      await recordActionOrReport({
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        targetUserId: body.userId,
        targetEmail: target.email,
        action: "account_disabled",
        details: { wasDisabled: target.banned },
      });
      return Response.json(result);
    }

    if (body.action === "unban") {
      const result = await auth.api.unbanUser({ headers: request.headers, body: { userId: body.userId } });
      await recordActionOrReport({
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        targetUserId: body.userId,
        targetEmail: target.email,
        action: "account_enabled",
        details: { wasDisabled: target.banned },
      });
      return Response.json(result);
    }

    return Response.json({ error: "Unknown or invalid admin action." }, { status: 400 });
  } catch (error) {
    console.error("[admin-users] update failed:", error);
    if (error instanceof AdminAuditWriteError) {
      return Response.json({ error: error.message, actionApplied: true }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the account." }, { status: 500 });
  }
}

async function recordActionOrReport(input: {
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
  targetEmail: string;
  action: "role_changed" | "account_disabled" | "account_enabled";
  details: Record<string, string | boolean>;
}) {
  try {
    await recordAdminAction(input);
  } catch (error) {
    console.error("[admin-users] audit write failed after account action:", error);
    throw new AdminAuditWriteError();
  }
}

class AdminAuditWriteError extends Error {
  constructor() {
    super("The account change was applied, but its audit record could not be saved. Verify the account state and check the admin audit log.");
    this.name = "AdminAuditWriteError";
  }
}
