/**
 * One small, shared way to call Claude from the app's own jobs (news check, daily briefing, weekly review). No SDK: a single POST to the
 * Messages API. Prices are list prices in USD per million tokens (platform.claude.com pricing page, prompts up to 100,000 tokens).
 */
export const MODELS = {
  haiku: { id: "claude-haiku-5-5", inputPerMTok: 0.1, outputPerMTok: 0.5 },
  sonnet: { id: "claude-sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10 },
} as const;

export type ModelKey = keyof typeof MODELS;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export const costOf = (model: ModelKey, usage: Usage) => (usage.inputTokens * MODELS[model].inputPerMTok + usage.outputTokens * MODELS[model].outputPerMTok) / 1_000_000;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AskOptions {
  model: ModelKey;
  system: string;
  user: string;
  maxTokens: number;
}

/** One call to the Messages API; throws on a non-OK reply so the caller can fall back. */
export async function askModel(options: AskOptions, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ text: string; usage: Usage }> {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODELS[options.model].id, max_tokens: options.maxTokens, system: options.system, messages: [{ role: "user", content: options.user }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Claude API HTTP ${response.status}`);
  const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
}

/** The first JSON array of strings in a reply, trimmed and capped; [] when there is none. */
export function parseStringArray(text: string, maxItems: number, maxLength: number): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, maxItems)
      .map((x) => (x.length > maxLength ? `${x.slice(0, maxLength - 1)}…` : x));
  } catch {
    return [];
  }
}
