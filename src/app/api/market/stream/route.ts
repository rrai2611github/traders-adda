import {
  getDataSource,
  getMovers,
  getQuotes,
  getStatus,
  parseSymbols,
  subscribe,
} from "@/lib/market/engine";
import { marketProviderErrorMessage } from "@/lib/market/apiErrors";
import { DEFAULT_INDEX_SYMBOLS } from "@/lib/market/universe";
import type { MarketStatus, Quote } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;
const STATUS_REFRESH_MS = 30_000;
const MOVERS_REFRESH_MS = 3_000;

/**
 * Server-Sent Events channel carrying every live update the dashboard needs:
 * quote ticks, market-status transitions and ranked movers.
 *
 * SSE is used instead of raw WebSockets because the payload is server-to-client
 * only, it survives HTTP/2 proxies, and browsers reconnect automatically.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = parseSymbols(url.searchParams.get("symbols"));
  const wantMovers = url.searchParams.get("movers") !== "0";

  // Index quotes power the header strip on every screen, so they are always on.
  const symbols = [...new Set([...DEFAULT_INDEX_SYMBOLS, ...requested])];

  const encoder = new TextEncoder();
  let closed = false;
  const cleanups: Array<() => void> = [];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          shutdown();
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        for (const fn of cleanups) fn();
        cleanups.length = 0;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime — nothing to do.
        }
      };

      const reportProviderError = (error: unknown) => {
        if (closed) return;
        send("provider-error", { error: marketProviderErrorMessage(error) });
        shutdown();
      };

      const bootstrap = async () => {
        const [quotes, movers] = await Promise.all([
          getQuotes(symbols),
          wantMovers ? getMovers() : Promise.resolve(null),
        ]);
        if (closed) return;

        send("snapshot", {
          quotes,
          movers,
          status: getStatus(),
          dataSource: getDataSource(),
          subscribed: symbols,
        });

        // Subscribed only after the snapshot so the client never receives a
        // tick for a symbol it has no baseline for.
        cleanups.push(
          subscribe(
            symbols,
            (batch: Quote[]) => send("quotes", batch),
            reportProviderError,
          ),
        );
      };

      void bootstrap().catch(reportProviderError);

      let lastPhase: MarketStatus["phase"] | null = null;
      const statusTimer = setInterval(() => {
        const status = getStatus();
        if (status.phase !== lastPhase) {
          lastPhase = status.phase;
          send("status", status);
        }
      }, STATUS_REFRESH_MS);
      cleanups.push(() => clearInterval(statusTimer));

      if (wantMovers) {
        const moversTimer = setInterval(() => {
          void getMovers()
            .then((movers) => send("movers", movers))
            .catch(reportProviderError);
        }, MOVERS_REFRESH_MS);
        cleanups.push(() => clearInterval(moversTimer));
      }

      // Comment frames keep intermediaries from closing an idle connection,
      // which matters after market hours when no ticks are produced.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          shutdown();
        }
      }, HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeat));

      request.signal.addEventListener("abort", shutdown);
      cleanups.push(() =>
        request.signal.removeEventListener("abort", shutdown),
      );
    },
    cancel() {
      closed = true;
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
