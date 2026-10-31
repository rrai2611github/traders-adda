# Task Summary: Bottomed Out screener + hourly email upgrades + email redesign preview

## Date
2026-10-12

## Task
Add a backtested "Bottomed Out" screener to the app, put it (plus Sector heat, hourly index analysis, CMP, SL/targets) into the hourly email alert, then redesign the email. The redesign currently exists only as a preview HTML mock; the real email code has NOT been switched to the final design.

## Decisions Made
- Bottomed Out rules (src/lib/screen/bottomedOut.ts): liquid, close 35%+ below 252-session high, 120-session low set 8-60 sessions ago, close 8-50% above it, last-5-session low >2% above base low, close above EMA20. "Deep" tier = 50%+ off high. Only the deep tier held up in the backtest (about +0.11R, 397 trades, fixed -8% stop / +16% target, Oct 2024-Oct 2026); early tier lost (-0.13R). Volume, EMA50, RSI divergence and breadth gates did not help consistently, so they are context only and never filter or rank.
- Hourly email only lists the deep tier. Early tier stays on the app page as watch-only.
- Bullish confluence list capped at the 10 strongest (families, then RS + PA), each with Buy above / SL / T1 / T2 from tradeLevels. Bottomed out list is uncapped. Sector heat shows top 5.
- Hourly index analysis uses completed 1-hour Yahoo candles (forming hour and Yahoo's off-grid quote bar excluded). Bias badge = daily + weekly + hourly trend + position vs frozen 9:07 pre-open levels; Neutral if above resistance on weak breadth. "Plan for today" text is rule-based and conditional.
- Email notes/footnotes were trimmed on the user's complaint of too many comments.
- Redesign preview: no fake "confidence %" for Stock of the Hour (no calibrated probability exists); Market Mode uses the app's 50% breadth gate (<35 Defensive, 35-50 Cautious, >=50 Constructive).

## Artifacts Produced
- src/lib/screen/bottomedOut.ts, bottomedOutResults.ts, src/app/api/market/bottomed-out/route.ts, src/components/BottomedOutScreener.tsx: screener, API, page (nav key "bottomed", #bottomed-out, Scanner directory family "Reversals").
- scripts/backtest-bottom.mjs: backtest; scripts/bottomed-out.test.mjs and additions in hourly-email.test.mjs / index-email.test.mjs (403 tests passing at last run).
- src/lib/market/indexHourly.ts + YahooProvider.getHourlyCandles: hourly index read.
- src/lib/alerts/hourlyEmail.ts, hourlyEmailFormat.ts, indexEmailFormat.ts, hourlyConfluence.ts, modernCards.ts, brand.ts, smtp.ts, scannerAlert.ts: email sections, card components, `sendHourlyTestEmail` and POST `/api/alerts/email?test_to=<addr>` (test send to ONE address already in EMAIL_TO; writes no state).
- email-preview/build-preview.mjs: generates email-preview/hourly-email-updated.html (final redesign mock: header with market mode + big KPIs, Stock of the Hour, index pulse strip + range-gauge cards, sector bars, numbered watch/confluence/bottomed cards in a 2-column grid that stacks on phones). Needs the app running on :3107.
- email-preview/backup/: timestamped backup (20261012-1625) of hourly-email-updated.html and build-preview.mjs ("keep this html form for now in backup").
- email-preview/hourly-email-preview.html: earlier snapshot of the real (pre-mock) email.
- .github/instructions/stock-analysis-workspace.instructions.md: notes on the Bottomed Out screener.

## Current State
- Complete and live in the app (after rebuild): Bottomed Out screener/page/API/directory entry; hourly email sections (CMP, Sector heat top 5, hourly index cards with bias + plan, confluence top 10 with plan, Bottomed out, shorter notes).
- Complete as mock only: the full redesign in email-preview/hourly-email-updated.html (user said "looks good", asked for numbering and font check, both done in the mock; user then asked to keep it in backup).
- Not done / deferred: porting the redesign (header/KPI/market mode, Stock of the Hour, index pulse + gauge cards, 2-column grid, numbering, bigger type scale) into the real hourly email builder (src/lib/alerts/hourlyEmailFormat.ts, indexEmailFormat.ts, modernCards.ts, brand.ts). Real email still uses the earlier single-column card design. Also pre-open email still has the old tables.
- Offered but not answered: shorten long company names / move badge so names stay on one line; apply ladder cards to Buy ready/confluence/bottomed; hide Midcap 100 card boxes (done in real email, mock shows "Levels n/a").

## Key Context for Continuation
- App runs as a production build on http://localhost:3107. After any code change run `.\scripts\run-app.ps1 rebuild` (stops and restarts the app). Fyers shows not connected; Yahoo is the data source.
- EMAIL_AUTO_SEND is ON with 8 real recipients. NEVER call POST /api/alerts/email without `test_to` (that sends to everyone). GET /api/alerts/email and ?html=1 are preview-only. Use `?test_to=<user's own address, first in EMAIL_TO>` for test sends; only addresses in EMAIL_TO are accepted.
- After a rebuild the NSE universe takes a minute or two to load; endpoints return 503/"still loading" until then.
- In this shell, bash heredocs containing apostrophes sometimes fail to parse; write scripts with the Write tool instead.
- The mock's index section is parsed from the real email's HTML (regex/tokens), fine for a preview; the real port should take values straight from the index data (indexEmailFormat.ts LiveIndexRead has support, resistance, sma20/50, bias, plan, hourly).
- Honest limits: Bottomed Out edge is thin (two years of data, survivorship bias); deep tier is empty on most days. Buy ready is empty while breadth < 50%.
- Earlier analysis answered for the user: PTCIL, PNB Housing, Cartrade, Gallantt Ispat "volume breakout" check (only PTCIL a clean breakout but extended; Gallantt a 77x illiquid spike below 200 EMA, avoid).

## Agents Used
- None (all work done directly in the session).

## Skills Applied
- dev-team:handoff (this summary).
