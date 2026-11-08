# DisputeDesk AI — Phase 6.2: End-to-End Integration Audit

The evidence intelligence layer for payment disputes.

- Date: Nov 6, 2026
- Commit audited: `a34db75` on `master` (2 commits ahead of `origin/master`, not pushed)
- Audit only: no code, schema, auth or business-logic changes. Nothing installed, committed, pushed or deployed.
- No live PayPal or Gemini calls. Any request that would reach either was skipped or sent only where the server refuses it first.
- Live checks ran against the running app on synthetic demo accounts, from the browser pane, so real cookies, Origin and
  Sec-Fetch-Site headers applied. Restart and database-failure checks used a throwaway database in the system temp
  folder, deleted afterwards.

## Summary

| Area | Result |
|---|---|
| Baseline (git, tests, typecheck, build) | PASS |
| Merchant journey | PASS |
| Buyer journey | PASS |
| Admin journey | PASS |
| Cross-account and role checks (15 routes × 5 callers) | PASS |
| PayPal boundary | PASS (tests and code; no live call) |
| Gemini boundary | PASS (tests and an isolated AI-off server; no live call) |
| SQLite persistence and startup failure | PASS (isolated database) |
| Error and recovery | PASS, with three Low wording issues |
| Critical, High or Medium defects | None |
| **End-to-end integration status** | **PASS** |
| **Ready for the Phase 6.3 security audit** | **Yes** |

## 1. Baseline

| Check | Result |
|---|---|
| Branch, HEAD | `master`, `a34db75` Fix dark buttons, phone menu and edit-check wording from visual sign-off |
| P0 `7ba49a1`, P1 `f08ba14`, Phase 0.2 `4346fd0`, Phase 6.1 `a34db75` | All in history |
| Ahead / behind `origin/master` | 2 / 0 |
| Tracked changes, stashes | None, none |
| Untracked, preserved | `reports/demo-video-script.md`, `reports/devpost-description.md`, `reports/disputedesk-audit.pdf`, `reports/phase-0.2-validation-report.md`, `reports/phase-6.1-final-report.md`, `reports/phase-6.1-visual-signoff.md`, `reports/visual-qa/` |
| Server tests | 189 of 189 PASS |
| Client tests | 85 of 85 PASS |
| Typecheck (server, client) | PASS |
| Production build | PASS |

Capabilities found and not needed for an integration audit: Emil (`emil-design-eng`), Vercel Web Interface Guidelines
(`web-design-guidelines`), Taste 2.1.5, UI UX Pro Max 2.15.0, GSAP skills 1.0.0, Impeccable 4.8.0. Nothing installed
or enabled. Project hooks: none in `.claude/` beyond `launch.json`. The Chrome DevTools MCP server failed to connect;
the built-in browser pane was used.

## 2. Merchant journey (Demo Merchant A)

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Sign in | PASS | `POST /api/auth/login` 200, `me` role merchant. The sign-in form was not clicked through: see §8 |
| 2 | Dashboard | PASS | Demo banner, "Total disputes 2 · Unresolved 2 · Amount in dispute $178.99" |
| 3 | List and readiness | PASS | "DEMO-1001 … Key evidence 0 of 2", "DEMO-1002 … Key evidence 1 of 2 · 1 conflict" |
| 4 | Open a dispute | PASS | DEMO-1001 opens by default; DEMO-1002 opens from the list |
| 5 | Evidence readiness | PASS | "Key evidence on record 0 of 2 · Missing or unverified 2 · Conflicting records 0 · Gaps to fill in the draft 5" |
| 6 | Claim and records | PASS | Buyer's claim "From the record", what the records show with record paths |
| 7 | Evidence statuses | PASS | DEMO-1001: available ×2, missing ×2. DEMO-1002: available ×3, missing ×1, 1 contradiction ("Records disagree"). Unverified items exist only on Merchant C's disputes (DEMO-2007, 2008, 2010, 2014) |
| 8 | Source citations | PASS | "Based on: evidence.shipping_tracking = false; order.tracking_number = not on record; order.shipping_status = SHIPPED" |
| 9 | Rule-based draft (no Gemini) | PASS | Draft has `REQUIRES MERCHANT REVIEW`, 5 markers (DEMO-1001) and 4 (DEMO-1002), "Draft only… never sent to PayPal" |
| 10 | Edit the draft | PASS | Added a paragraph; "Reset to generated draft" restored the original exactly |
| 11 | Check my edits | PASS | "Your paragraph 1" flagged "3", FedEx, May, a carrier, a signature and a delivery claim, one reason per line; 4 markers left |
| 12 | Insights | PASS | Counts and dispute IDs only, no percentages below 10 disputes |
| 13 | Sign out | PASS | Sign out button returns to the landing page; `GET /api/auth/me` then 401 |

