# DisputeDesk AI — Phase 6.5: Final Security Verification

Date: 2026-11-07
Scope: verify the Phase 6.4.1 hardening (L1, L3, L4, L5), run full regression, and set a documented baseline.
No code, schema, demo data or dependency was changed in this phase. Nothing was committed, pushed or deployed.

## 1. Git baseline and outstanding changes

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD | `44dcf68` "Harden sign-in lockout, headers, session cleanup and limiter memory" |
| Previous | `c4d24b8` (Phase 6.4), `8efebc0` (Phase 6.2 fixes) |
| Ahead of origin | 5 commits, not pushed |
| Tracked changes | None |
| Stashes | None |
| Untracked | `reports/` only (all earlier reports preserved, none overwritten) |

**Correction to the phase brief.** The brief says the Phase 6.4.1 changes are in the working tree and not committed.
They were committed locally as `44dcf68` at the user's request after Phase 6.4.1. This phase verified that commit.

## 2. Method and data safety

- **Demo database** `server/data/disputedesk.sqlite`: the running demo server was stopped, and the database and its
  WAL files were copied to a scratch backup (`sha256` prefix `acf813bfe555bc2e`, identical to the original). Only
  read-only counts were taken from it.
- The demo server was restarted **once** on the real database, to confirm the path and the start-up session prune.
- Every sign-in, journey and lockout check ran against an **isolated server** on port 3001 with a throwaway database
  in the scratchpad. The demo database got no new sessions or audit rows from verification.
- **No live Gemini calls.** No AI button was pressed and no AI route was called except as admin, which is refused
  before Gemini.
- **No live PayPal calls.** No sandbox route was called with an account that has sandbox access; the browser's
  network log shows no `/api/sandbox/*` request.
- Demo passwords were read from `README.md` by a probe script that prints only pass/fail. No password, token or
  `.env` value appears in output or in this report.

| Demo database | Before | After restart | After all verification |
|---------------|--------|---------------|------------------------|
| Sessions (total / live / signed out) | 1 / 0 / 1 | 0 / 0 / 0 | 0 / 0 / 0 |
| Audit log rows | 594 | 594 | 594 |
| Accounts / disputes | 6 / 17 | 6 / 17 | 6 / 17 |
| Schema version | 3 | 3 | 3 |

The demo server is running again on the real database with the 6.4.1 code. It prints:
`Audit log: 594 entries in C:\Users\Admin\disputedesk-test\server\data\disputedesk.sqlite.`

## 3. Verification results

### 3.1 Implementation review (L1, L3, L4, L5)

| Finding | Where | Confirmed |
|---------|-------|-----------|
| L1 targeted lockout | `auth.ts` limits (10 email+address, 50 email, 100 address); `app.ts` sign-in counts before the password check, `forgive` on success | Yes |
| L3 headers | `app.ts` `PERMISSIONS_POLICY`, `HSTS` only when `req.secure`; `security-headers.ts` Permissions-Policy on page | Yes |
| L4 growth | `sessions.prune()` at start and at sign-in; audit log append-only, count printed at start | Yes |
| L5 limiter memory | `LIMITER_MAX_KEYS` 10,000, 100 timestamps per key, ordered expiry from the front | Yes |

### 3.2 Live checks on the isolated server

Probe script, 46 checks in total, **46 passed**.

**Sign-in protections (6/6)**

| Check | Result |
|-------|--------|
| 10 wrong passwords lock email+address; the right password is then refused (429) | PASS |
| Another account on the same address still signs in | PASS |
| A locked unknown email returns the same status and the same body as a locked real account | PASS |
| 15 simultaneous wrong attempts: exactly 10 checked (401), 5 refused (429) | PASS |

**Headers (4 checks)**

| Check | Result |
|-------|--------|
| API sends `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` | PASS (also on the real demo server) |
| No `Strict-Transport-Security` on local HTTP | PASS |
| A spoofed `X-Forwarded-Proto: https` without `TRUST_PROXY` gives no HSTS | PASS |
| API CSP is `default-src 'none'; frame-ancestors 'none'` | PASS |

HSTS **with** a trusted proxy over HTTPS is covered by the automated test (no proxy was set up live).

**Session pruning**

| Check | Result |
|-------|--------|
| Real demo DB: the signed-out session was removed at start, no live session lost | PASS (1 → 0, live 0 → 0) |
| Isolated DB: 6 live sessions before restart, 6 after | PASS |
| A session signed in before the restart still works after it | PASS |
| Sign-out ends the session (`/api/auth/me` then 401) | PASS |

**Limiter memory and expiry.** Checked by the automated tests (5,000 keys against a cap of 100, expiry from the
front, per-key bound, `forgive`). A live high-cardinality flood was not run: it would only repeat those tests
against the same code.

