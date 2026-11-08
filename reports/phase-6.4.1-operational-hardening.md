# DisputeDesk AI — Phase 6.4.1: Operational Security Hardening

Date: 2026-11-07
Scope: Phase 6.3 findings L1, L3, L4, L5.
State: changes are in the working tree, **not committed, not pushed, not deployed**.

## 1. Git baseline

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD at start | `c4d24b8` "Count sign-in failures per client behind a trusted proxy and cap AI calls per account" (Phase 6.4, present) |
| Ahead of origin | 4 commits, not pushed |
| Uncommitted changes at start | None in tracked files |
| Stashes | None |
| Untracked | `reports/` files only (6.1–6.4 reports, demo script, Devpost text, audit PDF, `visual-qa/`). All preserved; none overwritten. |

Installed skills and tools were listed from the session; nothing was installed or enabled.

## 2. Decisions taken with the user

Two choices were put to the user before any code was written:

| Finding | Options offered | Chosen |
|---------|-----------------|--------|
| L1 | Email+address key with a higher per-email cap; growing delay per email; accept as is | **Email+address key** |
| L4 | Keep the audit log append-only (no schema change); migration v4 allowing deletion of old rows | **No schema change** |

No database migration was written. The append-only guarantee in `CLAUDE.md` and the database triggers are unchanged.

## 3. Findings and resolutions

### L1: Targeted lockout through the per-email cap — Mitigated

**Before.** 10 failed sign-ins for an email, from anywhere, locked that email for everyone (owner included) for 15 minutes.

**After.** Three counters, all over the same 15-minute window:

| Key | Limit | Effect when reached |
|-----|-------|--------------------|
| email + address | 10 (`LOGIN_MAX_FAILURES`) | That address can't sign in to that email |
| email, all addresses | 50 (`LOGIN_MAX_FAILURES_PER_EMAIL`, new) | Email locked for everyone |
| address | 100 (`LOGIN_MAX_FAILURES_PER_ADDRESS`) | Address locked for all emails |

- An attacker on one address can no longer lock the owner out. Locking the owner out from everywhere now needs at
  least 5 addresses (50 failures, 10 per address), and brute force against one email stays capped at 50 guesses per
  15 minutes.
- **No account enumeration.** Unknown emails are counted and answered exactly like known ones (same status, same
  body, same `Retry-After`). Tested.
- **Concurrency fix (found during this work).** Before, the failure was recorded *after* the slow scrypt check, so
  many requests sent at once could all pass the limit check. Now each attempt is counted *before* the password check;
  a correct password then takes its own count back (`forgive`) and clears the email+address key. Tested with 15
  simultaneous wrong attempts: exactly 10 are checked (401), 5 are refused (429).
- **Locally nothing changes**: all traffic comes from 127.0.0.1, so email+address equals email. The improvement
  applies behind a trusted proxy (`TRUST_PROXY`, Phase 6.4).
- Admin › Settings now lists both per-account limits.

### L3: Missing HSTS and Permissions-Policy — Resolved

- **Permissions-Policy** `camera=(), microphone=(), geolocation=(), payment=(), usb=()` on the API (`app.ts`) and on
  the page (`security-headers.ts`, dev and preview).
  - Checked against the app first: it uses `navigator.clipboard.writeText` (Copy draft) and an autoplaying muted intro
    video. `clipboard-write` and `autoplay` are therefore **not** restricted.
- **HSTS** `max-age=31536000` on the API **only when `req.secure`**, which is true only behind a trusted proxy that
  reports `X-Forwarded-Proto: https`. Never on local HTTP; a spoofed header without `TRUST_PROXY` does not turn it on
  (tested, and checked on a live server instance).
  - No `includeSubDomains` or `preload`: those are domain-wide decisions for whoever deploys it.
  - Not set on the page servers (Vite dev and preview are plain HTTP). The README says to set it on the HTTPS server
    in front of the page.
- Other headers reviewed: the API already sends nosniff, `X-Frame-Options`, `Referrer-Policy`, CORP and a deny-all
  CSP; the page sends nosniff, `X-Frame-Options`, `Referrer-Policy`, COOP and the strict production CSP. No other
  essential header was missing.

### L4: Audit log and session table growth — Partly resolved (sessions); audit log documented

**Sessions.**
- Signed-out and expired sessions are now cleared at server start (`sessions.prune()`), in addition to every sign-in.
- The same expiry rule as `get()` is used, so a live session is never deleted. Tested: after a restart a live
  session still works, while the signed-out and idle ones are gone.
- Remaining growth is bounded by live sessions (8-hour absolute limit).

**Audit log.**
- Kept append-only, as chosen. No rows are deleted; the database triggers still refuse `UPDATE` and `DELETE`.
- The server now prints the audit log's entry count and database path at start, so growth is visible.
- README documents archiving: stop the server, copy the database file, then delete `server/data` for a fresh log.
- Growth is still unbounded by design. See Remaining risks.

### L5: Limiter memory growth — Resolved

Applies to both the sign-in limiter and the per-account AI limiter (same code).

- **Key cap** `LIMITER_MAX_KEYS = 10,000`. At the cap the key with the oldest latest failure is forgotten first.
- **Per-key cap**: each key keeps at most 100 timestamps (the highest limit any caller checks), so a hot key can't
  grow without bound. Worst case is a few MB.
- **Expiry without scanning**: keys are stored in order of their latest failure, so expired keys are dropped from the
  front and the sweep stops at the first live key. The old code scanned every key on every failure.
