# BananaPatterns vs Traders Adda: feature comparison

Audited 17 Oct 2026 from the public, signed-out pages of bananapatterns.com (screens, market breadth, rotation, sectors, compare, indices, backtest, how-it-works, resources) and from our app at localhost:3107. Anything behind sign-up was not seen and is marked **not seen**. Status: **Have**, **Partial**, **Missing**, **Skip** (not useful for a single-user desk).

## How this was done, and how to repeat it

- `tmp/audit.mjs <baseUrl> <out.json> "<path>::click1|click2"` opens each route in headless Chrome and lists the visible headings, buttons, selects, inputs and locked items, then clicks named buttons and lists what opens. `tmp/shot.mjs` takes full-page screenshots.
- To cover the signed-in parts: sign up (free), then send screenshots of Watchlist, "Create your own screen", a screen's Filters panel, a backtest result and a stock page. Do not share a password.

## 1. Screens

| # | BananaPatterns feature | Ours | Status |
|---|---|---|---|
| S1 | Screen switcher: VCP, Blue sky, Multi-year breakouts, IPO base, Multiple screens, Your screens, Create your own | VCP, Blue sky, Multi-year, IPO base exist in Core Setups; no custom, saved or combined screens | Partial |
| S2 | Every threshold is a dial you can move, combine and save as your own screen | Fixed house presets (Filters panel has some ranges) | Missing |
| S3 | Filter bar: announcement, circuit or F&O, results date, watchlist, industry or index, rotation quadrant | Industry and subgroup only | Partial |
| S4 | Four stage tiles (Forming, Fresh breakouts, Climbing, Played out) with counts | Same | Have |
| S5 | "What changed since last close": Stage moves and Announcements tabs | Stage moves only | Partial |
| S6 | Chart cards with the base drawn (pivot line, base boxes B1 to B8, squat and failed-poke markers) | Chart cards toggle exists; default view is a data table | Have (check default) |
| S7 | Card measures: market cap, RS, base depth, tightening, volume dry-up, up/down volume, now vs pivot, turnover | Same measures, plus RVOL | Have |
| S8 | Momentum chip per stock (Powering up, Cooling off) and "N bases match" selector | Not seen on cards | Missing |
| S9 | Sort: RS, now vs pivot, tightening, dry-up, up/down volume, base age, 52-week high, market cap | Same, plus RVOL | Have |
| S10 | Cards or list, hide numbers, customise cards and list, chart settings, per-page 20 to 100, pagination, find in screen | Same set | Have |
| S11 | Download or copy, Share per stock | Download or copy | Partial |
| S12 | Candidates always shown | Hidden behind "All matches are Avoid, show them anyway" when the market gate is closed | Differs |
| S13 | Backtest link from a screen | None | Missing |

## 2. Market

| # | BananaPatterns feature | Ours | Status |
|---|---|---|---|
| M1 | Breadth over time: 1D to Max and custom range | Snapshot readouts, plus a 6-month chart I added on Today | Partial |
| M2 | Choose the moving average (10, 20, 50, 100, 150, 200 SMA or EMA) | Fixed 10, 20, 50, 200 | Partial |
| M3 | Eight breadth series: confirmed uptrend, near all-time high (0 to 25%), above chosen MA (twice), near 52-week high and low, up and down on the day, up and down from open, breakouts, squats | Up and down on the day, above 50 and 200 DMA | Partial |
| M4 | Breadth "Across industries" and an industries filter | None | Missing |
| M5 | Sector rotation scatter: strength (RS) against change in momentum, four zones, ranked table, 58 industries and 192 subgroups, hover to trace the path | Rotation tab lists today's 1-day sector move only | Missing |
| M6 | Rotation: switch between industries, indices, subgroups, stocks, watchlist | None | Missing |
| M7 | Rotation: 18 preset questions ("Which strong industries are losing steam?") and "find a stock on the map" | None | Missing |
| M8 | Sectors page: strongest sectors by fresh breakouts and leaders, heating and cooling with RS change | Sector cards by 1-day move and advancing count; sector heatmap | Partial |
| M9 | Compare: returns or RS of indices and stocks over 1D to Max, add stock or index | None | Missing |
| M10 | All-indices explorer: 121 NSE and BSE indices, stage chips (Powering up, Turning up, Cooling off, Falling back), list or cards | 5 index tiles and index analysis pages | Partial |
| M11 | Per-industry pages | None | Missing |

## 3. Backtest

