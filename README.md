This is a [Next.js](https://nextjs.org) stock-analysis dashboard.

## RPCI-style price-contraction approximation

The Screens area includes a separate **RPCI-style results · approximation** section. It is **not** the proprietary RPCI indicator: its exact calculation and rules are not public, so these results must not be represented as genuine RPCI signals.

The section scans the same eligible equity universe as the existing screens (minimum ₹5 crore median daily turnover; minimum ₹500 crore market cap when known). A result requires RS ≥70, price at or above both the 50- and 200-session moving averages, and price within 25% of its 52-week high. It compares three consecutive 20-session high-to-low ranges: the middle range must be ≤0.9 times the oldest; the newest must be ≤0.75 times the middle and ≤18%. Newest-window average volume must be ≤0.8 times the middle window. Price must be between 8% below and 3% above the newest base's high (the pivot). Missing history or metrics disqualify a stock.

The newest daily candle is included after the session closes (including weekends) but excluded during a live session. A stock is **Forming** below the pivot; a live move above it is **Testing pivot**. **Confirmed breakout** requires the latest completed daily candle to close above the *preceding* 20-session pivot with volume ≥1.5 times the prior 20-session average, while the current price remains above that pivot. The breakout candle is excluded from the quiet base's range and volume calculations. These are screening labels, not guarantees of a successful trade.

Each RPCI-style result shows its completed-candle and quote timestamps in IST and identifies stale, missing, simulated, closed-market or recent data. While the market is open, a quote older than five minutes is labeled delayed; a scan older than 90 seconds is stale. Yahoo Finance quote latency is unverified, so a recent quote is not guaranteed real-time. An unavailable quote uses the last candle close for screening and is identified as such. Refresh failures are shown separately. The **Review plan** disclosure shows the base high as an illustrative entry trigger, the base low as structural invalidation and their per-share/percentage risk; it does not include sizing, fees, slippage, execution price or a recommendation to trade. Verify the data and setup yourself, especially when the market is closed or data is stale.

This independent approximation does not modify the existing VCP or other preset memberships. It is a screening aid, not a verified entry signal or investment advice.

Check the approximation thresholds with `node --test scripts/rpci-approx.test.mjs`.

## Interpreting the dashboard

### Local application research chatbot

Open `/assistant` from the workspace sidebar, the Performance page or
**Ask about this stock** in the stock drawer. Ask **Which stocks should I keep
on my radar?**, **How is the market?**, **Which strategy does the app use?**,
**How are the paper results?** or **Is Fyers/email/paper trading working?**;
stock selection is optional. Radar uses up to six non-extended, validated
Top Picks/watch candidates in the app's existing order, not a new ranking.
Weak breadth means watch only; stale/limited data is labelled research only.
Type **Analyse SBIN** or **Compare SBIN and ICICIBANK**, or select equities
using the always-visible stock-name/symbol selectors above the message box
(selection is optional). Explicit recognised symbols/full names
override selected context; app-wide questions ignore selected stocks.
Ask **Is SBIN bullish or bearish?**, **Can I buy Infosys?**, **What are its
risks?**, **What is its price?**, **Explain its volume**, or **Show support
and resistance**. Replies start with the requested answer instead of a generic
research introduction. Bullish/Bearish/Mixed daily trend reuses the drawer's
50/200-day quick-read logic; missing averages, stale/failed or simulated data
withhold the verdict. This is separate from liquidity/breadth/setup approval:
a bullish stock may still be watch-only. SMA/pivot references are not claimed
as confirmed support/resistance, and intraday requests are explicitly unsupported
by this daily-data adapter. Company names may omit Limited/Ltd.
Stock-topic follow-ups such as **Why?** retain their topic and selected symbols.
Explicit follow-ups such as **Why these stocks?** revisit the last app topic.
Suggested questions and selected symbols support follow-ups; the last
10 responses are kept in page memory only and cleared on reload.
The chat interface shows your message immediately followed by a pending
indicator and the research reply. Search either stock selector by company name
or symbol; suggestions show both, and the selected stock remains visible as a
removable chip. Arrow keys and Enter select a suggestion; Escape dismisses it.
The message box uses Enter to send and Shift+Enter for a new line. Search
failures and no matches are explicit. This is a local, bounded research chatbot,
not a general-purpose language model.

`POST /api/assistant` reads the shared validated universe scan and the same
deterministic Top Picks builder, plus approved performance/status readers with
private recorded-position reads disabled. Paper/replay portfolios remain
separate, unavailable P&L is not zero, and source failures are displayed.
It makes no model calls, sends no chat to an
external AI and reads no private holdings or broker credentials. Normal
market-data refreshes may still occur through the existing snapshot readers.
Facts, source/fetch/session timestamps, risks, missing information and app
reference levels are displayed separately. Comparisons use one shared scan,
not invented rankings or forecasts. News, fundamentals, personal portfolio
analysis, price predictions and order actions are explicitly unsupported in
this local version. The assistant does not inspect earnings calendars, so
its setup context is not a substitute for the complete trading checklist.
Stale, failed or shortened data suppresses setup-specific levels.
Warm-up/provider failures remain visible, not success-shaped empty answers.
Tests: `node --test scripts/research-assistant.test.mjs scripts/application-assistant.test.mjs scripts/performance-summary.test.mjs`.

### Performance & reliability

Open `/performance` from the workspace sidebar or the mobile **Results** tab.
It consolidates the live stock-strategy check, stock paper portfolio, index
futures paper portfolio, Nifty/Bank Nifty paper straddles and manually recorded
real positions. The portfolios are separate accounts: their profits must not
be added together or treated as a strategy ranking.

Each card identifies its evidence source, capital/deployment where recorded,
closed and open P&L, closed-trade win rate and expectancy, drawdown basis and
source timestamp. Real-position P&L is gross and owner-entered, not reconciled
with the broker. Paper costs/fills remain estimates. Straddles have no funded
capital recorded, so no return percentage is inferred. The strategy check
excludes still-open marks from win rate and compares with Nifty over the same
period; capped trade ledgers withhold incomplete closed-trade statistics.
Older unresolved straddle days withhold total/open P&L and display a warning,
rather than presenting expired or incomplete marks as a current result.

The system-status section shows paper-engine heartbeats, straddle recording,
daily-history freshness, universe coverage/data checks, Fyers/fallback source,
pre-open/hourly email-provider status and broker dry-run/live/kill-switch mode.
Market-closed engines are idle, not automatically stale. Heartbeats do not
verify exchange tick freshness, and provider acceptance does not verify inbox
delivery. Failures are displayed separately, retaining other available sources.

`GET /api/performance` uses existing snapshot readers; it does not send emails,
approve trades, change settings or backfill option history. Normal universe
refresh and the existing strategy-check computation can be started by those
readers. The page separates **Automation status**, **Strategy results**, and
**System health**. Automation shows enabled modes, last attempts, last successful
evaluations (when recorded), and blockers independently of engine heartbeats.
The page reads status every five seconds while visible and resumes immediately
when returning to it. Its index price monitor reuses the existing SSE quote
channel (REST fallback), without subscribing to market movers. Stream connection,
provider trade time, delayed/fallback, stale and unverified quotes are distinct;
this is not a guaranteed exchange-tick feed. Daily strategy results still use
completed daily candles, not intraday marks. No real-money execution is enabled.
Tests: `node --test scripts/performance-summary.test.mjs`.

The paper strategy holdings on `/positions#strategy-check` also register their
symbols with the shared visible-tab quote poller. Desktop rows and mobile cards
show latest available quote, indicative gain/P&L, source quality, provider trade
time and fetch time separately from the completed daily close. An indicative
holdings-value summary requires quotes for every holding; missing or simulated
quotes never fall back to daily prices. Refresh failures are visible and retained
quotes are labelled stale as they age. Each holding includes quantity and recorded
amount invested; a bottom summary totals shares, invested cost, latest holdings
value and indicative open profit/loss before costs on desktop and mobile.
The section is labelled **Practice portfolio**. Its four-number current-holdings
summary is separate from collapsed last-close account results (including cash).
The default holdings table has five columns; buy prices, stops, daily exit levels
and provider trade times live under **Show details**. Sources/delays stay visible.
Amounts use full rupee figures, missing-price totals explain the count, and
stop-price observations never imply a sale. Daily decisions retain their source
date, and deleting practice history requires explicit confirmation.
Daily account results, risk checks,
pending signals, stops and trade history remain the original daily replay.
Fyers quotes may be cached for 15 seconds and delayed fallback is not tick data.
Tests: `node --test scripts/tracker-valuation.test.mjs`.

### Fyers data reliability

Data requests share a process-wide queue and short read cache. Identical
concurrent reads use one network call and retain the original fetch timestamp.
Local daily request counts (including failures), endpoint counts and pauses
persist in `.cache/fyers-data-usage.json`, without credentials. A conservative
4,500-data-request budget resets at IST midnight; it is not the broker's
remaining quota and excludes other applications and requests made before
tracking was introduced. The Performance page shows these limitations/counts.
Daily-limit rejections stop data requests until the next IST day; HTTP 429
and Standard-plan per-second/per-minute rejections back off for 60 seconds, and
transport/server errors for 30 seconds. Data calls are spaced at least 1,500 ms
apart within each server process (also capped at 40/minute); separate app
processes and other applications do not share that pacer. There
is no immediate automatic retry, and restarting does not clear a saved pause.
This data policy does not retry, cache or alter broker-order sends.

Failed index auto-paper evaluations are recorded as errors, not successful
hourly checks. They can retry the same slot after a 60-second cooldown without
repeating a successful skip or placement. The straddle recorder resumes on server
startup on trading days and refreshes current/recoverable sessions instead of
replaying forty days on every tick. Future scheduled expiries are adjusted with
the shared holiday calendar (including the November 2026 Bank Nifty holiday
shift), and missing current-session records are explicit recording errors.
Existing expired/incomplete sessions remain explicitly incomplete; new contracts
never substitute for their original legs.

Watched Fyers quotes and futures paper polling use 15 seconds; broad universe
Fyers quotes can be reused for 15 minutes to avoid spending the daily quota on
full-universe sweeps. Yahoo fallback is retained and labelled per quote.
The stock drawer displays source, provider/session time and fetch time.
Fetch time and Fyers' date-only `tt` are never presented as verified trade times:
new stock/index paper entries require a recent explicit provider trade time.
This intentionally pauses entries when the feed cannot prove freshness.
Practice owner-email alerts run server-side every 30 seconds, without an open
browser, when `PERSONAL_ALERT_EMAIL` and the email API are configured. They notify newly
observed replay buys/exits and confirmed next-open signals after daily processing;
they are not execution-time confirmations or real-order instructions. Initial
startup/new tracker configuration baselines existing history without emailing it.
`.cache/tracker-alerts.json` persists queued events and per-email successful-send
checkpoints; failed sends retry on subsequent checks. A crash between provider
acceptance and saving a checkpoint can still cause a duplicate. Stop-review emails
run only in real trading sessions and require a verified trade timestamp no more
than two minutes old; date-only Fyers prices do not qualify. Each holding gets at
most one successful stop warning per trading day. Stale/unverified-price blockers
and send failures appear in the practice portfolio alert-status panel. Polling can
miss brief crossings; daily replay/risk rules and the existing daily summary remain
unchanged. This does not enable orders, browser push or customer-list email.
Existing sampled stop/target handling is retained; it is not bid/ask execution.
No trading signal/risk parameters or live-order enablement settings change.

The straddle desk labels older open days incomplete (expired when appropriate),
withholds their displayed day P&L and never calls them “open now”.
Recovery preserves recorded contract symbols/expiry and entry prices;
expired contracts are not replaced by a later expiry or modelled results.
Records remain saved for audit. Expired incomplete days cannot be repaired
through the current live-contract history path.
Tests: `node --test scripts/fyers-data.test.mjs scripts/fyers-quotes.test.mjs scripts/paper-trading.test.mjs scripts/index-paper.test.mjs scripts/scalp-paper.test.mjs`.

The home dashboard retains its modern navy-and-gold design and original cards:
position/strategy status, indices, breadth gauge and trend, statistics, Top picks,
movers, sectors and paper trades. The market banner is omitted on home to avoid
repeating the gauge and the Top picks setup check; the tested 35% gate still
appears with Top picks. Redundant navigation shortcuts are removed.
The market-card grid responds to available content width, not viewport width:
three equal-height cards on wide screens; gauge/trend plus full-width statistics
on medium screens; stacked cards on phones. Stock cards size to available space,
and the sector/paper section uses two columns rather than leaving an empty third.
Morning brief & global cues remains collapsed. The phone uses bottom navigation only.
Stock details include a **Support & resistance · daily** text section below the
chart: up to three support/resistance levels with price zones, swing-touch counts,
distance from the daily candle close and source/date. It reuses daily Auto S/R on
the same chart history; other chart timeframes can differ. Missing levels are
explicit, and these descriptive zones are not additional trade plans.
The stock drawer shows one primary **Trade plan** (12% stop, 50-day-average
exit). Its chart entry/stop/optional-profit/exit lines come from that same plan;
they are absent while the plan is unavailable. Horizon research checks remain,
but no longer show alternative entry/stop/target grids in the drawer or alter
its chart. Research tables and watchlists keep their existing reference levels.
Historical strategy testing sits in a separate collapsed disclosure. No strategy
eligibility, alert, or trading-engine rules are changed by this presentation.
**Stock research** and the scanner catalog are available inside **Research**
(also linked from home). Their detailed panels are not mounted
on the dashboard, and home no longer polls scanner/RSI feeds for hidden panels.
Research counts are not the curated Today's Picks list.

Desktop navigation, the command palette and mobile tabs share five destinations:
**Today, Portfolio, Research, Results, Assistant**.
Research (`/#scanner-directory`) starts with **Watchlist**, **Stock research** and
**Market overview**, with the scanner catalog and practice/older tools collapsed
until requested. Stock-drawer watchlist actions remain available.
Results (`/performance`) starts with strategy results, with secondary links to
**Historical backtest** (`/backtest`) and **Email track record** (`/radar`);
automation status, system health and market-feed diagnostics remain available.
Portfolio (`/positions`) focuses on real holdings; the real-trade journal,
order review, paper strategy and email delivery activity are collapsed.
Existing `#strategy-check`, `#order-approvals` and `#email-activity` links open
their section automatically, and add-position prefills still work.
Real, paper and replay balances/results remain separate.
Navigation regression checks: `node --test scripts/workspace-navigation.test.mjs scripts/app-route.test.mjs`.
With the built app running, `node scripts/check-navigation.mjs` verifies desktop
and phone navigation, collapsed sections, deep links, prefills and page overflow
without changing holdings or sending emails.
**Market overview** contains the five existing market tabs; **Trade Triggers**
has a grouped selector with match counts. Shared URLs
and browser Back/Forward retain the existing destinations. Narrow windows use
an icon rail (hover for names), a separate search row and internally scrolling
tabs/tables. Theme, universe filtering and trading rules are unchanged.
The shared frame retains its floating navy sidebar, tinted background,
styled cards and restrained gold accents. Detailed tools retain their existing data and controls.
Reduced-motion preferences disable decorative movement; no decorative charts imply market data.
Click any of the five dashboard metrics to open a separate stock-list workspace
with a shareable `#metric-*` URL and **Back to dashboard** action.
DMA/advancing lists are market-wide; Buy ready/Short ready lists use the current
research universe (and selected buy horizon), not the curated Today's Picks.
The list shows coverage, scrolls internally and opens stock details from symbols.
Use its selector to switch metrics. The selected buy horizon is retained during
workspace navigation; shared metric links start with the default Short horizon.

Stock research has an off-by-default **Ignore market breadth** comparison
checkbox for long ideas only. It simulates passing the breadth check while keeping
stock checks, liquidity, risk flags and plan requirements unchanged, and shows
normal versus hypothetical counts for the selected universe/horizon. Comparison
statuses and plans are explicitly non-actionable. The setting is not persisted
and resets on reload; all other views, drawers, short ideas, customer emails and
paper approvals retain their normal rules.

The preset screen tables show results only from the actual scan. An empty scan displays no matches, and a failed scan displays an availability warning rather than substituting demo stocks or manufactured counts. The **Current setup summary** reports counts of the current scanned stages; it is **not a backtest**, a trade ledger, or a profitability estimate.

The market breadth panel's 50-day and 200-day percentages compare scanned, eligible equities' prices with their actual moving averages. Coverage is stated for each average because some symbols lack enough history. These numbers cover the NSE EQ-series universe that passes the liquidity floor, not every listed security (SME, BE/BZ series and illiquid names are excluded). If the scan is unavailable there is no breadth estimate.

Check the market data source and timestamps before considering a result. This dashboard does not provide exchange-verified real-time market data, historical point-in-time constituents, or an execution-quality trading system.

Provider failures are reported, never replaced with another source or demo data. If individual tickers fail (for example symbols renamed or delisted after a demerger), the scan continues without them and lists them as skipped. TLS verification stays on. `npm run dev` and `npm run start` pass `--use-system-ca`, so certificates trusted by the operating system (such as a corporate proxy's root CA) are accepted.

### Snapshot data checks

Every universe snapshot validates each daily history (fresh or cached) before any
screen, scanner, Pick, email or monthly analysis uses it:

- Non-numeric values, negative volume, future-dated, duplicate or unordered
  sessions exclude the stock from every calculation.
- An impossible OHLC bar (for example a low above the open) keeps only the
  sessions after the latest such bar, so no indicator spans it. Long-window
  indicators can then be unavailable for that stock.
- If a history refresh fails, expired cached history is reused only when the
  current quote can be appended without hiding a missing session (checked
  against the latest session present in most freshly downloaded histories).
  Otherwise the stock is excluded.
- A same-day quote can extend the session's high, low and cumulative volume but
  never shrinks them; quotes dated more than five minutes in the future are ignored.
- Quotes without a provider timestamp are skipped instead of being stamped with
  the fetch time (Kite exchange times are parsed as IST).

The dashboard, Stock research and Monthly Setups show a collapsed **Data checks**
summary listing excluded and shortened stocks, plus a separate alert when the
latest refresh failed and the last complete snapshot is being shown. The
screen, scanner and monthly APIs return the same `dataQuality` and
`refreshFailure` fields. Tests: `node --test scripts/history-quality.test.mjs scripts/candle-merge.test.mjs`.

### Short, mid and long-term reference levels

Stock research, the stock drawer and the watchlist show entry, stop-loss, T1 and T2
for each horizon as **reference levels, not a recommendation**. Each target carries how
often it was actually reached in the backtest. **Today's Picks** remains the tested buy list.

Backtest (`node --no-warnings scripts/backtest-horizons.mjs --write`, which also
regenerates `src/lib/screen/horizonBacktest.json`): 1,945 stocks, Buy ready entries
Nov 2022 – Oct 2026, 0.25% costs, half booked at T1 then stop to entry.

| Horizon | Trades | Avg result | T1 hit (median days) | T2 hit (median days) | Stop-loss first | Time exit |
| --- | --- | --- | --- | --- | --- | --- |
| Short (≤30 sessions) | 168 | −0.09R | 34% (6) | 11% (17) | 49% | 24% |
| Mid (≤63 sessions) | 242 | +0.02R | 33% (20) | 18% (29) | 56% | 18% |
| Long (≤250 sessions) | 32 | +0.32R | 34% (54) | 28% (122) | 53% | 13% |

No horizon was positive in both halves of the period with enough trades. The
checks beat a random liquid-stock baseline (−0.23R to −0.33R), and the breadth gate
added nothing. Samples under 100 trades are flagged as small. Caveat: the universe is
today's listings only, so there is survivorship bias.

Short-term targets come from the base height ("measured move", `withPatternTargets` in
`horizonSignal.ts`): T1 = pivot + base height, T2 = pivot + 2× height, with the 2R/3R
targets as the fallback when there is no usable base or the price is still below the
breakout (pivot above the buy zone, where the old high would give far-off targets). This
raised the T1 hit rate from 17% to 34% and the average from −0.16R to −0.09R. Mid and
long keep their R-multiple targets: pattern targets were hit more often there too, but
being closer they lowered the average (mid +0.03R → +0.01R, long +0.27R → +0.06R). The
backtest prints this comparison as PATTERN-HEIGHT TARGETS.

Stops sit below real swing lows (`SWING_STOP_RULES` in `horizonSignal.ts`). When the
risk or stop check fails, no levels are shown: the app shows "Risk too wide – no trade"
or "Below stop-loss – no trade" instead. Holding labels come from `HORIZON_HOLDING`.
The stock drawer does not log trades to the journal. Tests: `node --test scripts/horizon-signal.test.mjs`.
## Stock universe

The scan universe is every **EQ-series equity in NSE's official equity master** (`EQUITY_L.csv`, about 2,300 symbols). Sectors come from the Nifty Total Market constituent list where NSE publishes one (about 750 stocks); the rest show as "Unclassified" rather than a guessed industry. Refresh the list with:

```bash
npm run update-universe
```

This rewrites `src/lib/market/data/nse-equities.json`. The script refuses to write the file if the download parses to fewer than 1,000 rows. New listings, renames (for example ZOMATO → ETERNAL) and delistings then flow through automatically. Hand-maintained entries in `universe.ts` only add sector and market-cap detail for symbols still on the list. The list reflects the current listings, so screens and breakout history do not account for stocks that were delisted or renamed in the past (survivorship bias).

How data loads: the server keeps one shared snapshot of the universe and refreshes it in the background about every minute while the market is open, or every 15 minutes when it is closed. Each refresh reuses up to five years of daily history, re-downloaded every 12 hours and cached on disk in `.cache/daily-candles/`, and fetches one fresh quote per symbol that updates the current session's candle. Every scan, breakout feed and movers ranking is computed from one complete snapshot, so relative-strength ranks are never built from a half-loaded universe. On a cold start the first load takes about 1–2 minutes on Yahoo, and the UI shows progress in the meantime. On Kite, requests are throttled to its rate limits, so the first load without a cache takes about 15 minutes.

## Getting Started

### Monthly Setups (research only)

Open **Scanner tools → Monthly Setups** (`#monthly-setups`). This separate
workspace does not add home dashboard panels or change customer emails,
Buy-ready gates, paper approvals or scanner recommendation sources.

- **12-month breakout:** latest completed monthly close strictly exceeds the
  highest high of the prior 12 completed months. Consecutive qualifying months
  may appear; it is not necessarily the first breakout of a run.
- **Compression:** most recent mother candle followed by at least two completed
  candles wholly within its high/low range (equality allowed), through the
  latest completed month. No trend gate is assumed.
- Monthly Wilder DMI/ADX(14), RS, turnover and breakout monthly-volume ratio
  are descriptive context. They do not create confidence/win-probability scores.
- Range-height projections are illustrative, not validated trade targets.
  Current-month price observations are separate and provisional.
- Primary row labels describe **Monthly breakout confirmed** or **Monthly
  compression active**, as of the completed signal month. **Daily entry
  readiness** is separately labelled as short-term buy checks (not short-selling),
  with expandable failed checks. Avoid here does not invalidate monthly structure.

The engine reuses the shared daily universe snapshot and liquidity floor. It
discards a partial initial month, requires at least 13 consecutive complete
monthly buckets and validates first/last regular sessions, retaining genuine
special-session candles. Monthly checks include annual NSE holiday circulars
[2024](https://nsearchives.nseindia.com/content/circulars/CMTR59722.pdf),
[2025](https://nsearchives.nseindia.com/content/circulars/FAOP65588.pdf) and
[2026](https://nsearchives.nseindia.com/content/circulars/CMTR71775.pdf), plus
`MARKET_HOLIDAYS`. These dates now also supply the shared market-day calendar. It does not
audit all internal daily gaps; maintain configured closures beyond these years.
Incomplete/stale histories
and provider failures are visible. Available history may be too short for ADX,
which remains explicitly unavailable. Short-horizon readiness uses the existing
aligned scan, not monthly membership. No proven trading edge is claimed.

Validate with `node --test scripts/monthly-setups.test.mjs`.

### Index outlook

Index pages default to **Last close** analysis and offer a separate **Live daily
(provisional)** reading. The quote/chart update independently and do not silently
replace the completed reading. The shared `/api/market/index-analysis` engine
also supplies the pre-open email's Nifty/Bank Nifty outlook.

RSI(14) and ATR(14) use Wilder smoothing. Daily trend combines price, 20/50-day
averages and the 50-day slope; weekly trend uses completed weeks, 10/30-week
averages and the 30-week slope. Holiday-shortened weeks finish at their last
configured trading session's close. Keep `MARKET_HOLIDAYS` current.

Nearby references come from completed-day/week highs and lows, moving averages
and swing pivots confirmed by two subsequent completed bars. Bullish/bearish/range
scenarios are conditional research context, not forecasts or new trading rules.
The original 20-session range remains separately labelled.

Nifty 50, Bank Nifty, Nifty IT and Nifty Midcap 100 breadth use official constituent
CSVs stored in `src/lib/market/data/index-analysis-membership.json`. Refresh all
four atomically with `npm run update-index-membership`; failed, duplicate or
unexpectedly small imports do not overwrite the snapshot. Source links and the
download timestamp are shown in the app.

Only session-aligned constituent candles count; coverage is reported separately
for 20/50/200-day averages. The five-session direction compares the same members
at both dates and requires at least 80% of the official membership to qualify.
Its signed change is in percentage points, not percent return. It uses today's
membership at both dates, not historical point-in-time constituents.

Structural levels are clustered into zones and ranked Major/Intermediate/Minor:
confirmed swing references score 4, completed-week and 200 DMA references 3,
50 DMA 2, and other daily/MA references 1. Repeated labels count only once.
Zones cluster within 0.15 ATR (0.1% of price without ATR), without chained merges.
This is heuristic structural importance, not a probability of a level holding;
nearest trigger references remain separate from ranked structural zones.

History coverage includes bar count, latest/expected session, stale flags and
missing indicators. Invalid OHLC, future or duplicate sessions are rejected.
Yahoo currently returns only one daily bar for the exact Midcap 100 index, so
technical history and five-session direction remain unavailable; constituent
breadth can still be shown for that session. No ETF or different index is used
as a substitute. Leadership compares their
20-session returns with Nifty (percentage-point differences, not contributions
or a comprehensive sector ranking). India VIX supplies volatility context.
Provider latency is unverified; missing feeds are reported and partial coverage
is not treated as full coverage. No options OI, institutional-flow or
probability claims are derived from these inputs.

The **Saved pre-open outlooks** journal starts prospectively: the first fresh,
completed, nonmock outlook captured on a trading day between 08:45 and 09:15 IST
is immutable. The server's minute timer captures without an open browser, then
evaluates saved levels against that exact date's completed daily OHLC after
15:30. Missed mornings are never backfilled; absent evaluation data stays pending.
It reports level touches, crossings and the closing side, not executable fills,
trade returns or a win rate. If both sides are crossed, intraday order is unknown.

Records survive restarts in `.cache/index-outlook-journal.json` (latest 1,000
captured trading dates). Keep this file when clearing caches. Updates serialize
and rename atomically within this single server process; multiple instances
would need a shared store/lock. Storage failures are logged and shown in the app.
The calendar still depends on current `MARKET_HOLIDAYS`.

#### Index analysis in customer emails

The 09:00 IST pre-open email includes completed-session analysis for Nifty,
Bank Nifty, Nifty IT and Midcap 100, with daily/completed-week trends, conditional
scenarios, ranked levels, coverage, breadth direction, relative leadership and
India VIX. Missing Midcap history is explicitly reported.

The hourly email includes latest-available index analysis at each real NSE
market-hour slot (09:15, 10:15, ... 15:15 IST), **even when stock lists are
unchanged**. `EMAIL_AUTO_SEND=1` still controls automatic sending. Stock sections
repeat the full Buy ready (top 10) and watch (top 5) lists every hour with a
Status column (New / Added / Unchanged / Was buy / Removed) versus the last email,
so a reader who missed one still sees everything. A separate "Bullish confluence"
section lists the top 10 liquid stocks where 2+ scanner families agree (3+ first),
labelled **not a buy** because agreement alone had no backtest edge. Stock rules,
scanners and paper execution are unchanged.
An **Intraday developments** section checks only the current Buy ready/watch
stocks for confirmed crosses on completed Yahoo 60-minute candles: prior-day
high/low closes and an hourly-bar VWAP estimate. It reports each event once per
bar per trading day, shows data coverage, and labels Yahoo latency as unverified.
This is hourly context, not a five-minute signal; it never changes daily status,
Today's Picks or trade plans. Stale/missing candles and daily reference levels
are reported as unavailable instead of being treated as no signal.
The same results and coverage are visible in **Research & older tools > Trade
Triggers > Hourly email**. Use **Refresh** to reload the check or **Preview
email** to open the full rendered email without sending it. Production code
changes require `.\scripts\run-app.ps1 rebuild`; restarting alone uses the
existing build.
Automatic hourly sends are suppressed on weekends and dates in the built-in NSE
holiday calendar; keep that calendar updated from each annual exchange circular.
Weekends, configured holidays and simulated sessions cannot trigger auto sends.
Normal hourly and pre-open manual sends also reject closed days and simulated
sessions, with HTTP 409 and an explanation; the guard runs before loading data
and again just before sending. Manual sends still bypass the clock window
on genuine trading days. Explicit `[TEST]` copies and previews remain available
outside trading days without updating sent-email state.

Both email status APIs expose `sendBlockedReason` and `calendarWarning`; the
hourly email panel displays these and disables normal sending on blocked days.
The published calendar currently covers 2024-2026. A warning appears outside
that range; it does not automatically fetch annual updates. This is a regular
session calendar, not a scheduler for special/Muhurat session hours.

Ready-to-run and Weekly Top-5 owner alerts checkpoint each email only after
provider acceptance. Failed sends leave that alert eligible for the next scheduled
check, while successfully accepted alerts in the same batch are not repeated.
Retries remain subject to the normal trading-day/check window and current
signal eligibility. Provider acceptance does not prove inbox delivery.
Validate with `node --test scripts/alert-delivery.test.mjs scripts/market-email-policy.test.mjs scripts/ready-alert.test.mjs scripts/top5-alert.test.mjs scripts/hourly-email.test.mjs scripts/hourly-intraday.test.mjs scripts/preopen-email.test.mjs`.

#### Email Activity

The portfolio's Email Activity section (`/positions#email-activity`) refreshes
every 30 seconds while the page is visible. Its read-only API is
`GET /api/alerts/activity`; opening it does not send emails or generate previews.
Current hourly/pre-open scheduler cards explain paused, waiting, eligible,
already-accepted and retry-pending states. Retry eligibility is conditional on
the app running and the send window remaining open, not a delivery guarantee.

All email attempts reaching the shared email provider now record accepted or
failed results. Automatic hourly/pre-open scheduler skips
for holidays, simulation, disabled sending or missing settings are recorded once
per IST day per source/reason, when that scheduler checks. Provider acceptance does
not confirm inbox receipt. Test copies are explicitly tagged.

History begins with this feature; existing server logs are not backfilled.
The latest 200 events persist in `.cache/email-activity.json` (50 matching rows
shown). It stores subjects, timestamps, categories and outcome summaries, not
recipient addresses, message bodies or credentials. Provider errors stay in
server logs. Keep the local file private; subjects may describe trades.
Writes use atomic replacement for this single app process. Logging failures are
reported to server logs without changing send outcomes or causing duplicate
retries; read/corruption failures are shown explicitly rather than reset.
Special/Muhurat session support remains outside this regular-session calendar.

Validate with `node --test scripts/email-activity.test.mjs scripts/smtp-config.test.mjs scripts/email-provider.test.mjs`.

Hourly prices carry provider quote timestamps, change from the previous session
close, opening gap and session high/low where supplied. Quotes older than five minutes
during trading, future quotes and missing prices are not used for comparisons.
Price moves compare with the previous successfully emailed snapshot, not an
assumed exactly-one-hour return. Breadth changes compare only fresh, same-date
snapshots with full coverage and unchanged membership; delayed/partial data
never imply intraday confirmation. Successful sends persist baselines under
`.cache/email-alert.json`; previews and failed sends do not advance them.

The hourly section compares current price with the frozen pre-open journal's
support/resistance and flags price-above-resistance/weak-breadth conflicts.
If the server missed pre-open, it labels previous-close reference levels as a
fallback, never inventing a saved morning outlook. Yahoo latency remains
unverified: these emails are **not exchange-verified real-time analysis** and
use a forming daily candle, not hourly candles, VWAP or opening-range signals.
Index feed errors are shown without substituting forecasts.

### Index Scalp Desk (`/scalp`, Fyers data)

A dark 3-pane 1-minute screen for Nifty 50 / Bank Nifty: ATM (or ±2 strikes)
Call | spot | Put, drawn with TradingView Lightweight Charts. It shows EMA 9/21,
the 15-minute opening range and previous-day high/low on spot, each option's
own VWAP, futures-vs-VWAP, PCR, max call/put OI strikes, India VIX, a
near-ATM chain strip and the CE+PE straddle line. It refreshes every 10 s
while the tab is visible during market hours.

Data comes from the free Fyers API v3 (read-only for data; the only order the
app can send is a buy you approve yourself on My positions, see "Tomorrow's
orders" in the workspace notes, and it is a dry run unless you switch live
orders on). Setup: create an app at `myapi.fyers.in` with redirect URL
`http://127.0.0.1:3107/api/fyers/callback`, add `FYERS_APP_ID`,
`FYERS_SECRET_ID` and `FYERS_REDIRECT_URI` to `.env.local`, restart, then click
**Connect Fyers** on `/scalp` once each trading day (Fyers tokens are daily;
it is stored in `.cache/fyers-token.json`). Requests are paced well below the
Fyers limits (10/s, 200/min).

While you are logged in to Fyers, the stock detail chart also draws from Fyers
NSE daily candles (caption under the chart shows the source); otherwise it
uses Yahoo. With Fyers connected the chart also offers **1m / 5m / 15m / 1h**
intraday timeframes (about 2 / 30 / 60 / 100 days of history; refreshes every
30 s during market hours; times in IST; pivots use the previous completed
daily bar). Ratings, levels and the scanners always use the scan's Yahoo data
so they stay consistent and run without a daily login.

The ORB setup markers (1-min close beyond the first-15-minute range, EMA 9/21
agree, futures and the option above/below their VWAP; plan: 20-pt Nifty /
50-pt Bank Nifty stop, 1.5R target, 10-minute time stop, max 3 a day, none
after 15:00) are display-only setups, **not** trade signals.

**Index strategy backtest** (`/scalp/backtest`, needs the Fyers login): replays
four fixed setups on the last year of 1-minute index spot plus Fyers
continuous futures (cached in `.cache/scalp-history/`): the desk's ORB, a VWAP
pullback, a previous-day high/low break and a 5-minute EMA 9/21 trend
(rules in `src/lib/scalp/setups.ts`). Each signal enters at the next minute's
open, one trade at a time; the stop is checked before the target inside a bar,
and each trade is priced as one ATM option lot (0.5 delta) after Fyers
brokerage, taxes and slippage. A setup passes only with 100+ trades, a
positive average trade after costs and a profit in both halves of the year.
Result on 6 Oct 2025 – 5 Oct 2026: **no setup passed**. ORB lost about
−₹82.7k (Nifty) and −₹48.8k (Bank Nifty) per lot after costs. The closest was
the Bank Nifty 5-minute trend (+₹3.7k, but the first half lost money).
Expired options have no Fyers history, so option-VWAP filters are not tested.

The same page also tests **longer holds**, priced as one index-futures lot
(STT 0.05% on the sell side, so about 15–16 Nifty or 38–40 Bank Nifty points
per round trip): two intraday rules held to 15:15 (a first-hour breakout and
the first 5-minute trend signal) and two 1–3 day swings run on 10 years of daily
data (a 20-day breakout, and an RSI(2) dip inside the 200-day trend), with
futures carry. Swings need 50+ trades to pass. **None passed:** every Nifty
setup lost money, and the best result, the Bank Nifty 20-day breakout
(+₹81k over 10 years, profit factor 1.05), lost in the second half.

Two more families are on the same page. **Option selling:** a modelled 09:20
ATM short straddle with a 25% stop per leg and buy-back at 15:15, over 2 years.
Premiums come from Black-Scholes with India VIX (Bank Nifty: VIX × its
realised-volatility ratio), time measured in trading days, and real NSE expiry
days, because Fyers has no expired-option prices. **Positional trend:** 50/200-day
average crossovers on futures over 10 years, with monthly rolls and carry,
compared against buy-and-hold. Results: the straddle is +₹52k (Nifty) and
+₹1.6L (Bank Nifty) in the model, but selling 5–10% cheaper than modelled turns
it into big losses, so it is marked **Model-sensitive** and needs paper trading
with live option prices. Trend following lost (−₹4.3L / −₹5.0L long-short)
while buy-and-hold made +₹3.7L / +₹3.8L.

**Filtered straddle and iron condor** (added 5 Oct 2026, rules fixed before the run): the straddle traded only when IV ÷ 20-day realised volatility ≥ 1.2 lost on Nifty (−₹10.6k) and was inconsistent on Bank Nifty (second half negative), so the filter removed good days rather than bad ones. The intraday iron condor (shorts 0.5% out, wings 0.5% further, stop at 1× credit) made money before costs but lost after them (Nifty −₹1.09L, Bank Nifty −₹2.30L): four legs cost about ₹490 a day. Variants that looked better (expiry-day-only condor: Nifty +₹19.7k with 82% winning spreads; held to expiry: Nifty +₹24.5k) were picked after the run and are hypotheses, not results. Selling setups also show winning days, worst day and best day (legs of one day combined).

Every setup also shows **Capital used** (money blocked for one lot at today's level: ATM option premium for scalps, roughly 12% of contract value for futures, 15% for a naked straddle, 3% for a hedged condor; plus the setup's worst drawdown), **profit after costs**, **account at the end**, and the **return** on that capital (simple per-year average, not compounded).

**Paper straddle** (`/scalp/paper`, no real orders): tracks the 09:20 straddle
every day with **real Fyers option prices**. The ATM strike is taken from the
09:20 index open and the nearest-expiry contracts from the option chain. Each
leg is replayed on that contract's actual 1-minute candles (25% stop, buy-back
at 15:15), and the model's 09:20 price is stored alongside to measure model
error ("Real ÷ model premium"). While Fyers is connected, the app follows each
weekday's trade live from 09:21 (every 5 minutes; every minute while the page is
open) and records the close after 15:15. Days still inside
the current expiry cycle are backfilled automatically. Expired contracts lose
their prices, so on expiry days connect Fyers before 15:15. Records are kept in
`.cache/paper-straddle.json`, and a verdict needs 40 closed days. Logic is in
`src/lib/scalp/paperStraddle.ts` (tests in `scripts/scalp-paper.test.mjs`) and
`src/lib/scalp/paperStraddleRun.ts`.
Logic lives in `src/lib/scalp/scalpLogic.ts`, `src/lib/scalp/setups.ts`,
`src/lib/scalp/holds.ts`, `src/lib/scalp/premium.ts` and
`src/lib/scalp/backtest.ts` (tests in `scripts/scalp-logic.test.mjs`,
`scripts/scalp-setups.test.mjs`, `scripts/scalp-holds.test.mjs`, `scripts/scalp-premium.test.mjs` and `scripts/scalp-backtest.test.mjs`).

### Automatic local startup on Windows

After `npm run build`, run `.\scripts\install-local-startup.ps1` once.
This installs the visible **Traders Adda Local Startup** Windows task for the
current user: weekdays at **08:45 IST** and at login. Windows must use India
Standard Time. The task runs without administrator privileges, listens only on
`127.0.0.1:3107`, ignores duplicate task launches and retries failures after a
minute. It does not change sleep settings, wake the PC, or enable external access.
The user must be logged in and the laptop awake with internet access; a missed
start runs when available. An already-running app is left alone.

Start it manually with `Start-ScheduledTask -TaskName 'Traders Adda Local Startup'`.
Logs are saved in `.cache/startup/`. After code changes, rebuild and restart the
app; startup uses the existing production build, not a development build.
Remove future scheduled launches with
`Unregister-ScheduledTask -TaskName 'Traders Adda Local Startup' -Confirm:$false`.
Removing the task does not stop an already-running server.

### Running it manually

Double-click **`Run Traders Adda.cmd`** in the project folder to start the app
(it builds first if no build exists) and open http://localhost:3107. From a
terminal in the project folder:

```powershell
.\scripts\run-app.ps1            # start (or show status if already running)
.\scripts\run-app.ps1 status     # running? Fyers connected?
.\scripts\run-app.ps1 stop
.\scripts\run-app.ps1 restart
.\scripts\run-app.ps1 rebuild    # after code changes: stop, npm run build, start
.\scripts\run-app.ps1 dev        # hot-reload development server on port 3000
```

If PowerShell blocks the script, use
`powershell -ExecutionPolicy Bypass -File .\scripts\run-app.ps1 start`. Log in
to Fyers each morning at http://localhost:3107/api/fyers/login.

The server now refreshes market data without an open browser, respecting the
existing one-minute open-market / 15-minute closed-market snapshot intervals.
Browser views already poll for updated results. This does **not** move
browser-local paper trading onto the server or enable disabled notifications.
Only install scheduled tasks on an organization laptop if permitted by IT.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Railway deployment and accounts

This app uses server routes and persistent `.cache` files, so deploy it as a Railway Node service (not a static site). Add a Railway PostgreSQL service and set these variables on the app service:

- `DATABASE_URL`: Railway's PostgreSQL connection URL.
- `BETTER_AUTH_SECRET`: a private random value with at least 32 characters.
- `BETTER_AUTH_URL`: the public origin, for example `https://traderspro.trade`.
- `ADMIN_EMAIL`: your email address, set before your first registration. Register with this exact address to create the administrator account; other signups are regular accounts.
- `RESEND_API_KEY`: a Resend API key stored as a server-only secret.
- `EMAIL_FROM`: a sender address on a domain verified with Resend. `AUTH_EMAIL_FROM` optionally overrides it for password-reset emails and must also use the verified domain.
- `EMAIL_FROM_NAME`: the sender name (defaults to `Traders Adda`); `EMAIL_REPLY_TO` can be set to `tradersaddaofficial@gmail.com`.
- `EMAIL_TO`: comma-separated recipients for scheduled alert emails.

For email, create a Resend account, verify a domain you control, add its DNS records, and create an API key. In Railway, set `RESEND_API_KEY`, set `EMAIL_FROM` to an address on that verified domain, and set `EMAIL_REPLY_TO` to `tradersaddaofficial@gmail.com`. Set `EMAIL_TO` for scheduled alerts; `AUTH_EMAIL_FROM` is optional and otherwise uses `EMAIL_FROM`. Remove the old SMTP variables, then redeploy. Gmail addresses cannot be used as the Resend sender unless the provider authorizes them.

Account signup does not require email verification. Email delivery is still used for password resets and scheduled alerts.

Run `npm run db:migrate` once the PostgreSQL service and variables are available. It creates Better Auth's tables, the per-user watchlist/positions/strategy-test tables, the account-level visitor counter, and the admin audit log. On the first admin dashboard/portfolio load after migration, existing `.cache` positions and strategy-test files are imported into that admin account; the files remain as the admin background-jobs mirror. In Railway, the schema migration can be configured as a pre-deploy command. Keep a persistent volume mounted at `/app/.cache` and use one app replica because other existing application state is also file-backed.

On a Node.js server, the background scheduler seeds the ten-year price history if needed and refreshes it after market close, even before a strategy or positions are started. The initial download may take a few minutes and requires outbound access to Yahoo Finance. Keep `/app/.cache` persistent across deploys; `npm run refresh-data` remains available for a manual repair or refresh.

Regular accounts can use research, private watchlists, their own private recorded-trade journal, and an independent practice strategy test with the existing rules. The journal and practice settings are stored per account in PostgreSQL; the practice test uses shared completed market history and never places real orders. Broker connections, order approvals, owner-email alerts, and administrative controls remain administrator-only. See [.env.example](./.env.example) for the variable names (do not put real credentials in that file).

The admin page includes searchable, paginated account management with join dates, database and price-history health, and a recent audit trail for role/access changes. It also shows all-time and today’s unique signed-in account visits. Counts are deduplicated per account per IST day; the visitor counter stores no IP address or device identifier.
