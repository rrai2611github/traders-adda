# Feature checklist — derived from reviewing Scanner Pro (scanner.mrchartist.com)

Source: manual walkthrough of the live authenticated app on 2026-09-30 (Dashboard, Scanner,
Screener, Watchlist, Terminal, Charts, Market Heatmap, Chart Patterns, Sniper AI, Alerts, Data Hub).

Column "Likely have?" is a guess from component *names* in `src/components/` only — nobody read
those files for this checklist, so verify before assuming coverage.

## 1. Scan library (Scanner page)

~150 one-click scans across 10 categories, each with a plain-English rule (no black box).

| Category | Count | Example rules | Likely have? |
|---|---|---|---|
| Breakout | 18 | 52W/ATH breakout + volume multiple, SMA200 break, gap up/down %, Donchian/Keltner/VWAP breakout, classic pivot R1/S1 | Partial — `BreakoutsRecordSection.tsx` exists |
| Price Levels | 14 | "within X% of day/1M/3M/6M/52W/ATH high or low", 52W range midpoint | Unknown |
| Trending | 25 | Golden/Death cross, EMA/SMA stacks, Hull MA, Aroon, strong up/down trend, tight consolidation | Partial — `MomentumOscillatorSection.tsx`? verify |
| Momentum | 12 | RSI band, MACD cross, ADX+DI, Awesome Oscillator, rate of change | Partial — `MomentumOscillatorSection.tsx` |
| Reversal | 16 | Stochastic/StochRSI/CCI/Williams %R oversold/overbought, RSI midline cross | Partial — `RsiEdgeScannerSection.tsx` |
| Volume & Flow | 16 | Volume vs 10/30/60/90-day avg multiples, up/down-on-volume + RSI combo, Money Flow Index, Chaikin MF | Unknown |
| Volatility | 8 | ATR threshold, Bollinger position, Keltner-inside-BB squeeze, Beta band, daily volatility % | Unknown |
| Top Performers | 10 | Weekly/monthly/3M/YTD/1Y % movers, **+ TradingView Technical/MA Rating (3rd-party feed, not proprietary)** | Unknown |
| Candle Patterns | 10 | Hammer, Engulfing, Marubozu, Doji, Shooting Star, breakout/volume-climax candles | Partial — `LivePatternSection.tsx` |
| Custom Scan Builder | — | Lets user compose their own rule from primitives | Unknown |

Action items:
- [ ] Decide which of the ~150 rules are worth porting; most are simple threshold checks on
      indicators you likely already compute for `ProChart.tsx`.
- [ ] If you add a "Top Performers" style category, be explicit if any input is a third-party
      rating (don't silently blend proprietary + vendor signals — Scanner Pro doesn't disclose
      this clearly, which is the kind of thing your README explicitly avoids doing elsewhere).

## 2. Screener (custom filter builder)

- [ ] Range filters: Price, Market Cap, Change %, Volume, Relative Volume, RSI, Perf 1W, Perf 1M,
      Daily Volatility, Beta (1Y)
- [ ] Candlestick-pattern filter checkboxes (14 types)
- [ ] Technical-signal filter checkboxes (MACD cross, RSI bands, price vs EMA50/200, EMA cross,
      near-52W-high, volume spike, Stoch oversold)
- [ ] "Quick start" preset chips (Volume Breakouts, Oversold RSI, 52W Highs, Gap Ups) that just
      prefill the filter state
- [ ] Save/load named screener configs ("My Screeners")
- [ ] "Add top 50 to watchlist" bulk action
- [ ] Column picker for the results table
- [ ] Two independent universes to choose from (e.g. their "F&O Stocks" selector) — you already
      have a well-defined universe (`nse-equities.json`), so this is just a subset filter, not new
      data infrastructure

## 3. Watchlist

- [ ] Multiple named watchlists (not just one flat list)
- [ ] Per-watchlist summary stats: advancing/declining count, avg RSI, avg volume
- [ ] Grid/list view toggle
- [ ] Empty-state CTA linking to Screener/Scanner

Likely have: `WatchlistPanel.tsx` — check if it already supports multiple named lists.

## 4. Terminal (widget dashboard)

A customizable, draggable widget grid — this is the most "pro platform" feeling page.

