# DisputeDesk AI — Phase 0.2: Final UX and Evidence Validation

The evidence intelligence layer for payment disputes.

- Audit date: Nov 6, 2026
- Baseline audited: `f08ba14` (P1) on `master`, with P0 at `7ba49a1`
- Fixes applied after approval: `4346fd0` (local commit, not pushed)
- No live PayPal or Gemini calls were made. No tools were installed. Nothing was pushed or deployed.

## Summary

| Area | Result |
|---|---|
| Git baseline | PASS |
| Tests, typecheck, build | PASS |
| Visual QA (scripted layout, contrast, overflow) | PASS |
| Visual QA (screenshots, by eye) | NOT TESTED |
| Responsive QA | PASS (was FAIL for admin at 320px, fixed in `4346fd0`) |
| Evidence engine | PASS (two coverage gaps, closed in `4346fd0`) |
| Security and privacy | PASS |
| Critical defects | None |
| Phase 6 readiness | Ready |

## 1. Git baseline

| Check | Result |
|---|---|
| Branch | `master`, in sync with `origin/master` before the fix commit |
| HEAD at audit | `f08ba14` Check merchant edits, add refund guidance and list readiness counts |
| P0 commit `7ba49a1` in history | PASS |
| P1 commit `f08ba14` in history | PASS |
| Stashes | None |
| Untracked files preserved | PASS: `reports/demo-video-script.md`, `reports/devpost-description.md`, `reports/disputedesk-audit.pdf` |
| Working tree after the audit | Unchanged |

Test runs (all run in this session):

| Run | At audit (`f08ba14`) | After fixes (`4346fd0`) |
|---|---|---|
| Server tests | 187 of 187 PASS | 189 of 189 PASS |
| Client tests | 85 of 85 PASS | 85 of 85 PASS |
| Server typecheck | PASS | PASS |
| Client typecheck | PASS | PASS |
| Production build | PASS | PASS |

## 2. Visual QA by module and theme

Method: the app ran locally on demo data (the data source stayed on demo, so PayPal was never contacted, and no AI button
was clicked). Each screen was checked by script for page overflow, elements past the screen edge, text contrast against
WCAG AA (4.5:1, or 3:1 for large text), text under 12px and tap targets under 24px. Screenshots could not be taken
because the Claude window was minimized, so no one has looked at the screens by eye in this audit.

### Merchant (Demo Merchant A, Demo Merchant C)

| Feature | Light | Dark | Notes |
|---|---|---|---|
| Evidence readiness summary | PASS | PASS | "Key evidence on record 0 of 2", "Not a score" note shown |
| Claim and records | PASS | PASS | Buyer's claim beside what the records show and leave out |
| Evidence analysis | PASS | PASS | Statuses, key labels and record citations shown |
| Response draft | PASS | PASS | Marker count, review notice, never sent to PayPal |
| Check my edits | PASS | PASS | Flagged an invented tracking number, date, carrier and signature claim |
| AI-assisted draft | NOT TESTED | NOT TESTED | Gemini is on for this server; not clicked to avoid a live call |
| Dispute-list readiness | PASS | PASS | e.g. "Key evidence 1 of 2 · 1 conflict" |
| Insights | PASS | PASS | Counts and dispute IDs only; new limitation line present |

### Buyer (Demo Buyer B)

| Feature | Light | Dark | Notes |
|---|---|---|---|
| Dashboard and list | PASS | PASS | Two disputes, usual stage per row |
| Dispute details | PASS | PASS | Source key: from the record, general guidance, not on record |
| Timeline and next steps | PASS | PASS | Only the opened date comes from the record |
| Privacy boundaries | PASS | PASS | No order, tracking, evidence or buyer-message fields on screen or in the API reply |

### Admin (Demo Admin)

| View | Light | Dark | Notes |
|---|---|---|---|
| Overview | PASS | PASS | Read-only label shown |
| Disputes | PASS | PASS | Owner shown per row |
| Insights | PASS | PASS | All merchants, no AI summary |
| Merchants and Buyers | PASS | PASS | No password hashes |
| Audit logs | PASS | PASS | No secrets in entries |
| System health | PASS | PASS | Says it does not contact PayPal or Gemini |
| Admin settings | PASS | PASS | Read-only limits |
| Account | PASS | PASS | |

### States

| State | Result | Notes |
|---|---|---|
| Loading, empty, error | PASS (unit tests only) | Covered by client tests; not opened in the browser |

## 3. Responsive QA

