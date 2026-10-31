"use client";

import Link from "next/link";
import { ScalpNav } from "./ScalpNav";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScalpDeskData } from "@/lib/scalp/desk";
import type { ScalpIndex } from "@/lib/scalp/scalpLogic";
import { ScalpChart, type ChartLevel, type ChartLine, type ChartMarker } from "./ScalpChart";

interface FyersStatus {
  configured: boolean;
  connected: boolean;
}

const OFFSETS = [
  { value: -2, label: "ITM 2" },
  { value: -1, label: "ITM 1" },
  { value: 0, label: "ATM" },
  { value: 1, label: "OTM 1" },
  { value: 2, label: "OTM 2" },
];

const timeIst = (t: number) =>
  new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

const lakh = (n: number) => (Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString("en-IN"));

/** Poll fast only around market hours (09:00–15:35 IST, Mon–Fri). */
function marketWindow(now = Date.now()) {
  const ist = new Date(now + 19_800_000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const day = ist.getUTCDay();
  return day >= 1 && day <= 5 && minute >= 540 && minute <= 935;
}

export function ScalpDesk({ notice }: { notice: { kind: "connected" | "error" | "not-configured"; message?: string } | null }) {
  const [index, setIndex] = useState<ScalpIndex>("NIFTY");
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<FyersStatus | null>(null);
  const [desk, setDesk] = useState<ScalpDeskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/scalp/desk?index=${index}&offset=${offset}`, { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) {
        setStatus({ configured: !!body.configured, connected: false });
        setDesk(null);
        setError(null);
      } else if (!response.ok) {
        setError(body.error || `Desk failed (HTTP ${response.status})`);
      } else {
        setStatus({ configured: true, connected: true });
        setDesk(body as ScalpDeskData);
        setError(null);
      }
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setLoading(false);
    }
  }, [index, offset]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer = setTimeout(tick, marketWindow() ? 10_000 : 60_000);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const disconnect = async () => {
    await fetch("/api/fyers/status", { method: "DELETE" });
    setDesk(null);
    setStatus((s) => (s ? { ...s, connected: false } : s));
  };

  return (
    <main className="min-h-screen bg-[#060b16] text-slate-200">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-3 py-3 sm:px-5">
        <ScalpNav current="desk" />
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-3">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Index Scalp Desk</h1>
            <p className="text-xs text-slate-400">1-minute ATM Call · Spot · ATM Put, with VWAP, EMA 9/21 and opening range. Data: Fyers.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-700">
              {(["NIFTY", "BANKNIFTY"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setIndex(value); setDesk(null); }}
                  className={`px-3 py-1.5 text-xs font-bold ${index === value ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                >
                  {value === "NIFTY" ? "Nifty 50" : "Bank Nifty"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              Strike
              <select
                value={offset}
                onChange={(event) => { setOffset(Number(event.target.value)); setDesk(null); }}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-bold text-slate-100"
              >
                {OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <ConnectionBadge status={status} loading={loading} desk={desk} onDisconnect={disconnect} />
          </div>
        </header>

        {notice ? <Notice notice={notice} /> : null}
        {error ? <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</div> : null}

        {status && !status.connected ? <ConnectPanel configured={status.configured} /> : null}
        {!status ? <div className="py-20 text-center text-sm text-slate-500">Checking Fyers connection…</div> : null}
        {status?.connected && !desk && !error ? <div className="py-20 text-center text-sm text-slate-500">Loading {index === "NIFTY" ? "Nifty" : "Bank Nifty"} 1-minute data…</div> : null}
        {desk ? <DeskView desk={desk} /> : null}

        <p className="pb-4 text-[11px] leading-relaxed text-slate-500">
          Education and research tool, not investment advice. Setups are drawn from fixed rules and have not been backtested yet; most retail F&amp;O
          traders lose money (SEBI study: ~9 in 10). No orders are placed from this screen.
        </p>
      </div>
    </main>
  );
}

function ConnectionBadge({ status, loading, desk, onDisconnect }: {
  status: FyersStatus | null;
  loading: boolean;
  desk: ScalpDeskData | null;
  onDisconnect: () => void;
}) {
  if (!status?.connected) return null;
  const stale = desk?.lastBarAt != null && marketWindow(desk.generatedAt) && desk.generatedAt - desk.lastBarAt > 3 * 60_000;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold ${stale ? "bg-amber-900/60 text-amber-200" : "bg-green-900/50 text-green-300"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse" : ""} ${stale ? "bg-amber-400" : "bg-green-400"}`} />
        {desk?.lastBarAt ? `${stale ? "Delayed" : "Live"} · bar ${timeIst(desk.lastBarAt)}` : "Fyers connected"}
      </span>
      <button type="button" onClick={onDisconnect} className="rounded-md border border-slate-700 px-2 py-1 text-slate-400 hover:bg-slate-800">
        Disconnect
      </button>
    </div>
  );
}

function Notice({ notice }: { notice: { kind: "connected" | "error" | "not-configured"; message?: string } }) {
  if (notice.kind === "connected") {
    return <div className="rounded-lg border border-green-900 bg-green-950/50 px-3 py-2 text-xs text-green-200">Fyers connected for today.</div>;
  }
  if (notice.kind === "error") {
    return <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{notice.message || "Fyers login failed."}</div>;
  }
  return null;
}

function ConnectPanel({ configured }: { configured: boolean }) {
  return (
    <section className="mx-auto mt-6 w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0b1220] p-6">
      <h2 className="text-lg font-black text-white">{configured ? "Connect Fyers for today" : "Set up Fyers market data"}</h2>
      {configured ? (
        <>
          <p className="mt-2 text-sm text-slate-400">
            Fyers access tokens last one trading day, so log in once each morning. The app only reads market data; it cannot place orders.
          </p>
          <a href="/api/fyers/login" className="mt-4 inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-400">
            Connect Fyers
          </a>
        </>
      ) : (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>Open a free Fyers account and sign in to <span className="font-mono text-sky-300">myapi.fyers.in</span> → Dashboard → Create App.</li>
          <li>Set the Redirect URL to <span className="font-mono text-sky-300">http://127.0.0.1:3107/api/fyers/callback</span>. Data permissions are enough.</li>
          <li>
            Add these lines to <span className="font-mono">.env.local</span> yourself (never share the secret):
            <pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">{`FYERS_APP_ID=XXXXXXXX-100
FYERS_SECRET_ID=your-secret
FYERS_REDIRECT_URI=http://127.0.0.1:3107/api/fyers/callback`}</pre>
          </li>
          <li>Restart the app, reopen this page and click <b>Connect Fyers</b>.</li>
        </ol>
      )}
    </section>
  );
}

function DeskView({ desk }: { desk: ScalpDeskData }) {
  const spotLines = useMemo<ChartLine[]>(() => [
    { key: "ema9", title: "EMA 9", color: "#38bdf8", points: desk.spot.ema9 },
    { key: "ema21", title: "EMA 21", color: "#f59e0b", points: desk.spot.ema21 },
  ], [desk]);
  const spotLevels = useMemo<ChartLevel[]>(() => {
    const levels: ChartLevel[] = [];
    if (desk.spot.orb) {
      levels.push({ price: desk.spot.orb.high, title: "ORB H", color: "#a78bfa" }, { price: desk.spot.orb.low, title: "ORB L", color: "#a78bfa" });
    }
    if (desk.spot.prev) {
      levels.push({ price: desk.spot.prev.high, title: "PDH", color: "#64748b" }, { price: desk.spot.prev.low, title: "PDL", color: "#64748b" });
    }
    return levels;
  }, [desk]);
  const markers = useMemo<ChartMarker[]>(
    () => desk.signals.map((s) => ({ t: s.t, up: s.side === "CE", text: `${s.side} setup` })),
    [desk],
  );
  const legLines = (leg: ScalpDeskData["ce"]): ChartLine[] => (leg ? [{ key: "vwap", title: "VWAP", color: "#f59e0b", points: leg.vwap }] : []);
  const ceLines = useMemo(() => legLines(desk.ce), [desk]);
  const peLines = useMemo(() => legLines(desk.pe), [desk]);
  const ceMarkers = useMemo(() => markers.filter((m) => m.up), [markers]);
  const peMarkers = useMemo(() => markers.filter((m) => !m.up).map((m) => ({ ...m, up: true })), [markers]);
  const straddleLines = useMemo<ChartLine[]>(() => [{ key: "straddle", title: "CE+PE", color: "#e879f9", points: desk.straddle }], [desk]);
  const legTitle = (leg: ScalpDeskData["ce"], side: string) => (leg ? `${desk.name} ${leg.strike} ${side}` : `${side} — not available`);
  const legSub = (leg: ScalpDeskData["ce"]) => (leg ? `OI ${lakh(leg.oi)} (${leg.oiChange >= 0 ? "+" : ""}${lakh(leg.oiChange)}) · ${leg.symbol.replace("NSE:", "")}` : undefined);

  return (
    <>
      <StatsBar desk={desk} />
      <div className="grid gap-3 xl:grid-cols-3">
        <ScalpChart title={legTitle(desk.ce, "CE")} subtitle={legSub(desk.ce)} bars={desk.ce?.bars ?? []} lines={ceLines} markers={ceMarkers} />
        <ScalpChart
          title={`${desk.name} spot · 1m`}
          subtitle="EMA 9/21 · ORB = first 15 min · PDH/PDL = previous day"
          bars={desk.spot.bars}
          lines={spotLines}
          levels={spotLevels}
          markers={markers}
          showVolume={false}
        />
        <ScalpChart title={legTitle(desk.pe, "PE")} subtitle={legSub(desk.pe)} bars={desk.pe?.bars ?? []} lines={peLines} markers={peMarkers} />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <SignalsPanel desk={desk} />
        <ChainStrip desk={desk} />
        <ScalpChart
          title={`Straddle ${desk.ce?.strike ?? ""} CE + ${desk.pe?.strike ?? ""} PE`}
          subtitle="Rising = options getting pricier (move expected); falling = premium decay"
          bars={[]}
          lines={straddleLines}
          height={260}
        />
      </div>
      {desk.warnings.length ? (
        <ul className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-[11px] text-amber-200">
          {desk.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      ) : null}
    </>
  );
}

function StatsBar({ desk }: { desk: ScalpDeskData }) {
  const fut = desk.futures;
  const items: { label: string; value: string; tone?: string }[] = [
    { label: "Spot", value: desk.spot.ltp?.toFixed(2) ?? "—" },
    { label: "ATM", value: desk.atm?.toString() ?? "—" },
    { label: "Expiry", value: desk.expiry ?? "—" },
    { label: "PCR", value: desk.pcr?.toFixed(2) ?? "—", tone: desk.pcr == null ? undefined : desk.pcr >= 1 ? "text-green-400" : "text-red-400" },
    { label: "Max Call OI", value: desk.maxCallOiStrike?.toString() ?? "—", tone: "text-red-300" },
    { label: "Max Put OI", value: desk.maxPutOiStrike?.toString() ?? "—", tone: "text-green-300" },
    { label: "India VIX", value: desk.vix?.toFixed(2) ?? "—" },
    {
      label: "Futures vs VWAP",
      value: fut?.side ? `${fut.side} ${fut.vwap?.toFixed(1)}` : "n/a",
      tone: fut?.side === "above" ? "text-green-400" : fut?.side === "below" ? "text-red-400" : undefined,
    },
    { label: "Opening range", value: desk.spot.orb ? `${desk.spot.orb.low.toFixed(0)} – ${desk.spot.orb.high.toFixed(0)}${desk.spot.orb.complete ? "" : " (forming)"}` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800 sm:grid-cols-3 lg:grid-cols-9">
      {items.map((item) => (
        <div key={item.label} className="bg-[#0b1220] px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.label}</div>
          <div className={`font-mono text-sm font-bold ${item.tone ?? "text-slate-100"}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function SignalsPanel({ desk }: { desk: ScalpDeskData }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">Today&apos;s ORB setups</h2>
        <Link href="/scalp/backtest" className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:underline">Not proven · see backtest →</Link>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Rule: 1-min close breaks the first-15-min range, EMA 9/21 agree, futures and the option are on the right side of VWAP. Plan:
        stop {desk.stopPoints} index pts, target 1.5R, exit after 10 min if neither hits, max 3 a day, none after 15:00.
      </p>
      {desk.signals.length ? (
        <ul className="mt-2 space-y-2">
          {desk.signals.map((s) => (
            <li key={s.t} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
              <div className="flex items-center justify-between font-mono">
                <span className={`font-bold ${s.side === "CE" ? "text-green-400" : "text-red-400"}`}>
                  {timeIst(s.t)} · {s.side === "CE" ? "Buy CE (up)" : "Buy PE (down)"}
                </span>
                <span className="text-slate-300">spot {s.entry.toFixed(1)}</span>
              </div>
              <div className="mt-1 font-mono text-slate-400">Stop {s.stop.toFixed(1)} · Target {s.target.toFixed(1)} · Time stop {s.timeStopMin}m</div>
              <div className="mt-1 text-[11px] text-slate-500">{s.reasons.join(" · ")}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No setup yet today{desk.spot.orb?.complete ? "." : " — waiting for the 15-minute opening range to finish."}</p>
      )}
    </section>
  );
}

function ChainStrip({ desk }: { desk: ScalpDeskData }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1220]">
      <div className="border-b border-slate-800 px-3 py-2">
        <h2 className="text-sm font-bold text-white">Option chain near ATM</h2>
        <p className="text-[11px] text-slate-400">Open interest and its change vs the previous day (L = lakh). Bold = highest OI in this strip.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right font-mono text-[11px]">
          <thead className="text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">CE OI</th>
              <th className="px-2 py-1">Chg</th>
              <th className="px-2 py-1">CE LTP</th>
              <th className="px-2 py-1 text-center">Strike</th>
              <th className="px-2 py-1 text-left">PE LTP</th>
              <th className="px-2 py-1 text-left">Chg</th>
              <th className="px-2 py-1 text-left">PE OI</th>
            </tr>
          </thead>
          <tbody>
            {desk.chain.map((row) => {
              const atm = row.strike === desk.atm;
              return (
                <tr key={row.strike} className={atm ? "bg-sky-950/60" : "border-t border-slate-900"}>
                  <td className={`px-2 py-1 ${row.strike === desk.maxCallOiStrike ? "font-bold text-red-300" : "text-slate-300"}`}>{row.ce ? lakh(row.ce.oi) : "—"}</td>
                  <td className={`px-2 py-1 ${row.ce && row.ce.oiChange < 0 ? "text-red-400" : "text-green-400"}`}>{row.ce ? lakh(row.ce.oiChange) : ""}</td>
                  <td className="px-2 py-1 text-slate-100">{row.ce?.ltp.toFixed(2) ?? "—"}</td>
                  <td className={`px-2 py-1 text-center font-bold ${atm ? "text-sky-300" : "text-slate-200"}`}>{row.strike}</td>
                  <td className="px-2 py-1 text-left text-slate-100">{row.pe?.ltp.toFixed(2) ?? "—"}</td>
                  <td className={`px-2 py-1 text-left ${row.pe && row.pe.oiChange < 0 ? "text-red-400" : "text-green-400"}`}>{row.pe ? lakh(row.pe.oiChange) : ""}</td>
                  <td className={`px-2 py-1 text-left ${row.strike === desk.maxPutOiStrike ? "font-bold text-green-300" : "text-slate-300"}`}>{row.pe ? lakh(row.pe.oi) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
