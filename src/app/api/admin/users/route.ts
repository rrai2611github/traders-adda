import { auth } from "@/lib/auth";
import { adminSessionFromRequest } from "@/lib/auth-session";
import { requireAuthDb } from "@/lib/auth-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await adminSessionFromRequest(request)) {
    return Response.json({ error: "Admin access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await auth.api.listUsers({
      headers: request.headers,
      query: { limit: 100, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
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

    if (body.action === "role" && (body.role === "user" || body.role === "admin")) {
      if (body.role === "user") {
        const remaining = await requireAuthDb().query(
          `SELECT count(*)::int AS count FROM "user" WHERE role = 'admin' AND id <> $1`,
          [body.userId],
        );
        if (remaining.rows[0]?.count === 0) return Response.json({ error: "The last administrator cannot be demoted." }, { status: 409 });
      }
      const result = await auth.api.setRole({ headers: request.headers, body: { userId: body.userId, role: body.role } });
      return Response.json(result);
    }

    if (body.action === "ban") {
      const result = await auth.api.banUser({
        headers: request.headers,
        body: { userId: body.userId, banReason: "Access disabled by an administrator." },
      });
      return Response.json(result);
    }

    if (body.action === "unban") {
      const result = await auth.api.unbanUser({ headers: request.headers, body: { userId: body.userId } });
      return Response.json(result);
    }

    return Response.json({ error: "Unknown or invalid admin action." }, { status: 400 });
  } catch (error) {
    console.error("[admin-users] update failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the account." }, { status: 500 });
  }
}