| Width | Merchant | Buyer | Admin |
|---|---|---|---|
| 1440 desktop | PASS | PASS | PASS |
| 1024 | PASS | PASS | PASS |
| 768 tablet | PASS | PASS | PASS |
| 375 mobile | PASS | PASS | PASS |
| 320 mobile | PASS | PASS | FAIL at audit, PASS after `4346fd0` |

- No low contrast, no small tap targets, no horizontal page scroll (after the fix).
- Sidebar group labels ("Workspace", "You", "Data source") are 11px. Readability note only.
- A dark-mode contrast failure appeared once and was false: a 150 ms colour transition had frozen in the hidden page.
  After a reload, dark mode passed everywhere.

## 4. Evidence engine validation

| Check | Result | Where it is tested |
|---|---|---|
| Missing evidence | PASS | `evidence.test.ts`: missing is never proof that something did not happen |
| Available evidence | PASS | `evidence.test.ts` |
| Conflicting evidence | PASS | `evidence.test.ts`: contradictions name the records involved |
| Unverified evidence | PASS | `evidence.test.ts`: tracking needs both the flag and a number |
| Refund ID guidance | PASS | `evidence.test.ts`, `assist.test.ts` |
| Evidence citations | PASS | `assertFactsComeFromRecords` in `evidence.test.ts` |
| Merchant-edited draft validation | PASS | `app.test.ts`; checked in the browser |
| AI-off fallback | PASS | `app.test.ts`: "AI drafting without a key is 503", "with AI off for any reason…" |

### Coverage gaps found, and closed in `4346fd0`

| Gap | Fix |
|---|---|
| No test where every key evidence item is available | New test with a synthetic, test-only fixture: all flags true, a tracking number on record, order delivered. For item not received, not as described and unauthorized it checks: every item available, no gaps or conflicts, no "Find or confirm" step, readiness count full, review notice still present. No demo file changed. |
| Four reasons had no test: `INCORRECT_AMOUNT`, `PAYMENT_BY_OTHER_MEANS`, `CANCELED_RECURRING_BILLING`, `PROBLEM_WITH_REMITTANCE` | New test: each gets the generic "state your position" request, no key evidence and no refund step. |

## 5. Privacy and security regression

Checked against the running server with synthetic demo accounts, plus the existing test suite.

| Check | Result | Evidence |
|---|---|---|
| Merchant tenant isolation | PASS | Merchant B lists only DEMO-1003 |
| Cross-account 404 | PASS | Merchant B asking for DEMO-1001 gets 404, same as a missing ID (analysis and edit check) |
| Buyer field restrictions | PASS | Buyer reply has only status, amount, reason, opened date and guidance |
| Buyer blocked from merchant and admin routes | PASS | 403 on disputes, analysis, edit check, insights and audit |
| Admin read-only | PASS | 403 on Check my edits and on AI wording |
| Check my edits authorization | PASS | Merchant only; text over 8,000 characters gets 400 |
| No merchant-only evidence exposed | PASS | Not on buyer screens or in buyer API replies |
| No new secrets or storage | PASS | No schema change in P1; browser stores nothing; no secret files tracked; admin views show no hashes |
| Every route has a role | PASS | All routes use `requireRole`; the role-table test fails on a missing route |
| PayPal read-only | PASS | Only token POST and GETs (tested); no live call in this audit |

## 6. Defects

### Critical

None.

### Non-critical

| # | Defect | Status |
|---|---|---|
| 1 | Admin sidebar menu did not wrap, so admin pages were 370px wide at 320px and scrolled sideways | Fixed in `4346fd0` |
| 2 | Credit-not-processed rows read "Evidence 4 of 4", which looks complete while the refund ID is still a gap | Fixed in `4346fd0` |
| 3 | Check my edits says "Paragraph 8", counting the whole draft, and some reasons read technically | Open, polish |
| 4 | Sidebar group labels are 11px | Open, readability note |

## 7. Fixes applied (`4346fd0`)

1. `client/src/styles.css`: `flex-wrap: wrap` on `.rail-nav`. Admin is exactly 320px wide at 320px in the browser.
2. `server/src/evidence.test.ts`: the two new tests above.
3. List readiness: refund-reason rows add "· refund ID needed" (DEMO-2004 now reads "Evidence 4 of 4 · refund ID
   needed"). The two reasons are listed once, in `shared/disputes.ts` as `REFUND_ID_REASONS`; the evidence test loops
   over that list, so the rules and the list cannot drift apart without a failing test.

## 8. Readiness for Phase 6

Ready. No critical defects remain, and every security and privacy check passes.

Before recording the demo video, bring the Claude window to the front so each screen can be screenshotted and checked by
eye. This is the one part of the audit that could not be done.
