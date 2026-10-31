import { buildPreOpenPreview, preOpenEmailStatus, sendPreOpenEmailNow, sendPreOpenTestEmail } from "@/lib/alerts/preOpenEmail";
import { withPreviewLogo } from "@/lib/alerts/brand";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Status, plus a rendered preview so the brief can be checked before 09:00. */
export async function GET(request: Request) {
  const status = preOpenEmailStatus();
  const params = new URL(request.url).searchParams;
  // `?top5=1` shows the Weekly Top 5 section, which otherwise rides along only on the first trading day of the week.
  const options = { forceTop5: params.get("top5") === "1" };
  if (params.get("html") === "1") {
    try {
      const preview = await buildPreOpenPreview(Date.now(), options);
      return new Response(withPreviewLogo(preview.html), { headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" } });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 503, headers: noStore });
    }
  }
  try {
    const preview = await buildPreOpenPreview();
    return Response.json({ ...status, subject: preview.subject, text: preview.text, picks: preview.table.rows.length }, { headers: noStore });
  } catch (error) {
    return Response.json({ ...status, previewError: error instanceof Error ? error.message : String(error) }, { headers: noStore });
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return !origin || !host || new URL(origin).host === host;
}

/** Sends the pre-open brief immediately, ignoring the 09:00 window; `?test_to=` sends a [TEST] copy to one EMAIL_TO address and leaves state untouched. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ ok: false, error: "Cross-origin requests are not allowed." }, { status: 403, headers: noStore });
  }
  try {
    const testTo = new URL(request.url).searchParams.get("test_to");
    if (testTo) return Response.json({ ok: true, test: true, ...(await sendPreOpenTestEmail(testTo)) }, { headers: noStore });
    const sent = await sendPreOpenEmailNow();
    return Response.json({ ok: true, ...sent, ...preOpenEmailStatus() }, { headers: noStore });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...preOpenEmailStatus(),
    }, { status: 502, headers: noStore });
  }
}
