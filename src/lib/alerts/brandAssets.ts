import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOGO_CID, LOGO_PUBLIC_PATH } from "./brand.ts";

let cached: Buffer | null = null;

/** Inline logo attachment for `cid:traders-adda-logo` in the customer emails. */
export function logoAttachment() {
  cached ??= readFileSync(join(process.cwd(), "public", ...LOGO_PUBLIC_PATH.split("/").filter(Boolean)));
  return {
    filename: "traders-adda-logo.jpg",
    content: cached,
    contentType: "image/jpeg",
    cid: LOGO_CID,
    contentDisposition: "inline" as const,
  };
}