- [ ] Widget grid with density options (Comfy/Compact/Dense), lock toggle, add/remove widgets
- [ ] Layout presets ("Pre-Open" preset bundling 9 widgets)
- [ ] Widgets observed: Decision Gauge (0-100 fear/greed style), Advance/Decline ratio, Trend
      Breadth (EMA20/50/200 % above), Hot Lists (gainers/losers/active/vol/52H/52L/gap+/gap-
      tabs), Gap Scanner, Momentum Extremes (top gainers/losers)
- [ ] Data staleness indicator per-widget ("DELAYED", "Cache", "#1" refresh count)

Likely have: `MarketPulseCard.tsx`, `MorningBriefCard.tsx`, `MoversPanel.tsx`, `IndexStrip.tsx`
cover some of this already. The *drag/arrange/save-layout* mechanic is probably the net-new part.

## 5. Charts — full terminal (the most mature module in Scanner Pro)

- [ ] Timeframe switcher (5m/15m/1H/1D + "all timeframes" overflow)
- [ ] 9 chart types with one-line descriptions: Candle, Bar, Heikin-Ashi, Line, Area, Renko,
      Baseline, Point & Figure, Kagi, Three-Line Break
- [ ] Indicator picker: searchable, "Discover" curated set (VWAP, SuperTrend, EMA, RSI) each with
      a plain-English one-liner, vs "All indicators" full library
- [ ] Drawing toolbox: Trend line, Ray, Info line, Extended line, Trend angle, Horizontal/Vertical/
      Cross line, Parallel/Regression/Disjoint channels, favoriting individual tools
- [ ] Compare overlay: search + quick-add chips for common symbols, plots as % change vs main
- [ ] Replay mode: bar-by-bar playback, speed control, scrub slider, position counter (e.g. "361/1200")
- [ ] Multi-chart layouts: 1/2/3/4/5/6/7/8/9/10/12/14/16-pane grids, with independent sync toggles
      (Symbol, Interval, Crosshair, Time, Date range) — each toggle applies across the whole layout
- [ ] Side-rail panels docked next to the chart:
  - [ ] Watchlist (same data as main Watchlist page, inline)
  - [ ] Detect: candlestick-pattern list matched against *loaded* candles, click-to-mark on chart
  - [ ] Candles: same idea, richer per-match detail (O/H/L/C, "why this shape matters" explainer,
        explicit "does not predict the next candle" disclaimer)
  - [ ] Patterns: chart-pattern overlays toggle (separate from the full Chart Patterns page)
  - [ ] Levels: support/resistance generator with a "how sure" dial (Strongest only / Balanced /
        Show more) and a scope toggle (this view only / full history), broken-levels-as-dashed option
  - [ ] Flow: order-flow studies (Volume Profile, Footprint, Market Profile, Delta & CVD) — Scanner
        Pro is explicit that buy/sell side is *estimated* from bar close position, not real tape,
        since Indian equity feeds don't carry trade-side data. Worth being equally explicit if you
        add this.
  - [ ] Compare, Heatmap, Alerts, Objects (drawn-object list/manage), Data (bar inspector showing
        OHLCV + active indicator values under cursor) — all as slide-out panels on one shared rail
- [ ] Connection/data-status banner: "Showing saved data · last updated HH:MM · market closed ·
      reconnecting..." with manual "Retry now" — you already do this well in your own README's
      staleness rules; just note the chart page needs the same treatment, not only the screens.

Likely have: `ProChart.tsx` (738 lines) is probably your equivalent — check which of the above
it already covers vs. the rail panels, which sound net-new.

## 6. Chart Patterns (standalone page, not just the chart overlay)

- [ ] Single-stock deep scan: enter a symbol, get every classical pattern detected across daily/
      weekly/monthly closes over its full history (Scanner Pro showed 143 patterns / 30.7 years for
      RELIANCE)
- [ ] Per-pattern metadata: timeframe found on, strength (Loose/Fair/Strong/Textbook), status
      (Still forming / Breakout confirmed / Broke out then faded), candle count, age in months
- [ ] Filter/sort controls: timeframe, bullish/bearish bias, strength floor, sort by recency/
      strongest shape/best overall
- [ ] "Scan Universe" mode (vs. "Single Stock") — same detector run across the whole universe

