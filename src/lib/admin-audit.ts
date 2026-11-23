import { requireAuthDb } from "./auth-db.ts";

export type AdminAction = "role_changed" | "account_disabled" | "account_enabled";

export interface AdminAuditEvent {
  id: string;
  actor_email: string;
  target_email: string;
  action: AdminAction;
  details: Record<string, string | boolean>;
  created_at: string;
}

export async function recordAdminAction(input: {
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
  targetEmail: string;
  action: AdminAction;
  details: Record<string, string | boolean>;
}): Promise<void> {
  await requireAuthDb().query(
    `INSERT INTO admin_audit_events
       (actor_user_id, actor_email, target_user_id, target_email, action, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorUserId,
      input.actorEmail,
      input.targetUserId,
      input.targetEmail,
      input.action,
      JSON.stringify(input.details),
    ],
  );
}

export async function recentAdminActions(limit = 30): Promise<AdminAuditEvent[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Admin audit limit must be from 1 to 100.");
  }
  const result = await requireAuthDb().query<AdminAuditEvent>(
    `SELECT id::text, actor_email, target_email, action, details, created_at
     FROM admin_audit_events
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}