| # | BananaPatterns feature | Ours | Status |
|---|---|---|---|
| B1 | Backtest page: screen, period (Apr 2016 to Sep 2026, by year, custom) | Command-line scripts only; about 3 years of history | Missing |
| B2 | Entry: as it breaks out, or next morning's open | Scripts: next open | Missing in UI |
| B3 | Stop: percent below entry, pivot or breakout-day close | Scripts: 7%, 2 x ATR | Missing in UI |
| B4 | Exit rules: stop only, or a close below the 10 to 200 SMA or EMA, at the next open or the same close | Scripts: 3R target, 21 or 50 EMA | Missing in UI |
| B5 | Costs, capital, positions at a time, sizing (by risk or equal money), position cap, turnover participation limit | Costs only | Missing in UI |
| B6 | More settings: squat exit, chase limit, break-even stop trigger | Scripts: 5% chase limit | Missing in UI |
| B7 | Backtest a single stock | None | Missing |
| B8 | A market filter in the backtest | They do not list one. Ours has the breadth gate | Ours is ahead |

## 4. Watchlist, learning, account (partly not seen)

| # | BananaPatterns feature | Ours | Status |
|---|---|---|---|
| W1 | Personal watchlists with strength, leaders, rotation placement | Nifty 50 monitor, add and reset personal list | Partial (not seen) |
| L1 | How it works: anatomy of a breakout, rule definitions per screen (prior uptrend RS 70+, base 3+ weeks and at most 35% deep, volume dry-up at 0.9x or less, pivot, breakout, climbing), the trade method (1.5% risk, about 8% stop, break-even, trail) | About & risk | Missing |
| L2 | 10 video episodes, FAQ, guided tour, course teaser | None | Missing |
| A1 | Sign-up, one-tap email link, saved screens per user | Single user, no login | Skip |
| D1 | Data: 5,000+ NSE and BSE stocks, 1,657 in the liquid universe, 10 years, updated after each session | About 2,300 NSE stocks, 1,044 liquid, about 3 years, live Fyers prices | Partial |

## 5. Where we are ahead

Live Fyers prices; trade plan per stock (buy, stop, two targets, position size); Weekly Top 5 with a tested rule and size note; market-mode verdict on every page; paper trading for stocks and index futures; email alerts and owner alerts; scanner edge badges from our own backtests; Bottomed Out; RPCI, oscillators and RSI Edge scanners; no sign-up.

## 6. What to implement, in order

| Priority | Item | Covers | Effort |
|---|---|---|---|
| 1 | 10 years of daily history for every stock, cached and refreshed daily | D1, makes everything below testable | Medium |
| 2 | Backtest page with their settings plus our ATR stop, 3R and breadth-gate options, and single-stock backtest | B1 to B7 | Large |
| 3 | Sector and industry rotation (RS against momentum), ranked table, preset questions, industries or indices toggle | M5 to M8 | Large |
| 4 | Breadth history page: ranges, MA choice, all-time-high and 52-week proximity, up or down from open, breakouts and squats, by industry | M1 to M4 | Medium |
| 5 | Core Setups: show candidates when the gate is closed (with a warning), cards by default, full filter bar, custom and saved screens | S1 to S3, S8, S12, S13 | Large |
| 6 | Compare page and all-indices explorer | M9, M10 | Medium |
| 7 | How-it-works page with each screen's rules and our trade method | L1 | Small |
| 8 | Announcements and results feed | S3, S5 | Medium, needs a data source |

Skipped on purpose: sign-up and accounts, per-industry public pages, the course and videos.

## 7. Filtering test: their VCP screen against ours (17 Oct 2026, 16 Oct close)

Thresholds are the same: `HOUSE_PRESETS` in `src/lib/screen/criteria.ts` was ported from their bundle (VCP: RS 70+, above 50 and 200-day, within 30% of the 52-week high, 15%+ above the low, base 3+ weeks and at most 35% deep, tightening at most 0.90, volume dry-up at most 0.90). Their liquidity floor is market cap ₹300 Cr and ₹1 Cr traded a day. Ours is ₹5 Cr median turnover, and most of our rows have no market cap.

| | Count |
|---|---|
| Their VCP "Forming" list (parsed) | 50 of 52 |
| Our VCP forming list | 18 |
| In both | 16 |
| Theirs only | 34: 19 not in our universe (our floor), 15 fail a rule by a small margin |
| Ours only | 2 |

Why the 15 near-misses fail in ours: RS 61 to 69 against their 71 to 76 (5 stocks; our RS ranks only liquid stocks, so it runs about 5 to 10 points lower), tightening or dry-up 0.91 to 1.13 against their 0.65 to 0.90 (5), base age 2.8 weeks against 3 (3), missing 200-day data (2).
On the 16 shared stocks the measures agree closely (mean absolute difference: base depth 0.05%, tightening 0.04, dry-up 0.06, now vs pivot 0.5%, RS 4.3), so the base engine is a faithful port.

