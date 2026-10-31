export const ALERT_BRAND = "Traders Adda";

/**
 * Traders Adda email design system shared by the pre-open and hourly emails:
 * the logo header (text left, logo right), section headings, the rules card
 * and the footer. Colours come from the logo (navy-black canvas, green mark).
 * Pure strings only; the logo bytes are attached by `brandAssets.ts` under
 * `LOGO_CID`.
 */

export const LOGO_CID = "traders-adda-logo";
/** Served by Next.js from `public/`, used by browser previews instead of the CID. */
export const LOGO_PUBLIC_PATH = "/brand/traders-adda-logo-email.jpg";

export const BRAND = {
  canvas: "#020814",
  panel: "#0b1526",
  panelLine: "#1b2a42",
  green: "#22c55e",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  page: "#eef1f5",
} as const;

export const BRAND_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const F = BRAND_FONT;

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Responsive rules shared by both emails (clients that drop <style> get the desktop layout). */
export const BRAND_STYLE = `<style>
  @media only screen and (max-width:620px){
    .container{width:100% !important}
    .col{display:block !important;width:100% !important;box-sizing:border-box;padding:5px 0 !important}
    .pad{padding-left:12px !important;padding-right:12px !important}
    .c2{display:block !important;width:100% !important;padding:0 !important;box-sizing:border-box}
    .outer{padding:12px 4px !important}
    .lv{font-size:12px !important}
    .hero{font-size:20px !important}
    .logo{width:96px !important}
    .dt td{padding-left:6px !important;padding-right:6px !important}
    .stc{display:none !important}
    .stm{display:block !important;max-height:none !important;overflow:visible !important}
  }
  @media only screen and (max-width:430px){
    .kpi{padding:0 2px !important}
    .kpi td{padding:8px 8px 7px 8px !important}
    .kpiv{font-size:19px !important;letter-spacing:-0.5px !important}
    .kpil{font-size:8.5px !important;letter-spacing:0.4px !important}
    .hero{font-size:19px !important}
    .logo{width:72px !important}
  }
  img{max-width:100%}
</style>`;

export interface BrandStat {
  label: string;
  value: string;
  color: string;
}

/** Dark header: kicker, title and subtitle on the left, the logo on the right, then stat tiles. */
export function brandHeader(opts: { kicker: string; title: string; subtitle: string; stats?: BrandStat[] }): string {
  const stats = opts.stats ?? [];
  const tiles = stats.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr>
        ${stats
          .map(
            (s, i) => `<td width="${(100 / stats.length).toFixed(1)}%" style="padding:0 ${i === stats.length - 1 ? 0 : 4}px 0 ${i === 0 ? 0 : 4}px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.06);background-color:${BRAND.panel};border:1px solid ${BRAND.panelLine};border-radius:14px">
              <tr><td style="padding:11px 12px">
                <div style="font:700 9px ${F};letter-spacing:1.2px;text-transform:uppercase;color:#7d8aa3">${esc(s.label)}</div>
                <div style="font:800 20px ${F};color:${s.color};padding-top:4px;white-space:nowrap">${esc(s.value)}</div>
              </td></tr>
            </table>
          </td>`,
          )
          .join("")}
      </tr></table>`
    : "";
  return `<tr><td style="background:${BRAND.green};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="pad" bgcolor="${BRAND.canvas}" style="background:${BRAND.canvas};background-image:linear-gradient(135deg,#020814 0%,#0a2233 55%,#0c3a2c 100%);padding:26px 26px 26px 26px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;padding-right:12px">
        <div style="font:800 10px ${F};letter-spacing:2px;text-transform:uppercase;color:${BRAND.green}">● ${esc(opts.kicker)}</div>
        <div class="hero" style="font:800 26px/1.2 ${F};color:#ffffff;letter-spacing:-0.6px;padding-top:10px">${esc(opts.title)}</div>
        <div style="font:400 12px/1.5 ${F};color:#94a3b8;padding-top:6px">${esc(opts.subtitle)}</div>
      </td>
      <td width="130" align="right" style="vertical-align:middle">
        <img class="logo" src="cid:${LOGO_CID}" width="130" alt="Traders Adda" style="display:block;width:130px;height:auto;border:0">
      </td>
    </tr></table>
    ${tiles}
  </td></tr>`;
}

/** Section heading: a navy badge with a green icon or number, the title, an optional right-hand meta and note. */
export function brandSection(icon: string, title: string, opts: { note?: string; right?: string } = {}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 12px 0"><tr>
      <td width="34" style="vertical-align:middle"><div style="width:26px;height:26px;border-radius:8px;background:${BRAND.canvas};color:${BRAND.green};font:800 12px/26px ${F};text-align:center">${icon}</div></td>
      <td style="vertical-align:middle;font:800 16px ${F};color:${BRAND.ink};letter-spacing:-0.2px">${title}</td>
      ${opts.right ? `<td style="vertical-align:middle;text-align:right;font:700 11px ${F};color:${BRAND.muted};white-space:nowrap">${opts.right}</td>` : ""}
    </tr></table>
    ${opts.note ? `<div style="font:400 12px/1.6 ${F};color:${BRAND.muted};margin:-4px 0 12px 0">${opts.note}</div>` : ""}`;
}

/** The numbered swing-trading rules card. */
export function rulesCard(title: string, rules: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid ${BRAND.line};border-radius:14px">
    <tr><td style="padding:16px 18px 10px 18px;font:800 11px ${F};letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.ink}">${esc(title)}</td></tr>
    ${rules
      .map(
        (rule, i) => `<tr><td style="padding:0 18px 9px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="28" style="vertical-align:top"><div style="width:20px;height:20px;border-radius:50%;background:${BRAND.canvas};color:${BRAND.green};font:800 10px/20px ${F};text-align:center">${i + 1}</div></td>
        <td style="vertical-align:top;font:400 12px/1.6 ${F};color:#334155">${esc(rule)}</td>
      </tr></table>
    </td></tr>`,
      )
      .join("")}
    <tr><td style="height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
  </table>`;
}

/** Dark footer with the logo tagline, the risk line and the disclaimer lines. */
export function brandFooter(lines: string[], note = ""): string {
  const sep = `<span style="color:${BRAND.green}">&nbsp;|&nbsp;</span>`;
  return `<tr><td align="center" class="pad" style="background:${BRAND.canvas};padding:24px 28px 26px 28px">
    <div style="font:700 10px ${F};letter-spacing:2px;color:#cbd5e1">TRADE${sep}LEARN${sep}ANALYSE${sep}GROW TOGETHER</div>
    <div style="font:700 12px ${F};color:#ffffff;padding-top:14px">No sure shots. Risk no more than 1% of capital per trade.</div>
    <div style="font:400 11px/1.7 ${F};color:#7d8aa3;padding-top:8px">${lines.map(esc).join("<br>")}</div>
    ${note ? `<div style="font:600 10px ${F};letter-spacing:0.5px;color:#55627a;padding-top:12px">${esc(note)}</div>` : ""}
  </td></tr>`;
}

/** Swap the CID logo for the public URL so a browser preview shows it. */
export const withPreviewLogo = (html: string) => html.split(`cid:${LOGO_CID}`).join(LOGO_PUBLIC_PATH);