## 3. Buyer journey (Demo Buyer B)

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Sign in | PASS | 200, role buyer |
| 2 | Dashboard | PASS | DEMO-1002 ($129.00, Awaiting seller) and DEMO-1003 (€75.50, Under review), each with its usual stage |
| 3 | Open a dispute | PASS | Detail with status meaning, usual stages, next steps, information to have, talking to the seller, not on record |
| 4 | Status and timeline | PASS | "The usual order of a dispute, not a recorded history. Only the opened date comes from the record." |
| 5 | Next steps and guidance | PASS | Sections present and tagged |
| 6 | Source labels | PASS | "From the record", "General guidance", "Not on record" |
| 7 | No merchant-only data | PASS | `GET /api/buyer/disputes` has only `source, dispute_id, reason, status, amount, create_time, guidance`. On screen the only "tracking" text is general guidance ("Any shipping or tracking details the seller sent you"). No order, evidence, buyer message, draft or readiness |
| 8 | Sign out | PASS | `me` then 401 |

The "Explain in plain language" button was not clicked: Gemini is configured on this server.

## 4. Admin journey (Demo Admin)

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Sign in | PASS | 200, role admin |
| 2 | Overview | PASS | Loads, no errors |
| 3 | Disputes and ownership | PASS | All 17 demo disputes, each with its owning merchant |
| 4 | Merchants and buyers | PASS | No password hashes in the page or in `GET /api/admin/accounts` |
| 5 | Audit logs | PASS | Shows "Access refused" entries made by this audit's cross-account attempts; no passwords, tokens or hashes in `GET /api/admin/audit` |
| 6 | System health | PASS | `{"status":"ok","paypal":{"environment":"sandbox","configured":true},"ai":{"configured":true,"model":"gemini-3.5-flash-lite","reason":null}}`; no secrets |
| 7 | Read-only settings | PASS | No save, edit or delete controls. Mentions of "hash" are descriptions ("Stored as scrypt hashes only") |
| 8 | Restricted writes refused | PASS | Check my edits 403, AI draft 403, insights AI wording 403, buyer explanation 403, `PUT /api/admin/settings` 404, `DELETE /api/admin/accounts` 404. The dispute detail has no Check my edits or AI draft buttons and says "Admin view is read-only" |
| 9 | Sign out | PASS | `me` then 401 |

## 5. Cross-account and role checks

Each caller was signed in through `/api/auth/login` and called every route.

| Route | Signed out | Merchant A | Merchant B | Buyer B | Admin |
|---|---|---|---|---|---|
| `GET /api/auth/me` | 401 | 200 | 200 | 200 | 200 |
| `GET /api/disputes` | 401 | 200 (1001, 1002) | 200 (1003) | 403 | 200 (all 17) |
| `GET /api/buyer/disputes` | 401 | 403 | 403 | 200 (1002, 1003) | 403 |
| `GET /api/intelligence` | 401 | 200 | 200 | 403 | 200 |
| `GET /api/admin/accounts`, `/audit`, `/settings` | 401 | 403 | 403 | 403 | 200 |
| `GET /api/health` | 401 | 200 | 200 | 403 | 200 |
| `GET /api/sandbox/disputes` | 401 | not called (would reach PayPal) | 403 | 403 | not called |
| `POST /api/analysis` own / other's / missing | 401 | 200 / 404 / 404 | 404 / 200 / 404 | 403 / 403 / 403 | 200 / 200 / 404 |
| `POST /api/analysis/check` own / other's / missing | 401 | 200 / 404 / 404 | 404 / 200 / 404 | 403 | 403 |
| `POST /api/analysis/ai/example` (no Gemini) | 401 | 200 | 404 (not its dispute) | 403 | 200 |
| `POST /api/analysis/ai` | 401 | not called (would reach Gemini) | not called | 403 | 403 |
| `POST /api/buyer/explain` | 401 | 403 | 403 | not called | 403 |
| `POST /api/intelligence/explain` | 401 | not called | not called | 403 | 403 |
| Unknown `/api/*` route | — | 404 | 404 | 404 | 404 |

