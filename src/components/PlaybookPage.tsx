"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "./AppShell";
import { WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";
import { useAccountSize } from "@/hooks/useAccountSize";
import { formatPrice } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { computePositionSize, DEFAULT_RISK_PERCENT } from "@/lib/screen/positionSize";
import { SETUP_BREADTH_MIN } from "@/lib/screen/setupGate";
import { TRADE_STATUS, TRADE_STATUS_ORDER } from "@/lib/screen/tradeStatus";
import { authClient } from "@/lib/auth-client";

export interface PlaybookRules { name: string; lines: string[] }

interface Step { title: string; where: { label: string; href: string }[]; doThis: ReactNode; watch: ReactNode }

const STEPS: Step[] = [
  {
    title: "Check the market first",
    where: [{ label: "Today", href: "/" }],
    doThis: <>Read the market check banner at the top of the page and the <b>Is it a good day to buy?</b> card. The tested rules buy only while at least <b>{SETUP_BREADTH_MIN}%</b> of liquid stocks are above their 50-day average. If the check passes, normal size applies. If it fails, paper trade only, or risk no more than 0.25% of the account.</>,
    watch: <>&quot;No new buys, watch only&quot; means stop here today. The Nifty 50 against its 200-day average is shown for information only, not as a rule.</>,
  },
  {
    title: "See where strength is building",
    where: [{ label: "Sector Stage 2", href: "/#sector-stage-2" }, { label: "Daily Changes", href: "/#daily-changes" }, { label: "Market overview", href: "/#market" }],
    doThis: <>Note the sectors whose share of stocks in a Stage 2 uptrend is high or rising, and what entered or left Stage 2 on the latest session. Prefer candidates from strengthening sectors.</>,
    watch: <>These are breadth readings, not buy signals, and have not been backtested. Small sectors (under about 10 stocks) swing a lot on one stock.</>,
  },
  {
    title: "Find candidates",
    where: [{ label: "Today → Top picks", href: "/" }, { label: "Core Setups", href: "/#setups" }, { label: "Stage 2 Bases", href: "/#stage-2-bases" }, { label: "Stock Screener", href: "/#stock-screener" }],
    doThis: <>Start with <b>Top picks</b> on Today: it is the tested buy list (Blue sky and Multi-year breakouts). Use Core Setups to see the stocks behind it, Stage 2 Bases to see who broke out and who is close, and the Screener to filter on your own terms and save the scan to your account.</>,
    watch: <>A scanner match is only a candidate. It is never a recommendation on its own.</>,
  },
  {
    title: "Review saved-scan matches",
    where: [{ label: "Stock Screener", href: "/#stock-screener" }],
    doThis: <>Your saved filters are attached to your account. The <b>In-app saved-scan matches</b> panel compares them with the current screener results and shows matching stocks as the market scan refreshes.</>,
    watch: <>A match is a snapshot of screening criteria, not a buy signal, email or push alert, or a historical replay. Check the market gate, stock status and trade plan separately.</>,
  },
  {
    title: "Read the status",
    where: [{ label: "Click any symbol to open its drawer", href: "/" }],
    doThis: <>Every stock carries one status, used everywhere in the app. Act only on <b>Buy ready</b>. Do not chase <b>Extended</b>: wait for a pullback. <b>Watch</b> means the stock passes but the market check does not yet.</>,
    watch: <>Ratings and scores explain a status. They are the share of checks passed, not a chance of winning.</>,
  },
  {
    title: "Check the plan and the risks",
    where: [{ label: "Stock drawer", href: "/" }, { label: "Setup Lab", href: "/#setup-lab" }],
    doThis: <>Look at the plan&apos;s entry, stop and partial-profit levels, the liquidity (₹ Cr traded a day), the chart itself, and any <b>Results in N days</b> warning: a results announcement can gap the price straight through your stop. Optionally use the Setup Lab to see how similar setups behaved.</>,
    watch: <>The Lab shows past patterns with survivorship bias and mostly one market regime. It can suggest a hypothesis. It cannot prove a setup works.</>,
  },
  {
    title: "Size the position",
    where: [{ label: "Calculator on this page", href: "#size" }],
    doThis: <>Work out the share count from your stop, not from a feeling: shares = what you can afford to lose ÷ the loss per share. A further stop means fewer shares. Never risk more than 2% of the account on one trade, and never put more than 20% of it in one stock. The rules hold at most 10 positions and add at most 3 a day.</>,
    watch: <>If the calculator says 0 shares, the stop is too wide for your account. Skip the trade.</>,
  },
  {
    title: "Practise before real money",
    where: [{ label: "Positions & strategy → Live strategy check", href: "/positions#strategy-check" }, { label: "Paper trades & journal", href: "/#journal" }],
    doThis: <>Follow the rules on paper first. The live strategy check runs the exact rules with pretend money on real daily prices, so you can see how they behave before trusting them. Judge it on a meaningful number of finished trades, not a handful (a rule of thumb here is about 30), and watch the strategy health warning.</>,
    watch: <>The strategy loses more often than it wins and makes money because the winners are bigger. Expect long losing stretches. Paper trading is how you learn to sit through them.</>,
  },
  {
    title: "Place the trade yourself, then record it",
    where: [{ label: "Positions & strategy → I bought a stock", href: "/positions" }, { label: "Tomorrow's orders", href: "/positions#order-approvals" }],
    doThis: <>Place the buy and its stop in your own broker. Then record it with <b>I bought it →</b> on a Top pick (it fills the symbol, buy price and stop) or in <b>My positions</b>. The app never places orders on its own. Tomorrow&apos;s orders can prepare broker orders from the plan, but only after you review and confirm, and it is a dry run that sends nothing unless live orders are switched on.</>,
    watch: <>Record every real trade, including the losers. The journal is only useful if it is complete.</>,
  },
  {
    title: "Manage the exit by the rules",
    where: [{ label: "Positions & strategy → Open positions", href: "/positions" }],
    doThis: <>The real exits are the <b>stop</b> and <b>a close under the 50-day average</b>. The +16% and +24% levels are only places where you may book part of the profit. The page tells you when positions need a decision, and warns about too many positions in one sector.</>,
    watch: <>Do not move a stop down to avoid a loss. Do not sell everything at a target if the rules say the trend is intact.</>,
  },
  {
    title: "Review",
    where: [{ label: "Results", href: "/performance" }, { label: "Email track record", href: "/radar" }, { label: "Backtest (10 years)", href: "/backtest" }],
    doThis: <>Each week, compare closed trades, win rate and worst drop with what the backtest said is normal. Use the email track record to see how past emailed picks did, and the Results page to confirm the data and automation are healthy. Historical strategy tests use fixed rules; they do not replay your saved screener filters.</>,
    watch: <>A result that sits far outside the normal range is a reason to pause and look, not to change the rules after a few trades.</>,
  },
];

const QUESTIONS: [string, string, string][] = [
  ["Is it a good day to buy?", "Today (banner and breadth card)", "/"],
  ["Which sectors are strengthening?", "Sector Stage 2", "/#sector-stage-2"],
  ["What changed since yesterday?", "Daily Changes", "/#daily-changes"],
  ["Which stocks just broke out, or are close?", "Stage 2 Bases", "/#stage-2-bases"],
  ["Find stocks on my own conditions", "Stock Screener (save filters and review current matches)", "/#stock-screener"],
  ["Has a setup like this worked before?", "Setup Lab", "/#setup-lab"],
  ["How did a supported strategy behave historically?", "Historical backtest (fixed presets)", "/backtest"],
  ["How did past emailed picks do?", "Email track record", "/radar"],
  ["What do I hold, and what needs action?", "Positions & strategy", "/positions"],
  ["How is the paper strategy doing?", "Positions & strategy → Live strategy check", "/positions#strategy-check"],
  ["Is the data and automation healthy?", "Results", "/performance"],
  ["Explain a stock or the app in plain words", "Assistant", "/assistant"],
];

const EVIDENCE: [string, string, "tested" | "thin" | "none"][] = [
  ["The tested strategy (Blue sky + Multi-year breakouts, 12% stop, exit under the 50-day average)", "Backtested over ten years and followed live on paper. The history only holds stocks listed today, so the backtest is optimistic.", "tested"],
  ["The market check (at least 35% of stocks above their 50-day average)", "The gate the ten-year backtest used. A Nifty 200-day filter was dropped after it proved fragile.", "tested"],
  ["Supported historical backtests", "Members can compare fixed strategy presets. They do not backtest personal saved-scan thresholds, predict future results, or include delisted stocks.", "none"],
  ["Stage 2 Bases", "Backtested in this project: breakouts on thin volume lost money in both halves of the period; volume-confirmed breakouts were close to breakeven. No proven edge. A watch list.", "thin"],
  ["Bottomed Out", "Only the deep tier (50%+ below the high) held up, with a thin edge. Experimental.", "thin"],
  ["Sector Stage 2, Daily Changes, Stock Screener and saved-scan matches", "Descriptive: they report what is true in the current scan. Not historically backtested, and not signals.", "none"],
  ["Setup Lab", "Shows how a combination behaved in past data, with survivorship bias and mostly one regime. Trying many combinations will find some that look good by chance.", "none"],
  ["Older scanner sections and horizon reference levels", "Their own backtests show no proven edge. Reference levels, not recommendations.", "none"],
];

const MISTAKES = [
  "Buying on a scanner hit alone, without the status, the plan and the market check.",
  "Chasing an Extended stock instead of waiting for a pullback.",
  "Sizing by feeling instead of from the stop.",
  "Moving a stop down, or widening it after you are in.",
  "Ignoring a results date inside the next two weeks.",
  "Judging the strategy after three or four trades.",
  "Tuning filters in the Setup Lab until a result looks good, then trusting it.",
  "Holding many positions in one sector at once.",
];

function Section({ id, title, note, children }: { id?: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      {note && <p className="mt-1 text-sm leading-6 text-slate-600">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SizeCalculator() {
  const { accountSize, setAccountSize } = useAccountSize();
  // While typing, the box shows exactly what was typed (so it can be cleared); the saved size only takes valid numbers.
  const [accountText, setAccountText] = useState<string | null>(null);
  const [entry, setEntry] = useState("500");
  const [stopPercent, setStopPercent] = useState("12");
  const [risk, setRisk] = useState(String(DEFAULT_RISK_PERCENT));
  const e = Number(entry);
  const s = Number(stopPercent);
  const r = Number(risk);
  const stop = e * (1 - s / 100);
  const valid = e > 0 && s > 0 && s < 100 && r > 0 && r <= 5;
  const size = valid ? computePositionSize({ accountSize, entry: e, stop, riskPercent: r }) : null;
  const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="block font-bold text-slate-800">Account (₹)
          <input className={field} type="number" min={1} inputMode="numeric" value={accountText ?? String(accountSize)} onBlur={() => setAccountText(null)} onChange={(ev) => { setAccountText(ev.target.value); setAccountSize(Number(ev.target.value)); }} /></label>
        <label className="block font-bold text-slate-800">Risk per trade (%)
          <input className={field} type="number" min={0.1} max={5} step={0.25} inputMode="decimal" value={risk} onChange={(ev) => setRisk(ev.target.value)} /></label>
        <label className="block font-bold text-slate-800">Buy price (₹)
          <input className={field} type="number" min={1} inputMode="decimal" value={entry} onChange={(ev) => setEntry(ev.target.value)} /></label>
        <label className="block font-bold text-slate-800">Stop below buy (%)
          <input className={field} type="number" min={1} max={50} inputMode="decimal" value={stopPercent} onChange={(ev) => setStopPercent(ev.target.value)} /></label>
        <p className="col-span-2 leading-5 text-slate-500">The tested rules use a 12% stop and risk 2%; many people start at 1% or less while learning. The account size is shared with the stock drawer&apos;s calculator and stays on this device.</p>
      </div>
      <div aria-live="polite" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
        {!size ? <p className="text-slate-600">Enter a buy price, a stop between 1% and 50%, and a risk between 0.1% and 5%.</p> : size.tooSmall ? (
          <p className="font-bold text-rose-800">0 shares. At a stop of ₹{formatPrice(stop)} the loss per share is ₹{formatPrice(e - stop)}, which is more than your ₹{formatPrice(size.riskBudget)} risk budget allows. Skip this trade or use a tighter, valid stop.</p>
        ) : (<>
          <p className="text-lg font-black text-slate-900">Buy {size.quantity.toLocaleString("en-IN")} share{size.quantity === 1 ? "" : "s"}</p>
          <p className="mt-1 text-slate-700">Stop at <b>₹{formatPrice(stop)}</b>. Cost about <b>₹{formatPrice(size.capitalRequired)}</b> ({((size.capitalRequired / accountSize) * 100).toFixed(1)}% of the account). If stopped out you lose about <b>₹{formatPrice(size.riskAmount)}</b> ({((size.riskAmount / accountSize) * 100).toFixed(2)}%) before costs.</p>
          {size.capitalCapped && <p className="mt-1 text-amber-800">Capped by the cash in the account, not by the risk budget.</p>}
          {size.capitalRequired / accountSize > 0.2 && <p className="mt-1 font-bold text-amber-800">That is over 20% of the account in one stock, above the tested rules&apos; cap.</p>}
        </>)}
      </div>
    </div>
  );
}

export function PlaybookPage({ rules }: { rules: PlaybookRules }) {
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const steps = isAdmin ? STEPS : STEPS.map((step) => {
    if (step.title === "Review") {
      return {
        ...step,
        where: [{ label: "Historical backtest (fixed presets)", href: "/backtest" }, { label: "Positions & strategy", href: "/positions" }],
        doThis: <>Compare the supported fixed strategy tests with your own paper-trading results. These tests use shared historical prices; they do not replay your personal saved screener filters. Use them as research, not forecasts.</>,
        watch: <>The history contains stocks listed today, not delisted companies, so results can be optimistic. A positive backtest does not guarantee future results.</>,
      };
    }
    if (step.title === "Place the trade yourself, then record it") {
      return {
        ...step,
        where: [{ label: "Positions & strategy → I bought a stock", href: "/positions" }],
        doThis: <>Place the buy and stop in your own broker; the app never places orders. Record the trade with <b>I bought it →</b> on a Top pick or in <b>My positions</b>, including the losing trades.</>,
      };
    }
    return step;
  });
  const questions = isAdmin ? QUESTIONS : QUESTIONS.filter(([, , href]) => href !== "/radar" && href !== "/performance");
  return (
    <AppShell current="playbook">
      <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
        <WorkspaceFrame id="playbook">
          <WorkspaceHero eyebrow="Playbook" icon="about" title="How to trade with this app"
            description="A step-by-step routine: check the market, find candidates, review saved-scan matches, size positions, practise and exit by the rules. It also explains the limits of historical tests." />
          <div className="space-y-4 bg-slate-50/60 p-5">
            <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              <h3 className="font-black">Read this first</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>This app analyses markets. It does not give investment advice, and you place every order yourself, in your own broker.</li>
                <li><b>The strategy is a tested rule set, not a promise.</b> {GLOSSARY.backtest.text}</li>
                <li>Start on paper. Follow the rules with pretend money until you trust them, and size real trades small.</li>
                <li>Losses are part of the plan: {GLOSSARY.winRate.text} {GLOSSARY.drawdown.text}</li>
              </ul>
            </div>

            <Section title={rules.name} note="The strategy the app is built around, in its own words. These lines come straight from the rules the live strategy check follows.">
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">{rules.lines.map((line) => <li key={line}>{line}</li>)}</ol>
              <p className="mt-3 text-xs leading-5 text-slate-500"><b>Blue sky:</b> {GLOSSARY.blueSky.text} <b>Multi-year breakout:</b> {GLOSSARY.multiYear.text}</p>
            </Section>

            <Section title="Your routine, step by step" note="Do this once a day, after the close or before the open. The scans use finished daily candles, so there is nothing to gain from watching them minute by minute.">
              <ol className="space-y-3">
                {steps.map((step, index) => (
                  <li key={step.title} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-700" aria-hidden>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-black text-slate-900">{step.title}</h4>
                        <p className="mt-1 text-sm leading-6 text-slate-700">{step.doThis}</p>
                        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"><b className="text-slate-800">Watch for:</b> {step.watch}</p>
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-slate-500">Where:</span>
                          {step.where.map((place) => (place.href.startsWith("#")
                            ? <a key={place.label} href={place.href} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-bold text-emerald-800 hover:bg-emerald-100">{place.label}</a>
                            : <Link key={place.label} href={place.href} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-bold text-emerald-800 hover:bg-emerald-100">{place.label}</Link>))}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="What each status means" note="One vocabulary, used on every page and in the emails.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {TRADE_STATUS_ORDER.filter((key) => key !== "short-ready").map((key) => (
                  <li key={key} className="rounded-xl border border-slate-200 p-3 text-sm leading-6"><b>{TRADE_STATUS[key].emoji} {TRADE_STATUS[key].label}</b><span className="block text-slate-600">{TRADE_STATUS[key].meaning}</span></li>
                ))}
              </ul>
            </Section>

            <Section id="size" title="Position size calculator" note="Try your own numbers. It uses the same calculation as the stock drawer.">
              <SizeCalculator />
              <p className="mt-3 text-xs leading-5 text-slate-500">{GLOSSARY.positionSize.text}</p>
            </Section>

            <Section title="Which page answers which question">
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Question</th><th className="px-4 py-2">Go to</th></tr></thead>
                  <tbody>{questions.map(([question, page, href]) => (
                    <tr key={question} className="border-t border-slate-200"><td className="px-4 py-2.5">{question}</td><td className="px-4 py-2.5"><Link href={href} className="font-bold text-emerald-700 hover:underline">{page}</Link></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>

            <Section title="What is proven, and what is not" note="Not every tool in the app has the same standing. Know which is which before you rely on one.">
              <ul className="space-y-2">
                {EVIDENCE.map(([name, text, level]) => (
                  <li key={name} className="flex gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-6">
                    <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${level === "tested" ? "bg-emerald-100 text-emerald-800" : level === "thin" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}`}>{level === "tested" ? "Tested" : level === "thin" ? "Thin edge" : "Not proven"}</span>
                    <span><b>{name}.</b> <span className="text-slate-600">{text}</span></span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Common mistakes">
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-700">{MISTAKES.map((m) => <li key={m}>{m}</li>)}</ul>
            </Section>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              <h3 className="font-black">Important risk notice</h3>
              <p className="mt-2">This is a market analytics and charting tool, not investment advice, and not a SEBI-registered adviser or research analyst service. Markets carry risk; you can lose money. Validate every setup yourself and consult a registered adviser where appropriate. More in <Link href="/#about" className="font-bold underline">About &amp; risk</Link>.</p>
            </div>
          </div>
        </WorkspaceFrame>
      </div>
    </AppShell>
  );
}