Liquidity floor test (`BT_FLOOR=1 node scripts/backtest-scanners.mjs`): raw scanner hits averaged -0.13R in every band (₹1-2 Cr, ₹2-5 Cr, ₹5-20 Cr, ₹20 Cr+). Buy-ready trades: +0.36R (126), -0.13R (254), -0.02R (852), -0.05R (2,397), noisy. No evidence that the ₹5 Cr floor improves results.

## 8. Count reconciliation, all four screens (16 Oct 2026 close)

Stage counts, BananaPatterns against ours (`/api/market/screen`, calendar-year Played out):

| Screen | Forming | Fresh | Climbing | Played out |
|---|---|---|---|---|
| VCP | 52 vs 18 | 12 vs 6 | 61 vs 14 | 351 vs 122 |
| Blue sky | 274 vs 106 | 25 vs 15 | 110 vs 66 | 402 vs 456 |
| Multi-year breakouts | 98 vs **0** | 5 vs 1 | 46 vs 13 | 235 vs 108 |
| IPO base | 18 vs 9 | 0 vs 0 | 19 vs 10 | 109 vs 80 |
| Total | 1,817 vs 1,024 (ours is 56%) | | | |

Why, stock by stock (Forming, Fresh and Climbing lists; 653 of their 720 names could be read and matched; `tmp/recon.mjs`):

| Cause | Stocks | Share |
|---|---|---|
| Same stage on the same screen in both | 197 | 30% |
| In ours, but at a different stage | 80 | 12% |
| In ours, but fails a rule (RS 61 stocks, base age 64, structure level 59; more than one can apply) | 173 | 26% |
| Our liquidity or market-cap floor removes it (turnover under ₹5 Cr, e.g. ARIHANTCAP ₹2.1 Cr/day) | 99 | 15% |
| Not in our stock list (trade-for-trade series, new listings, SME) | 104 | 16% |

Ours-only: 61 stocks. Played-out lists were not matched by name; ours counts breakouts from 1 January of this year, theirs from the last 12 months.

Two structural findings:
1. **Nested bases.** Their engine evaluates every base a stock has (labels B1 to B8, "2 bases match") and lists the stock if any one passes. We evaluate one base per stock. That is why Multi-year "Forming" is 0 against 98 (33 stocks fail only on base age, because our base is the latest short one), and why 36 Blue sky stocks fail only on structure level (ours says level 2 or 3, theirs matches the level-1 base).
2. **RS scale.** 24 stocks fail only on RS (ours 61 to 69, theirs 70+), because we rank against liquid stocks only.

## 9. Step 2a done: every base is judged, not just the innermost (18 Oct 2026)

`walkEpisodes` now returns every born base (`bases`, outermost first). `computeMetrics` measures each (`formingBases`), and `/api/market/screen` adds a `forming` row (`SYMBOL|forming|L<level>`) for any screen that only an outer base satisfies (`src/lib/screen/multiBase.ts`, `judgeBases`). Under a live breakout, an outer base whose lid is still above the price counts as forming. A stock lists once per screen and stage.

| Screen, stage | Theirs | Before | After |
|---|---|---|---|
| VCP forming | 52 | 18 | 22 |
| Blue sky forming | 274 | 106 | 153 |
| Multi-year forming | 98 | 0 | 35 |
| IPO base forming | 18 | 9 | 11 |
| All Forming, Fresh, Climbing | 720 | 258 (36%) | 346 (48%) |

Stocks on both lists: 197 to 266. Fails-a-rule: 173 to 112. Left: floor 99, not in our list 104, other stage 72, RS scale and base age (needs longer history).

## 10. Step 2b done: wider screen floor, names not breakouts, 12-month window (18 Oct 2026)

- `SCREEN_FLOOR` (₹300 Cr market cap, ₹1 Cr median turnover) in `metrics.ts` feeds only the Core Setups screens and the breakout record. `LIQUIDITY_FLOOR` (₹300 Cr, ₹5 Cr) still drives breadth, Today's Picks, the Weekly Top 5, Buy ready, scanners and Bottomed Out. Verified unchanged after the switch: 1,043 liquid stocks, breadth 30.4% and 53.9%, Top 5 (SKYGOLD, CUPID, FCL, RATNAVEER, TFCILTD), 79 qualifying, 10 Bottomed Out.
- Thinner stocks the screens now list go in `extraRows` flagged `liquid: false` (`rows` and the market breadth built from it stay tradable-only). Their RS is placed on the existing scale (`rsScale.ts`, `rsAmong`) without moving anyone else's rating, on today's scale and per breakout day.
- Played out covers breakouts from the last 12 months (`playedOutSince`), and lists each stock once per screen with its most recent breakout. BananaPatterns counts names ("1-100 of 109 names"). Blue sky Played out: 405 stocks against their 402.