- Another account's dispute and a missing ID both answer 404 `dispute_not_found`, and the attempt is audited.
- Logout ends the session for every caller.
- Expired sessions: covered by tests ("sessions end after 30 idle minutes", "8 hours after login", "every protected
  route refuses missing, forged and expired sessions"). Seen live too: when a session ends, the next 401 returns the
  app to the landing page (`SIGNED_OUT_EVENT`, `client/src/sandbox.ts`).
- Every route uses `requireRole`; the role-table test in `server/src/app.test.ts` fails on any route missing from it.

## 6. Integration boundaries

| Boundary | Result | Evidence |
|---|---|---|
| PayPal: read-only | PASS | `server/src/paypal.ts` sends only the token POST and GETs. Tests: "only the token POST and read-only GETs are ever sent to PayPal", "the AI route sends PayPal only the token POST and read-only GETs". No live call made |
| PayPal: not configured | PASS | Isolated server with no PayPal client: `GET /api/sandbox/disputes` 503 |
| PayPal: failures | PASS | Tests: upstream errors, network failure, malformed bodies, expired token, no secrets in 502s |
| Gemini: AI off | PASS | Isolated server with no Gemini client: `POST /api/analysis/ai` 503 `ai_not_configured`; `POST /api/analysis` still 200. Tests: "AI drafting without a key is 503 and calls nothing", "with AI off for any reason…" |
| Gemini: configuration | PASS | Tests: configured only with a key; an invalid `GEMINI_MODEL` turns AI off, never the server; the key goes in a header, not the URL |
| SQLite: persistence | PASS | Isolated database: signed in, closed the server and database, reopened on the same file. Same cookie still 200, 2 disputes before and after, then logout 401 |
| SQLite: startup failure | PASS | A file that is not SQLite: "file is not a database". A directory path: "unable to open database file". Both stop before anything is served. Tests cover a failed migration (rolled back), a newer schema (refused) and a database error (generic 500, nothing about SQL) |

## 7. Error and recovery

| Case | Result | Evidence |
|---|---|---|
| Invalid credentials | PASS | 401 `invalid_credentials`; same answer for unknown email and wrong password (test) |
| Malformed sign-in | PASS | 400 `invalid_request` |
| Expired session | PASS | Tests; live sign-out handling as above |
| Unauthorized routes | PASS | 401 signed out, 403 wrong role (§5) |
| Missing dispute ID | PASS | 404 `dispute_not_found`, same as cross-account |
| Invalid lookup | PASS | `{source:"nope"}` 400 |
| Invalid draft input | PASS | Non-string text 400 |
| Oversized draft input | PASS, Low wording issue (L1) | 8,001 characters: 400 "text must be a string of at most 8000 characters." Over 16 KB: 413 `payload_too_large` |
| Empty lists | PASS | Screenshot 37 (Phase 6.1) and client tests for loading, empty and error states |
| Backend unavailable | PASS (code and tests), live NOT TESTED | `serverError()` in `client/src/sandbox.ts` shows "The DisputeDesk server is not responding. Start it with npm --prefix server start". Not run live, so the running app wasn't stopped |
| Database initialisation failure | PASS, Low (L3) | Refused at startup (§6); the process exits with a raw stack trace |

## 8. Bugs

No Critical, High or Medium bugs.

| ID | Bug | Severity | Files | Minimal fix |
|---|---|---|---|---|
| L1 | A draft over 8,000 characters gets a technical error ("text must be a string of at most 8000 characters. (HTTP 400)"), or "The request body is too large" over 16 KB. The editor has no length limit or counter | Low | `client/src/AnalysisPanel.tsx`, `server/src/app.ts` | `maxLength={8000}` and a character count on the draft box, plus a plain message ("Your draft is longer than 8,000 characters, the most Check my edits reads.") |
| L2 | Opening a view or dispute does not change the URL, so Back leaves the app and a dispute can't be linked | Low (by design so far) | `client/src/App.tsx` | Optional: a hash per view and dispute. Not needed for the demo |
| L3 | A database that can't be opened stops startup with a raw stack trace instead of one plain line | Low | `server/src/index.ts` | Catch around `openDatabase` that prints "Could not open the database at <path>: <reason>" and sets the exit code |
| N1 | Merchant A's disputes have no unverified evidence, so the demo journey shows only available, missing and a contradiction. No demo record has an item with the `conflict` status; conflicts show as contradictions | Note | `demo-disputes.json` (no change made) | For the video, show unverified items as Merchant C (DEMO-2007) |

## 9. Regression risks

- `forMerchant()` in `server/src/assist.ts` rewrites check wording by text replacement. If a reason in `problems()`
  is reworded, the merchant text may read oddly. The new test in `app.test.ts` catches "supplied" or a semicolon
  slipping through.
- The one-row phone menu hides its scrollbar. A new view added to the rail must still be reachable by swiping.
- The role-table test protects routes. A new route without `requireRole` fails it.
- The demo files are the source of truth: changes to `demo-accounts.json` or `demo-disputes.json` change the counts
  quoted in the README and the video script.
- The audit log is append-only. This audit added sign-in, analysis and "Access refused" entries to the local
  database, as normal use does.

## 10. Remaining unverified behaviour

- Live Gemini output: merchant AI draft, buyer explanation, insights wording.
- Live PayPal sandbox list and analysis.
- Clicking through the sign-in form. The browser pane was hidden at first, which paused the landing intro's animation,
  and later the pane was in use. Sign-in was tested through the same `POST /api/auth/login` the form uses; the form
  itself is covered by client tests.
- Backend unavailable, live, in the browser.
- Idle and 8-hour session expiry, live (covered by tests with a fake clock).
- The sign-in lockout after repeated failures, live (covered by tests; not triggered, to avoid locking demo accounts).
- Keyboard-only use, screen reader, real phones.

## 11. Phase 6.3 security audit readiness

**Ready.**
- Every route has a role, cross-account access is indistinguishable from a missing record, and admin has no write path.
- No secrets appear in API replies, the audit log or the health check.
- PayPal and Gemini sit behind read-only and off-by-default boundaries.

Suggested starting points for 6.3:
- The sign-in limiter and lockout.
- The cookie flags over plain-HTTP localhost.
- The Origin and Sec-Fetch-Site guard.
- The production CSP.
- `.env` handling.
- A dependency audit (read-only `npm audit`, which needs no install).
