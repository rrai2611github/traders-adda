# Task Summary: Backtest engine, tested setup, live strategy check, email alignment

## Date
2026-10-19 (Mon, market open; last saved price candle is Fri 2026-10-16)

## Task
Improve the "Traders Adda" NSE stock-analysis app (Next.js 16, local production build at http://localhost:3107; read `node_modules/next/dist/docs/` before writing Next code). This stretch: build a 10-year Backtest engine/page, find the best-supported strategy, surface it in the app (Top picks, checklist, plans), add a live forward test ("Live strategy check"), and align the pre-open and hourly emails to it.

User preferences: plain simple language, step by step; ask before changing live trading rules / anything that sends email to the 9-address EMAIL_TO list (auto-send is ON: pre-open 09:00 IST and hourly 09:15–15:15 go to all 9; test sends use `?test_to=` and go only to rupesh.rai2611@gmail.com); don't delete the BananaPatterns Chrome profile (`tmp/bp-profile`) or its window.

## Decisions Made
- **Strategy of record** = Blue sky + Multi-year breakouts bought on the breakout day (next open), 8% stop (12% = smoother option), exit on close under 50-day SMA, breadth >= 35%, 10 positions, 2% risk (20% position cap), 0.25% cost/side, max 3 new/day. Optional extra gate: Nifty 50 above its 200-day average.
- **Engine bug fixed (important)**: ~40% of old "trades" were slivers bought with leftover cash. A buy is now skipped if cash covers < 50% of the wanted size (`MIN_FILL_FRACTION` in `src/lib/backtest/simulate.ts`). All headline numbers were recomputed. Corrected full-period (Dec 2016–Oct 2026, ₹10L): Blue sky 358L/44%/-31% DD; + Multi-year 422L/46%/-27%; 12% stop 413L/46%/-21%; Nifty>200 385L/45%/-25% (total losses down ~1/6); + Multi-year + 12% stop 447L/47%/-21%. User's own 2022-26 setup is 42.6L/41.5% (not 30.8L).
- **"Add to winners" showed no benefit after the fix** (420L vs 422L) so it was removed from live suggestions (engine option + Backtest-page field remain, neutral).
- Defences that hurt (don't add): next-day confirmation, break-even stops, time stops, drawdown pause/halving. RS 90 + 10% stop was noise, not an improvement.
- Fixed 3R target vs trailing 50-day exit for the Top 5 "leaders" rule: 6.4% vs 20% a year (R 0.12 vs 0.50).
- Setup check (one place): `src/lib/screen/setupGate.ts` — breadth >= 35% and, when known, Nifty above 200-day. Used by Top picks, stock analysis, checklist, emails. The older "Buy ready" 50% gate and the red banner at the top of Today were NOT changed (flagged to user as inconsistent).
- Exit shown everywhere = 50-day average for all stocks (the 100-day Multi-year line was removed).
- Paper-trading engine (Today's Picks, T1/T2) deliberately NOT rewritten (touches ~20 files); the Live strategy check replaces it for this strategy.

## Artifacts Produced
- Backtest engine `src/lib/backtest/`: `history.ts`, `derive.ts`, `signals.ts` (leaders, screens, confirmCandidates), `simulate.ts` (stops, trail, add-on, break-even, time stop, Nifty filter `niftyFilter`, drawdown brake, openAtEnd/markedValue, MIN_FILL_FRACTION), `run.ts` (stats, years table with profit/money used, `openPositions`, `pending` next-open signals, alsoScreens), `types.ts`, `validate.ts`, `jobs.ts` (child-process runner, cache keyed by RESULT_VERSION=4 + history stamp), `historyRefresh.ts`, `tracker.ts`, `trackerNoteFormat.ts`, `trackerNote.ts`.
- API: `/api/backtest`, `/api/tracker` (GET state; POST start/stop/refresh), `/api/market/nifty-trend`, `/api/market/results-dates`. Hooks `useNiftyTrend`, `useResultsDates`. Pages `/backtest` (`BacktestPage.tsx`: presets, Minimum RS, Nifty-above, also-screens, add-on fields, yearly profit + money-used table) and `/tracker` (`TrackerPage.tsx`).
- App logic: `readyToRun.ts`, `topPicks.ts` (broke-out tested screens first, then ready, then watch/extended; targets 2R/3R as optional partial profit), `pickAnalysis.ts` (single status: Buy on breakout / Buy now / Paper trade / Wait / Don't chase), `checklist.ts` (+Nifty, +results items), `topPicksResults.ts` (server), `setupGate.ts`, `niftyTrend.ts`/`niftyTrendServer.ts`, `src/lib/market/boardMeetings.ts` (NSE board-meeting results dates).
- UI: Today "Top picks" (`TodayBoard.tsx`) with one status chip, Full analysis fold-out, setup-check banner; `TradeChecklist.tsx`; `TradePlanCard.tsx`; Core Setups "10-yr test" chip (`LivePatternSection.tsx`, corrected numbers: Multi-year +0.8R/18%, Blue sky +0.5R/19%, VCP +0.6R/18%, IPO base +0.9R/18%); sidebar links to Live strategy check and Backtest.
- Emails: pre-open (`preOpenEmailFormat.ts`, `topPicksEmail.ts`, `preOpenEmail.ts`) and hourly (`hourlyEmailFormat.ts`, `hourlyEmail.ts`) both carry the Top picks section first/after index analysis; old scanner sections labelled "not backtested"; pre-open "New in this email" notice until 2026-11-02; hourly "Since the last update" line (`lastSetup` in `.cache/email-alert.json`); both mobile-safe (tested 320–844 px, no sideways overflow); hourly index levels now a 2x2 grid. Owner-only alerts: `src/lib/alerts/readyAlert.ts` (Ready breakouts), Top 5 tier alert, daily tracker note (`trackerNote.ts`, sends to PERSONAL_ALERT_EMAIL only).
- Scripts (experiments): `scripts/backtest-*.mjs` (cli, compare, trail, losers, losers2, sweep, sweep2, defence, profit, profit2, frontier, validate, validate2, microtrades, winners, preboom, ready, final, stress), `scripts/fetch-history.mjs` (`--recent` merges last month; never saves today's forming candle before 16:00 IST). `package.json`: `fetch-history`, `fetch-market-caps`, `refresh-data`.
- Tests: 586 passing (`node --test scripts/*.test.mjs`); `npx tsc --noEmit` clean. Docs updated in `.github/instructions/stock-analysis-workspace.instructions.md`.

## Current State
- Complete and live on localhost:3107 (rebuilt): everything above. Last actions: hourly email redesign + a [TEST] hourly sent to the user's own address only.
- Live strategy check: NO tracker is running (config file `.cache/strategy-tracker.json` deleted after a back-dated verification). The user must press "Start following from today" (options: Nifty 200-day gate, 12% smoother stop). A history refresh scheduler runs after 16:30 IST while a tracker exists.
- Market right now: breadth ~25-26% (<35%) and Nifty ~5% under its 200-day average, so every pick reads "Paper trade"; Today shows several fresh Blue sky breakouts (WHEELS, RATNAVEER, CPPLUS, EBGNG, KRISHANA...).
- Already happened (not by request): the scheduled 09:00 pre-open email on 2026-10-19 went to all 9 recipients in the new format; the user was told. The user then asked for and got a real hourly send to all 9 earlier today.

## Key Context for Continuation
- Open question to the user: add the "New in this email" notice to the hourly email for two weeks? Not decided.
- Open: align the red top banner "Weak market today. Do not buy new stocks" and the Buy-ready 50% gate with the 35% setup check (not asked/approved).
- Open: hourly stays every-slot; "send only when something happens" was offered, not requested. Auto-send to all 9 remains ON; ask before any send to the full list.
- Known limits to keep disclosing: today's stock list (survivorship bias), no historical market cap, results dates only for announced meetings, numbers selected after trying ~30 variants (some selection luck), last few years weaker, ~60% of trades lose.
- Shell tip: long heredocs/`node -e` with quotes fail in this Bash tool; write files with the Write tool or small `tmp/edNN.mjs` scripts. Restart the site after code changes: stop the listener on 3107, `npx next build`, `nohup node --use-system-ca node_modules/next/dist/bin/next start -p 3107 -H 127.0.0.1 > tmp/server.log &`. The first scan after restart takes ~60-70 s.
- Temp helpers in `tmp/`: `shot.mjs` (headless screenshot), `overflow.mjs` (sideways-overflow check at widths), `checklist-read.mjs`, `drawer-read.mjs`, `minw2.mjs`, `attach.mjs` (drives signed-in BananaPatterns Chrome on port 9222).
- Housekeeping still pending: weekly `npm run refresh-data` (stock list, market caps, history); the BananaPatterns Chrome window/profile stays open per the user.

## Agents Used
- None (all work done directly).

## Skills Applied
- artifact-design/other skills were loaded earlier in the session only for context; no skill drove this stretch. `dev-team:handoff` (continue mode) produced this file.