| Screen, stage | Theirs | Start of day | Now |
|---|---|---|---|
| VCP forming / fresh / climbing / played out | 52 / 12 / 61 / 351 | 18 / 6 / 14 / 122 | 31 / 6 / 15 / 157 |
| Blue sky | 274 / 25 / 110 / 402 | 106 / 15 / 66 / 456 | 183 / 21 / 76 / 405 |
| Multi-year | 98 / 5 / 46 / 235 | 0 / 1 / 13 / 108 | 50 / 2 / 17 / 146 |
| IPO base | 18 / 0 / 19 / 109 | 9 / 0 / 10 / 80 | 14 / 2 / 12 / 91 |
| Total | 1,817 | 1,024 (56%) | 1,228 (68%) |

Largest gaps left: VCP climbing (15 against 61) and VCP played out (157 against 351), where our breakout-day measures (tightening, dry-up, base depth) fail more often than theirs; stocks not in our NSE list (trade-for-trade, new listings); RS scale.

## 11. Step 2c done: each breakout judged on its own exit, like their Climbing and Played out (18 Oct 2026)

Evidence from their stock panel (KABRAEXTRU, "Base characteristics"): Base 3, pivot ₹269.61, breakout 02/07/2026, 17.6 weeks, depth 32.48%, tightening 0.75, dry-up 0.59, passes VCP. Our engine found the identical base and measures (episode L2, 2026-07-02, pivot 269.61, 17.6wk, 32.5%, 0.75, 0.59). The gap was afterwards: when a later, bigger breakout began, our walk marked the July breakout "rebased" and dropped it, while BananaPatterns keeps holding every breakout to its own exit (a close 8% under its entry, or under the 50-day average once above it). Of 43 of their VCP climbing stocks whose breakout date we also found, the lid (pivot) matched within 1% for 42.

Change: `independentExit` in `episodes.ts`; the screen route now lists earlier ("rebased") breakouts as Climbing/Fresh if they never exited, or Played out if they did, each screen once per stock and stage. Verified unchanged: liquid stocks, breadth, Top 5, Bottomed Out.

| Screen, stage | Theirs | Before | Now |
|---|---|---|---|
| VCP climbing / played out | 61 / 351 | 23 / 157 | 38 / 265 |
| Blue sky climbing / played out | 110 / 402 | 76 / 405 | 85 / 411 |
| Multi-year climbing / played out | 46 / 235 | 17 / 146 | 33 / 198 |
| IPO base climbing / played out | 19 / 109 | 12 / 91 | 14 / 112 |
| Total, all 16 cells | 1,817 | 1,236 (68%) | 1,466 (81%) |

Stocks on both lists (Forming, Fresh, Climbing, 653 matched names): 197 at the start of 17 Oct, 351 now. Left: fails a rule 112, not in our NSE list 104, different stage 75, below floor 11.

## 12. Step 2d done: trade-for-trade and new listings added (18 Oct 2026)

`scripts/update-universe.mjs` now keeps NSE series EQ and BE (trade-for-trade, delivery only, usually a 5% band); BZ (non-compliant) is left out. The list went from 2,327 to 2,575 stocks (2,344 EQ, 231 BE): 52 new regular listings, 198 added BE, 2 delisted or renamed (CCAVENUE, WARDINMOBI), and 33 stocks NSE moved from EQ to BE since the last refresh. BE stocks are tagged `T2T` on every screen row and never count as tradable (`tradable: false` in `computeMetrics`), so they stay out of breadth, Today's Picks, the Weekly Top 5, Buy ready, scanners and alerts. They appear only on the screens and the breakout record.

| | Theirs | Before | Now |
|---|---|---|---|
| All 16 cells | 1,817 | 1,466 (81%) | 1,541 (85%) |
| Matched names on both lists (Forming, Fresh, Climbing) | | 351 | 381 |
| Names not in our list | | 104 | 73 |

Effect on trading signals: liquid stocks 1,043 to 1,040, breadth 30.4% to 30.3%, 79 stocks still qualify for the Top 5. The Top 5 changed from SKYGOLD, CUPID, FCL, RATNAVEER, TFCILTD to SKYGOLD, CUPID, WHEELS, SHANTIGOLD, FCL: RS is a percentile and the refreshed list shifted ranks by a point, so two stocks tied in the 98 to 99 band swapped (RATNAVEER and TFCILTD still qualify). Re-run `npm run update-universe` weekly, since NSE moves stocks between series.
