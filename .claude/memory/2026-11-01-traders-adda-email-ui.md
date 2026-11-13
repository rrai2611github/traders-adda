# Handoff: Traders Adda email + UI work (2026-11-01)

## State
All work done, tested (755 tests, tsc and eslint clean) and pushed. main == origin/main at 786d377. Two [TEST] emails sent only to rupesh.rai2611@gmail.com; real-send record unchanged (`2026-10-30:preopen`). No open edits.

## Standing rules
- Plain, simple language.
- Ask before changing live trading rules or anything that emails the 9-address EMAIL_TO list (auto-send ON: pre-open 09:00 IST, hourly 09:15-15:15 IST).
- Never touch `tmp/bp-profile`.
- Never ask the user to paste secrets in chat.
- App never places orders; AI features optional (no Anthropic key).
- Push only when user says "push".
- Test emails: `POST /api/alerts/preopen?test_to=ADDR` or `/api/alerts/email?test_to=ADDR` (Origin/Host = localhost:3107). Address must already be in EMAIL_TO. Use rupesh.rai2611@gmail.com only.

## What shipped this stretch
- Drawer "Quick read"; Auto theme; units lines; Scalp shared nav; Top Gainers/Losers card with watch-only "Heating up" tag.
- Phone cards for trade tables.
- Email overhaul (`src/lib/alerts/*`): decision-first subject, slim "Today's action" bar (`emailDecision`/`decisionBarHtml` in topPicksEmail.ts), 3 cards on paper days, shorter wording, no Yahoo/price-fetch lines.
- Global cues: sector cues, India headlines (`src/lib/market/indiaNews.ts`); crude/rupee removed from the Nifty bias score (10-year study).
- Findings are recorded in `.github/instructions/stock-analysis-workspace.instructions.md`.

## Next (user-side)
- Monday 09:00 IST: first real pre-open email. Check the subject starts with the decision and the new bar and sections look right.
- Check "Last email recorded" on Email track record.
- First live-check session after ~4:30 pm.

## Optional ideas (only if user asks)
- Shorten the hourly email (~5,700px) by leading with "what changed".
- Label tested vs older scanner lists more clearly.
- Track-record line in emails once at least 30 emailed picks are scored.
- Test Hang Seng/Kospi/DAX weights.
- Sparkline tiles, empty-state illustrations, toasts outside Positions.

## Tooling notes
- Python unavailable. Node stdin scripts mishandle non-ASCII and CRLF, so use Edit/Write.
- Rebuild: PowerShell `& ".\Run Traders Adda.cmd" rebuild`. Universe takes ~20-30 s to load after restart.
- UI check: `npm run check:ui -- --flow`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