## 7. Alerts

- [ ] Alerts Dashboard with summary tiles: Active Rules, Fired Today, Total History, Unique Symbols
- [ ] Three tabs: Alert History, Alert Rules, Delivery (notification channel config, not inspected
      further)
- [ ] Price alerts settable directly from the chart's Alerts rail panel, scoped to the symbol on
      screen, with the alert line drawn on the chart once set
- [ ] Clear empty states everywhere ("No alerts triggered yet")

Likely have: `src/lib/alerts/` + `src/app/api/alerts/` already exist — check what's built vs stubbed.

## 8. Data Hub (integrations/config page) — copy this pattern regardless of scope

- [ ] A single page listing every external dependency with live status (Not configured / Connected /
      Delayed) — for you that's the Yahoo/Kite data feed, universe-refresh job, and email delivery
- [ ] Local state tiles: Local Storage size + key count, Chart Prefs key count, Scanner State key
      count, Feed Mode + last-updated age
- [ ] This is valuable **specifically because** it turns "why is this page stuck loading" into a
      self-diagnosable problem instead of a silent spinner (see gap below).

## 9. Gaps / anti-patterns observed in Scanner Pro — worth avoiding, not copying

- [ ] **Screener and Market Heatmap spin forever with no data source configured** — no inline
      "connect a feed" prompt on the page itself, you have to go find Data Hub to learn why. Your
      README's "Provider failures are reported, never replaced with another source or demo data"
      principle is *better* than this — keep that, but also surface the reason inline on the page
      that's stuck, not only in a separate settings hub.
- [ ] **Copy leak**: one panel showed "an index has none. Needs verification." — reads like an
      internal dev note shipped to production. Worth a copy pass before shipping user-facing
      error strings.
- [ ] **Marketing overclaim**: "150+ proprietary models" while at least a few Top Performers scans
      are actually a wrapped TradingView Technical Rating. Don't claim proprietary when part of the
      pipeline is a re-badged third-party score.
- [ ] **No position/P&L tracking**: watchlists are flat symbol lists with no entry price/date, no
      horizon tag (short/mid/long), no realized or unrealized P&L. If you want a real edge over
      Scanner Pro, this is the most obvious product gap — a lightweight "paper position" tracker
      layered on top of watchlists would differentiate your app, since Scanner Pro doesn't have one
      even though it's clearly the natural next feature people would want after scanning/alerting.

## Suggested build order (if starting from your current codebase)

1. Data Hub-style integration status page (cheap, high trust payoff, matches your existing
   transparency-first philosophy).
2. Fill out Scanner category coverage using indicators you likely already compute for `ProChart`.
3. Chart Patterns standalone page (single-stock full-history pattern scan) — pairs naturally with
   your existing RPCI-approximation and VCP preset logic.
4. Terminal-style draggable widget grid, reusing `MarketPulseCard`/`MoversPanel`/`IndexStrip`.
5. Position/P&L tracker on top of `WatchlistPanel` — the one feature Scanner Pro is missing that
   would actually differentiate your app.

## 10. Conviction upgrades — changes to YOUR app specifically, not ported from Scanner Pro

These come from actually using Today's Picks, Core Setups, Watchlist and the stock-detail modal
live. The goal isn't more features, it's fewer, higher-signal decisions with less digging.

