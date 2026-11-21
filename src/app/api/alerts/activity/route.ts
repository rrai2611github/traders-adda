import { readEmailActivity } from "@/lib/alerts/emailActivity";
import { emailCheckpointPath, emailScheduleStatus, readEmailCheckpoint } from "@/lib/alerts/emailActivityStatus";
import { emailSlotKey } from "@/lib/alerts/hourlyEmailFormat";
import { preOpenSlotKey } from "@/lib/alerts/preOpenEmailFormat";
import { marketEmailCalendarWarning } from "@/lib/alerts/marketEmailPolicy";
import { emailConfig } from "@/lib/alerts/smtp";
import { requireAdminResponse } from "@/lib/auth-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = await requireAdminResponse(request);
  if (denied) return denied;
  try {
    const now = Date.now();
    const configured = emailConfig() != null;
    return Response.json({
      checkedAt: now,
      entries: readEmailActivity(),
      schedules: [
        emailScheduleStatus("hourly", process.env.EMAIL_AUTO_SEND === "1", configured, emailSlotKey(now), readEmailCheckpoint(emailCheckpointPath("hourly")), now),
        emailScheduleStatus("pre-open", process.env.PREOPEN_EMAIL_AUTO_SEND === "1", configured, preOpenSlotKey(now), readEmailCheckpoint(emailCheckpointPath("pre-open")), now),
      ],
      calendarWarning: marketEmailCalendarWarning(now),
    }, { headers });
  } catch (error) {
    console.error("[email-activity] could not read activity:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Email activity is unavailable. Check server logs; saved history has not been reset." }, { status: 503, headers });
  }
}