- **No premature expiry**: a key is removed only when its newest failure has left the 15-minute window.
- **Concurrency**: Node runs each limiter call to completion on one thread, and sign-in now counts the attempt before
  the first `await`, so cleanup and counting can't interleave.

## 4. Changed files

| File | Change |
|------|--------|
| `server/src/auth.ts` | Email+address and per-email limits; limiter key cap, per-key cap, ordered expiry, `forgive`; `sessions.prune()` |
| `server/src/app.ts` | Sign-in uses three keys and counts before the password check; Permissions-Policy and HSTS; prune at start; admin settings field `max_failures_per_email` |
| `server/src/index.ts` | Prints the audit log entry count at start |
| `client/src/security-headers.ts` | Permissions-Policy on the page |
| `client/src/Admin.tsx` | Settings lists both per-account sign-in limits |
| `README.md` | Sign-in limits, headers, session cleanup, audit archiving |
| `server/src/app.test.ts`, `server/src/auth.test.ts`, `client/src/security-headers.test.ts`, `client/src/ui.test.ts` | Tests |

10 files, 247 lines added, 27 removed. No dependency, schema, PayPal or Gemini code changed.

## 5. Tests and results

All tests use synthetic data, in-memory databases and mocked PayPal and Gemini. No network calls.

| Check | Result |
|-------|--------|
| Server tests | **202/202 pass** (193 before, 9 new) |
| Client tests | **86/86 pass** (2 assertions added to existing tests) |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build | Pass (existing chunk-size warning only) |
| Secret scan of the diff | No matches |

New tests:

| Area | Test |
|------|------|
| L1 | One client's failures lock only that client out of the account; failures from 5 addresses lock the account |
| L1 | A locked unknown email answers exactly like a locked real account |
| L1 | Simultaneous sign-ins can't get past the limit (10 checked, 5 refused) |
| L1 | 55 correct sign-ins in a row are never locked (the owner's own sign-ins don't use up the limits) |
| L3 | API sends Permissions-Policy always; HSTS only over HTTPS through a trusted proxy; not from a spoofed header |
| L3 | Page headers (dev and preview) include Permissions-Policy and no HSTS |
| L4 | Start-up prune removes signed-out and idle sessions, keeps the live one working |
| L5 | 5,000 distinct keys with a cap of 100: size never exceeds 100, newest and active keys kept |
| L5 | Expired keys dropped without touching live ones; a key holds at most 100 timestamps |
| L5 | `forgive` takes back one failure |

**Live check.** A separate server instance ran on port 3999 against a throwaway database in the scratchpad (the demo
database was not touched): Permissions-Policy present, no HSTS on HTTP even with `X-Forwarded-Proto: https`, and the
startup line printed the audit count. The running demo server on port 3001 was **not** restarted, because its start-up
prune would change the demo database; restart it to pick up the changes.

## 6. Regression results

Covered by the existing suites, all passing:

| Area | Evidence |
|------|----------|
| Merchant and buyer journeys | Analysis, drafts, edit check, buyer list and explanations, Insights tests |
| Role and account isolation | Role table, other-account 404, admin read-only, buyer 403 on Insights |
| Logout and session expiry | Session idle/absolute, sign-out, restart-keeps-session tests |
| Existing sign-in limits | 10-failure lock, 100-per-address lock, trusted-proxy test from Phase 6.4 |
| PayPal read-only boundary | Mocked PayPal tests: token + GET only, failures without secrets |
| Gemini server-side boundary and fallback | Mocked Gemini tests, per-account AI limit and fallback wording |
| Security headers and CSP | `security-headers.test.ts`, API header tests |

The UI was not re-checked in a browser (signing in to the demo would touch the demo database); the changed admin
settings text is covered by the render test.

## 7. Security trade-offs

- **L1:** a determined attacker with 5 or more addresses (behind a trusted proxy) can still lock one email for 15
  minutes. That is the price of keeping a hard per-email cap against distributed brute force. Locally, with one
  address, behaviour is the same as before.
- **L1:** a correct password removes only its own count from the per-email and per-address keys; it does not wipe
  failures others caused, so an attacker's progress toward the per-email cap is not reset by the owner signing in.
- **L5:** at the 10,000-key cap the least recently failed key is forgotten. An attacker who can create over 10,000
  fresh keys inside 15 minutes could push out an idle counter. Each failed attempt adds at most 3 keys and each address
  is capped at 100 failures, so this needs dozens of addresses behind a trusted proxy. Active (recently failing) keys
  are kept longest.
- **L4:** keeping the audit log append-only preserves its value as evidence but means it can only be bounded by
  archiving the whole database.
- **L3:** HSTS without `includeSubDomains` protects only the API host; the deployer should add it at the HTTPS
  terminator for the page.

## 8. Remaining risks

| Risk | Severity | Note |
|------|----------|------|
| Audit log grows without limit | Low | By design (append-only). Count printed at start; archive by copying the file. A retention migration remains an option if approved. |
| Limits are in memory, one process | Low | A restart lifts lockouts; more than one process would need a shared store. Unchanged, documented. |
| Distributed lockout of one email | Low | Needs 5+ addresses through a trusted proxy. |
| Page HSTS | Info | Must be set on the HTTPS server in front of the page at deployment. |
| Running demo server uses old code | Info | Restart it to apply. |

## 9. Verdict

**PASS.** L1, L3 and L5 are resolved, and L4 is resolved for sessions. The audit log stays append-only by the user's
decision, with its growth now visible and archiving documented. All server and client tests, typechecks and the
production build pass. No live PayPal or Gemini calls were made, no secrets were exposed, no dependencies or schema
were changed, and nothing was committed or pushed.
