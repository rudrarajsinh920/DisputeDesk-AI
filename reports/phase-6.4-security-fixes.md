# DisputeDesk AI — Phase 6.4: Security Fixes (M1, L2)

Date: 2026-11-07
Commit: `c4d24b8` on `master` (local, not pushed)
Follows: `reports/phase-6.3-security-audit.md` (verdict CONDITIONAL PASS). That report is left unchanged.

## Summary

| ID | Severity | Finding (from 6.3) | Status |
|----|----------|--------------------|--------|
| M1 | Medium | One per-address sign-in cap shared by every client behind the same address | Fixed (configurable) |
| L2 | Low | No per-account limit on Gemini calls | Fixed |

Earlier fixes from Phase 6.2 (L1 draft length limit, L3 one-line database error) are in commit `8efebc0`.

## M1: shared sign-in cap

**Problem.** The sign-in limiter blocks an address after 100 failures in 15 minutes. Behind a reverse proxy every
request comes from the proxy's address, so one client guessing passwords locked out every other user.

**Fix.**
- New setting `TRUST_PROXY` (shell variable or `.env`), a whole number from 0 to 10. Default `0`.
- When above 0, Express `trust proxy` is set to that number of hops, so the limiter counts the real client address
  from `X-Forwarded-For`.
- Invalid values (`-1`, `11`, `1.5`, `yes`) stop startup with a plain error.
- README explains: leave it at 0 unless a proxy you control adds `X-Forwarded-For`. Otherwise a client could choose
  its own address with that header and dodge the limit.

**Still true.** Locally every request comes from 127.0.0.1 and the server listens on 127.0.0.1 only, so the shared
cap remains. Only processes on the same machine can trigger it. The per-email cap (10 failures) is unchanged.

**Files.** `server/src/config.ts`, `server/src/index.ts`, `server/src/app.ts`, `README.md`.

## L2: no limit on Gemini calls

**Problem.** A signed-in account could make unlimited Gemini calls (the audit made 25 in a row), with cost and quota
impact.

**Fix.**
- `AI_MAX_CALLS = 20` Gemini calls per account per 15-minute window, shared by AI drafts, buyer explanations and
  Insights explanations. Counted only when a call would actually go to Gemini.
- Past the limit:
  - `POST /api/analysis/ai` answers `429 ai_limit_reached` with `Retry-After: 900` and a plain message. The
    rule-based draft still works.
  - Buyer and Insights explanations return the standard rule-based wording, with the note "Your account has reached
    its limit of AI wording for now…". This reuses the existing "AI off or failing" path, so no client change was
    needed.
- Each account has its own allowance. It comes back after the window ends.

**Files.** `server/src/app.ts`, `server/src/buyer.ts`, `README.md`.

## Tests

All run with synthetic data and mocked PayPal and Gemini. No network calls.

| Suite | Result |
|-------|--------|
| Server (`npm test`) | 193/193 pass (4 new) |
| Client (`npm test`) | 86/86 pass |
| Typecheck, server and client | Pass |
| Client build | Pass |

New tests:
1. `TRUST_PROXY` parsing: defaults to 0, rejects out-of-range and non-integer values.
2. Trusted proxy: with `trustProxy: 1`, 100 failures from one client give 429 for that client, while a second
   client signs in with 200. Without the setting, `X-Forwarded-For` is ignored and both are blocked.
3. Per-account AI limit: 20 drafts give 200, the 21st gives 429 with `Retry-After: 900`; Gemini receives only 20
   calls; the rule-based analysis still works; another account is unaffected; the allowance returns after the window.
4. Fallback: past the limit, buyer and Insights explanations come back as rule-based wording with the limit note.

The running local server was restarted after the change and started cleanly.

## Safety

- No live PayPal or Gemini calls.
- `.env` not read into output or edited. No secrets in the commit (staged diff scanned).
- PayPal sandbox scripts and demo data unchanged.
- No dependencies added.
- Nothing pushed.

## Open items from Phase 6.3

| ID | Item | Status |
|----|------|--------|
| L1 | Targeted lockout of one account through the per-email cap | Open (accepted for demo) |
| L3 | No HSTS or Permissions-Policy header | Open |
| L4 | Audit log and session table grow without limit | Open |
| L5 | Sign-in and AI limiter memory is unbounded | Open (also applies to the new AI limiter) |
| I1–I10 | Informational | No action |

## Verdict

M1 and L2 are resolved. No Medium or higher findings remain open. The remaining Low items do not block the demo.