**Authorization and roles (24 checks, all PASS)**

- All 6 demo accounts sign in; `/api/auth/me` returns no password hash.
- Merchant A analyses its own DEMO-1001; Merchant B checks its own DEMO-1003 draft; Merchant C reads Insights.
- Merchant B → DEMO-1001 and Merchant A → DEMO-1003 answer **404**, with the same body as a dispute that doesn't exist.
- Buyer A's list holds DEMO-1001 only, with no evidence, order or customer message fields.
- Buyer → merchant analysis, Insights and admin pages: **403**.
- Admin reads settings, audit and any dispute's analysis; admin AI draft and edit check: **403** (read-only).
- Merchant → admin accounts: **403**.
- A cross-site write (`Origin: https://evil.example`) is refused: **403**.
- Admin settings report `max_failures_per_email: 50`.

**Boundaries**

| Boundary | Evidence |
|----------|----------|
| PayPal read-only | Merchant B (no sandbox access) refused on sandbox list and sandbox analysis before PayPal is contacted; `/api/health` holds no credentials; mocked PayPal tests confirm token + GET only |
| Gemini server-side | Admin AI draft refused before any call; browser never received a key or called Gemini; mocked Gemini tests cover checks, per-account limit and fallback wording |

### 3.3 Browser checks (isolated server, client dev server)

| Journey | Result |
|---------|--------|
| Admin › Admin settings | Shows "Failures per account from one address 10 in 15 minutes", "from all addresses 50 in 15 minutes", "Failures per address 100 in 15 minutes"; every card marked Read-only |
| Merchant B | Disputes list with 1 dispute (DEMO-1003), rule-based analysis and readiness loaded |
| Buyer A | Disputes list with DEMO-1001 only, plain-language status, stages and next steps; no merchant records |
| Network | Only `/api/auth/*`, `/api/disputes`, `/api/health`, `/api/admin/*`, `/api/analysis`, `/api/buyer/disputes`. No sandbox, AI or explanation calls |
| Console | One 401 from the signed-out session check on first load (expected) |

Screenshots were taken in the browser pane during the session. They are not saved as files in the project.

**Visual defect found (pre-existing, not fixed).** At 1024 px wide, Admin settings › Sessions › Cookie shows
"HttpOnly, Secure, SameSite=Strict" spilling about 53 px past the card. The `<dd>` is 59 px wide but its content needs
112 px, because "SameSite=Strict" has no break point. It is fine at 1440 px and at 375 px, with no horizontal page
scroll. This row was not changed in 6.4.1. Fix: allow the value to wrap (`overflow-wrap: anywhere` on that cell) or
widen the value column.

### 3.4 Automated tests, typechecks and build

| Check | Result |
|-------|--------|
| Server tests | **202/202 pass** |
| Client tests | **86/86 pass** |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build | Pass (existing chunk-size warning only) |

## 4. Remaining security risks

| Risk | Severity | Note |
|------|----------|------|
| Audit log grows without limit | Low | Append-only by decision; count printed at start; archive by copying the file |
| Limits held in memory, one process | Low | A restart lifts lockouts; more processes would need a shared store |
| Distributed lockout of one email | Low | Needs 5+ addresses through a trusted proxy |
| Limiter eviction at 10,000 keys | Low | An idle counter can be pushed out by a large distributed flood; active keys kept longest |
| HSTS for the page | Info | Must be set on the HTTPS server in front of the page at deployment |
| Localhost-only by design | Info | Production deployment (HTTPS, proxy, `TRUST_PROXY`) is not set up or tested |

No Medium or higher findings are open.

## 5. Items not tested

- HSTS through a real HTTPS proxy (covered only by the automated test with `trustProxy: 1`).
- A live 100-failure per-address lock and a live 10,000-key limiter flood (covered by automated tests).
- Live PayPal sandbox and live Gemini paths (not allowed in this phase; mocked tests only).
- Merchant A and admin views of the PayPal sandbox tab (would make a live PayPal call).
- AI draft, buyer and Insights AI explanations in the browser (would call Gemini).
- Production preview build (`npm run preview`) in the browser; the build itself passed.

## 6. Verdict

**PASS.**

The Phase 6.4.1 changes are present and behave as designed, live and in tests. Account isolation, roles, sign-out,
session persistence and the PayPal and Gemini boundaries hold. All tests, typechecks and the build pass, and the demo
database is intact. The one defect found is a cosmetic overflow on the Admin settings page at about 1024 px, which
predates 6.4.1 and has no security effect.

**Ready to begin Evidence Provenance: yes.** The baseline is commit `44dcf68` with a clean tracked tree. Suggested
before or alongside that work: fix the Admin settings Cookie overflow, and push the five local commits when you are
ready.
