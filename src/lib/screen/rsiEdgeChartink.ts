import {
  RSI_EDGE_SCAN_KEYS,
  RSI_EDGE_SOURCES,
  type RsiEdgeScanKey,
  type RsiEdgeSourcePayload,
  type RsiEdgeSourceResult,
  type RsiEdgeSourceRow,
} from "./rsiEdgeSource.ts";

const CHARTINK_ORIGIN = "https://chartink.com";
const CACHE_MS = 60_000;
const FAILURE_CACHE_MS = 15_000;
const DEFAULT_COLUMNS =
  ` Daily Close as 'scan-column-default-close',  Daily "close - 1 candle ago close / 1 candle ago close * 100" as 'scan-column-default-percent-change', ` +
  `filternumber( daily close >  1 day ago close,1) as 'default-percent-change-conditional-filters-color',  Daily Volume as 'scan-column-default-volume'`;

interface ChartinkRow {
  nsecode?: unknown;
  name?: unknown;
  bsecode?: unknown;
  close?: unknown;
  "%_change"?: unknown;
  volume?: unknown;
  rsi?: unknown;
  "scan-column-default-close"?: unknown;
  "scan-column-default-percent-change"?: unknown;
  "scan-column-default-volume"?: unknown;
}

interface ChartinkResponse {
  recordsTotal?: unknown;
  data?: unknown;
}

let cached: { expiresAt: number; payload: RsiEdgeSourcePayload } | null = null;
let pending: Promise<RsiEdgeSourcePayload> | null = null;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[,%\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseChartinkScanToken(html: string): string | null {
  return html.match(/scan_run_token(?:&quot;|")\s*:\s*(?:&quot;|")([a-f0-9]+)(?:&quot;|")/i)?.[1] ?? null;
}

export function normalizeChartinkRows(value: unknown): RsiEdgeSourceRow[] {
  if (!Array.isArray(value)) throw new Error("Chartink returned an invalid scanner result.");
  return value.map((raw, index) => {
    if (raw == null || typeof raw !== "object") {
      throw new Error(`Chartink returned an invalid row at position ${index + 1}.`);
    }
    const row = raw as ChartinkRow;
    const symbol = typeof row.nsecode === "string" ? row.nsecode.trim().toUpperCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const price = finiteNumber(row["scan-column-default-close"] ?? row.close);
    const changePercent = finiteNumber(row["scan-column-default-percent-change"] ?? row["%_change"]);
    const volume = finiteNumber(row["scan-column-default-volume"] ?? row.volume);
    if (!symbol || !name || price == null || changePercent == null || volume == null) {
      throw new Error(`Chartink result for row ${index + 1} is missing required market data.`);
    }
    return {
      symbol,
      name,
      bseCode: typeof row.bsecode === "string" ? row.bsecode : null,
      price,
      changePercent,
      volume,
      rsi: finiteNumber(row.rsi),
    };
  });
}

function responseCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? response.headers.get("set-cookie")?.split(/,(?=\s*[^;,]+=)/) ?? [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function xsrfToken(cookieHeader: string): string {
  const value = cookieHeader
    .split("; ")
    .find((cookie) => cookie.startsWith("XSRF-TOKEN="))
    ?.slice("XSRF-TOKEN=".length);
  if (!value) throw new Error("Chartink did not provide an XSRF token.");
  return decodeURIComponent(value);
}

async function fetchScanner(key: RsiEdgeScanKey): Promise<RsiEdgeSourceResult> {
  const definition = RSI_EDGE_SOURCES[key];
  const pageUrl = `${CHARTINK_ORIGIN}/screener/${definition.slug}`;
  const pageResponse = await fetch(pageUrl, {
    cache: "no-store",
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
  });
  if (!pageResponse.ok) throw new Error(`Chartink ${definition.label} page returned HTTP ${pageResponse.status}.`);

  const html = await pageResponse.text();
  const scanRunToken = parseChartinkScanToken(html);
  if (!scanRunToken) throw new Error(`Chartink did not provide a run token for ${definition.label}.`);
  const cookies = responseCookies(pageResponse);
  const response = await fetch(`${CHARTINK_ORIGIN}/screener/process`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookies,
      Referer: pageUrl,
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrfToken(cookies),
    },
    body: JSON.stringify({ scan_run_token: scanRunToken, column_clause: DEFAULT_COLUMNS }),
  });
  if (!response.ok) throw new Error(`Chartink ${definition.label} scan returned HTTP ${response.status}.`);

  const body = await response.json() as ChartinkResponse;
  const rows = normalizeChartinkRows(body.data);
  const total = finiteNumber(body.recordsTotal);
  if (total == null) throw new Error(`Chartink did not report a total for ${definition.label}.`);
  if (total !== rows.length) {
    throw new Error(`Chartink returned ${rows.length} of ${total} ${definition.label} results.`);
  }
  return { key, label: definition.label, slug: definition.slug, total, rows };
}

async function loadRsiEdgeSourceResults(): Promise<RsiEdgeSourcePayload> {
  const settled = await Promise.allSettled(RSI_EDGE_SCAN_KEYS.map(fetchScanner));
  const scanners: RsiEdgeSourcePayload["scanners"] = {};
  const errors: RsiEdgeSourcePayload["errors"] = {};
  settled.forEach((result, index) => {
    const key = RSI_EDGE_SCAN_KEYS[index];
    if (result.status === "fulfilled") scanners[key] = result.value;
    else errors[key] = result.reason instanceof Error ? result.reason.message : "Unknown Chartink error.";
  });
  if (Object.keys(scanners).length === 0) {
    throw new Error(Object.values(errors).join(" "));
  }
  return { updatedAt: Date.now(), delayed: true, scanners, errors };
}

export async function getRsiEdgeSourceResults(): Promise<RsiEdgeSourcePayload> {
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (!pending) {
    pending = loadRsiEdgeSourceResults()
      .then((payload) => {
        const ttl = Object.keys(payload.errors).length > 0 ? FAILURE_CACHE_MS : CACHE_MS;
        cached = { payload, expiresAt: Date.now() + ttl };
        return payload;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
