# Task Summary: Email alert recipients and sender change (paused on Gmail block)

## Date
2026-10-08

## Task
Send the pre-open and hourly email alerts to a list of extra recipients (not the swing-trade-picks alert), and send them from tradersaddaofficial@gmail.com instead of the owner's personal Gmail.

## Decisions Made
- Recipients go in `EMAIL_TO` (comma-separated): only the pre-open ([preOpenEmail.ts](src/lib/alerts/preOpenEmail.ts)) and hourly ([hourlyEmail.ts](src/lib/alerts/hourlyEmail.ts)) alerts send email, both via `sendEmail` in [smtp.ts](src/lib/alerts/smtp.ts). The swing picks and scanner alerts go through Telegram, so the new recipients never receive them and nothing needed excluding.
- Changing the sender requires changing the SMTP login (`SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM`), not just the From header: Gmail rewrites From to the authenticated account.
- Corporate TLS interception: the company proxy re-signs Gmail's cert (`Aci Worldwide Inc Root CA`). Fixed by exporting that root to `C:\Users\rairup\certs\aci-root-ca.pem` and setting the user env var `NODE_EXTRA_CA_CERTS` to it. TLS verification stays on; do not disable it.
- Test emails were sent per recipient (separate messages), so recipients don't see each other's addresses. The real alerts send one message with everyone on `To:`.

## Artifacts Produced
- `.env.local` (edited by the user, not by Claude: a plugin hook blocks Claude from editing it): `EMAIL_TO`, `SMTP_USER`, `EMAIL_FROM`, `SMTP_APP_PASSWORD` updated.
- `C:\Users\rairup\certs\aci-root-ca.pem`: exported company root CA.
- User-level env var `NODE_EXTRA_CA_CERTS`: set by the user via `setx`.
- Scratchpad scripts (disposable): `check-sender.cjs` (verifies SMTP login and prints effective From, never prints the password), `send-test-all.cjs` (sends a test mail to each `EMAIL_TO` entry). Both run as `node --env-file=.env.local <script>` with `NODE_EXTRA_CA_CERTS` set.
- No source code was changed.

## Current State
- Complete: recipients added to `EMAIL_TO`; sender config points to tradersaddaofficial@gmail.com (From header verified as `Traders Adda <tradersaddaofficial@gmail.com>`); TLS trust fixed. An earlier test email reached all recipients from the new sender.
- Blocked: SMTP login for tradersaddaofficial@gmail.com now fails with `534-5.7.9 WebLoginRequired`. It fails on the corporate network and on a personal hotspot, with both the original and a newly created app password (`stock-analysis-2`), after the user did the browser unlock steps. This is a Google account-level block, not a password or network issue. The real pre-open and hourly alerts will fail to send until this is resolved.
- Deferred: the user declined a paid transactional mail service (Brevo/SendGrid/SES) for now and will decide later.

## Key Context for Continuation
- Next step: re-run `check-sender.cjs`. If it still fails, options are: wait and retry, check the account for a Google security lock or Workspace policy, send from a different Gmail account with a fresh app password, or use a free-tier SMTP relay. Only the `SMTP_*` values and `EMAIL_FROM` in `.env.local` change; no code change is needed.
- The `.env.local` `EMAIL_TO` list contains an unrecognised address that the user did not mention and a duplicate entry. Ask the user whether those are intended and remove them if not. Optionally dedupe `EMAIL_TO` in [smtp.ts](src/lib/alerts/smtp.ts) so a repeated address can't double-send.
- Dev server needs a restart from a new terminal after env changes (env is read at startup, and `NODE_EXTRA_CA_CERTS` was set after the terminal opened).
- The app password for `stock-analysis-2` was pasted into chat; recommend deleting it at myaccount.google.com/apppasswords and creating a fresh one once this resumes. No secrets are stored in this file.
- Claude cannot edit `.env.local`; tell the user exact lines to change.
- AGENTS.md says this Next.js version has breaking changes; read `node_modules/next/dist/docs/` before writing any Next.js code.

## Agents Used
- None.

## Skills Applied
- dev-team:handoff (this summary).
