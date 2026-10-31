import {
  hourlyEmailPreview,
  hourlyEmailStatus,
  sendHourlyEmailNow,
  sendHourlyTestEmail,
  testEmailConnection,
} from "@/lib/alerts/hourlyEmail";
import { withPreviewLogo } from "@/lib/alerts/brand";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Status JSON, or the rendered email with `?html=1` (changes against the last email or the pre-open list). */
export async function GET(request: Request) {
  try {
    const preview = await hourlyEmailPreview();
    if (new URL(request.url).searchParams.get("html") === "1") {
      return preview.ok
        ? new Response(withPreviewLogo(preview.html), { headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" } })
        : new Response(preview.reason, { status: 503, headers: noStore });
    }
    return Response.json({
      ...hourlyEmailStatus(),
      preview: preview.ok ? preview.table : null,
      previewError: preview.ok ? null : preview.reason,
    }, { headers: noStore });
  } catch (error) {
    console.error("[email] hourly preview failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Hourly email preview unavailable." }, { status: 503, headers: noStore });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** Sends now (even with no changes), verifies SMTP with `?verify=1`, or sends a [TEST] copy to one EMAIL_TO address with `?test_to=`, leaving state untouched. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ ok: false, error: "Cross-origin requests are not allowed." }, { status: 403, headers: noStore });
  }
  try {
    if (new URL(request.url).searchParams.get("verify") === "1") {
      await testEmailConnection();
      return Response.json({ ok: true, verified: true, ...hourlyEmailStatus() }, { headers: noStore });
    }
    const testTo = new URL(request.url).searchParams.get("test_to");
    if (testTo) return Response.json({ ok: true, test: true, ...(await sendHourlyTestEmail(testTo)) }, { headers: noStore });
    const sent = await sendHourlyEmailNow();
    return Response.json({ ok: true, ...sent, ...hourlyEmailStatus() }, { headers: noStore });
  } catch (error) {
    console.error("[email] hourly send failed:", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502, headers: noStore });
  }
}