- [x] **Surface per-scanner backtest stats, not just one blended number.** Done —
      `src/lib/screen/scannerBacktest.ts` exposes `scannerBacktestStat(key)` per scanner (reused by
      `dailyAlert.ts`'s blended `backtestLine()` too, so the two never drift apart). `TodaysPicks.tsx`
      now shows a green/gray per-source badge (e.g. "+0.16R · 79t") under each pick's Source column
      instead of only the blended footer sentence. Confirmed live: "4-Day Fall & Reversal" (+0.16R,
      proven) vs "Range Breakout"/"NR7" (negative, unproven) now read differently even on the same
      day's pick list. The Telegram/email alert content was deliberately left on the blended figure —
      revisit if you want that changed too, since it affects what real subscribers receive.
- [x] **Promote the confluence score into the stock-detail modal.** Done — a compact
      `ConfluenceBadge` now sits in the "Buy plan" card header (next to the Short/Mid/Long term
      tabs), plus an amber warning line ("Scanners disagree on this stock: N bullish, M bearish...")
      that fires automatically when `confluence.conflict` is true. The fuller "Scanner matches" card
      further down is unchanged — this just stops the conviction signal from requiring a scroll past
      the trade plan to see.
- [x] **Tie sector context into the same modal.** Done — `StockDetailDrawer.tsx` computes
      `sectorRank` via `groupScanBySector` (same function the Sector strength page itself uses, so
      the two can't disagree) and shows a "SECTOR #11/23" badge in the header, green/gray/red by
      tercile, with a tooltip giving the sector name and its average move.
- [x] **Default-hide AVOID rows everywhere.** Done in `LivePatternSection.tsx` (Core Setups) — a
      "Hide Avoid" checkbox defaults on, filtering both the card and table views via `visibleRows`.
      When every matching row is Avoid, a dedicated empty state ("All matches are Avoid — N stocks
      matched but every one fails a check. Show them anyway") replaces the table entirely instead of
      rendering a wall of unusable rows. Confirmed live on a real weak-breadth day: Forming (36),
      Climbing (18) and Fresh breakouts (5) all collapsed to that empty state correctly.
- [x] **Make the market gate impossible to miss or misread.** Done — extracted the banner from
      `TodaysPicks.tsx` into a shared `MarketGateBanner` (full and `compact` variants, with an
      optional `label` override so Today's Picks keeps its "Step 1 ·" framing) and added it to Core
      Setups, `WatchlistPanel.tsx`, and the stock-detail modal header. All four read from the same
      underlying breadth calculation, so they can't disagree with each other.
- [x] **Add a lightweight position/trade journal.** Done — new `src/lib/screen/tradeJournal.ts`
      (R-multiple math, win-rate/avg-R stats, 4 unit tests), `useTradeJournal` hook (localStorage,
      same hydration pattern as `useWatchlist`), and a full `TradeJournal` page wired into the
      sidebar/router (`#journal`). A "+ Log trade" button lives inside the position-size calculator
      itself (it already has the entry/stop/quantity needed). Verified live end-to-end: logged
      UNIPARTS, closed it at Target 1, got exactly +2.00R, matching the plan's stated 1:2.0 reward
      ratio.
- [x] **A visible position-size calculator.** Done — `PositionSizeCalculator.tsx` +
      `src/lib/screen/positionSize.ts` (4 unit tests). Account size persists across stocks via
      `useAccountSize` (localStorage). Shows Buy/Capital/At-risk from the account size, risk % toggle
      (0.5/1/2%) and the shown Entry/Stop, caps by whichever is smaller — risk budget or available
      capital — and flags it when capital is the binding constraint. Verified live with hand-checked
      arithmetic (193 sh, ₹1,61,348 capital, ₹4,977.47 at risk).
- [x] **Multi-timeframe agreement badge.** Done — `src/lib/screen/multiTimeframe.ts` resamples the
      daily candle series to weekly/monthly (reusing the chart's own `aggregateCandles`) and checks
      close vs. 20-EMA on each, same overlay as the chart's default "MA 20/50/200". Shown as
      `TimeframeAgreementBadge` ("D↑ W↑ M↑") next to the price in the stock-detail header; amber when
      timeframes disagree, with the specific readings in the tooltip.
- [x] **Speed up first paint.** Reconsidered, not implemented as originally framed — the codebase's
      own `universeSnapshot.ts` and README already explain why a partial/cached-first render would
      be actively wrong here: RS ratings, breadth % and sector rankings are universe-relative
      calculations, so a partial snapshot wouldn't just be incomplete, it would show incorrect
      numbers. Implemented instead: an elapsed-rate ETA appended to the existing honest loading
      message ("...12 of 2327 symbols. — about 45s left"), computed server-side in
      `apiErrors.ts`'s `universeWarmingResponse` from a new `SweepProgress.startedAt` field. Answers
      the "is it stuck?" hesitation without ever showing a number that could be wrong. 4 unit tests
      cover the ETA math and the unchanged 503/warming/Retry-After response shape.

All nine verified: `npx eslint` clean on every touched file, `npx tsc --noEmit` clean project-wide,
and the full suite green at 221 tests (was 209 at the start of this list) across `node --test
scripts/*.test.mjs`.
