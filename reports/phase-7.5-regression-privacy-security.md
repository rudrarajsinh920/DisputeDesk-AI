# DisputeDesk AI — Phase 7.5: Regression, Privacy and Security Verification

Date: 2026-11-07
Baseline: Phases 7.2–7.4 (provenance model, API, merchant interface), all uncommitted.
State: verification only, plus one strengthened test. **Not committed, not pushed, not deployed.**

## 1. Scope (from the Phase 7.1 plan, §10)

Full suites, typechecks and build; a live probe on an isolated server (roles, 404s, buyer projection, Origin guard);
proof that no PayPal or Gemini call is made; a copy and claims review for wording that implies document inspection.

## 2. Suites, typechecks, build

| Check | Result |
|-------|--------|
| Server tests | **222/222 pass** |
| Client tests | **91/91 pass** (one existing test strengthened, §6) |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build | Pass (the existing over-500 kB chunk warning only) |

## 3. Live probe (isolated server)

A scratch script (in the session scratchpad, outside the project) started the real `createApp` over real HTTP on
`127.0.0.1` with a **scratch SQLite file** and **no PayPal or Gemini client**. Before the app loaded, `fetch`,
`http.request` and `https.request` were wrapped so any request leaving the machine would be recorded and refused. The
accounts were the demo accounts with probe-only passwords; nothing from `.env` was read, and no demo password was used.
The scratch database was deleted afterwards. The real `server/data/disputedesk.sqlite` was not opened (hash unchanged).

**Result: 86/86 checks pass. Outbound requests: 0.**

### 3.1 Role table (status codes, real sign-in cookies)

| Route | Signed out | merchant-a | buyer-a | admin |
|---|---|---|---|---|
| GET /api/auth/me | 401 | 200 | 200 | 200 |
| GET /api/disputes | 401 | 200 | 403 | 200 |
| GET /api/buyer/disputes | 401 | 403 | 200 | 403 |
| POST /api/buyer/explain | 401 | 403 | 200 | 403 |
| GET /api/intelligence | 401 | 200 | 403 | 200 |
| POST /api/intelligence/explain | 401 | 200 | 403 | 403 |
| GET /api/admin/accounts | 401 | 403 | 403 | 200 |
| GET /api/admin/audit | 401 | 403 | 403 | 200 |
| GET /api/admin/settings | 401 | 403 | 403 | 200 |
| GET /api/health | 401 | 200 | 403 | 200 |
| GET /api/sandbox/disputes | 401 | 503 | 403 | 503 |
| POST /api/analysis | 401 | 200 | 403 | 200 |
| POST /api/analysis/ai | 401 | 503 | 403 | 403 |
| POST /api/analysis/ai/example | 401 | 200 | 403 | 200 |
| POST /api/analysis/check | 401 | 200 | 403 | 403 |

Every cell matches `requireRole` in `app.ts`. 503 on sandbox and `/ai` is "not configured", because the probe passed no
client. Admin is refused on every write-like merchant action (`/ai`, `/check`, `/intelligence/explain`).

### 3.2 Other checks

| Area | Check | Result |
|------|-------|--------|
| 404 parity | Another account's dispute answers 404 with a body byte-identical to a missing ID, on `/api/analysis`, `/ai/example`, `/check` and `/api/buyer/explain` | Pass |
| Audit | Those cross-account attempts are audited as `dispute_access_denied` | Pass |
| Buyer projection | Buyer list and explanation (buyer-a, buyer-b): no `evidence`, `order`, `customer_message`, `draft`, `provenance`, `refs`, `ref`, `claims`, `contradictions` or `records` key; no `demo:`/`paypal_sandbox:` ref or order ID in the body; each record has only `source`, `dispute_id`, `reason`, `status`, `amount`, `create_time`, `guidance` | Pass |
| Insights | No provenance key or ref string | Pass |
| Merchant provenance | `/api/analysis` returns `provenance` and `refs` on every draft line; DEMO-1002 shows a `conflicting` ref; admin reads provenance | Pass |
| Claims | `/check` returns one claim per paragraph; "We refunded the payment." is `unsupported` | Pass |
| Credentials | No `access_token`, `client_secret`, `apiKey`, `password_hash` or `token_hash` in any merchant response | Pass |
| Origin guard | On `/api/analysis`, `/check` and `/ai/example`: a foreign Origin, `Origin: null`, `Sec-Fetch-Site: cross-site` and `same-site` all get 403 `forbidden_origin`; a same-origin request passes | Pass |
| Host guard | `Host: evil.example` gets 403 (DNS rebinding) | Pass |
| Headers | `/api/analysis` sends `nosniff`, a CSP and frame protection | Pass |
| Edit check | Writes no audit row; a sentinel string in the checked text never reaches the audit log | Pass |
| Audit log | Holds no password or token; `UPDATE` and `DELETE` are refused (append-only triggers) | Pass |
| Network | No outbound request of any kind | Pass |

Two probe checks failed on the first run, and both were mistakes in the probe, not in the app. The buyer guidance has
its own `next_steps`, and some buyer records carry `create_time` (the opened date). Both are buyer-visible by design
(`buyer.ts`). The probe now checks these by path and with an allowlist, and passes.

## 4. No PayPal or Gemini calls

- The live probe made **0 outbound requests** (wrapped `fetch`, `http` and `https`).
- The suites use mocked PayPal and Gemini only (unchanged rule; route tests assert the Gemini request body carries no ref,
  dispute ID or order ID).
- No AI draft, validation example or sandbox action was triggered in any browser during 7.3–7.5.

## 5. Copy and claims review

Reviewed every user-visible string added in 7.3–7.4 (`AnalysisPanel.tsx`, `provenance.ts`, the claim reasons in
`assist.ts`) and searched the other screens for "verify", "inspect", "proof" and "prove".

| Wording | Finding |
|---------|---------|
| "Verified against record" | Always shown under the note "DisputeDesk does not inspect the documents themselves", plus the definition "the supplied record backs it and nothing in the records contradicts it". Never shortened to "Verified". |
| Unverified and missing items | No extra tag; the status badge already says it (the 7.4 browser fix). |
| Claim labels | "Backed by DisputeDesk's records", "Not in DisputeDesk's records", "Check against your records", "No factual claim found". None says true, false, proven or verified. |
| Unsupported reasons | Begin "No supporting record in DisputeDesk", and say what is missing: "DisputeDesk holds no refund records", "DisputeDesk can't tell who wrote them". |
| Sandbox derivations | They say what set the flag, for example "a transaction record, not an order confirmation document". |
| "Document" and "Refund record" source labels | These exist in the label table, but no ref ever uses them (tested in 7.4). |
| Other screens | The landing page says "Know what you can prove before you reply" (about the merchant's records) and "A missing record is never treated as proof that something didn't happen". Neither claims inspection. |

**No change needed.**

## 6. Test gap closed

Plan §9 asked for a UI test showing that buyer screens render no provenance. The existing buyer test (`ui.test.ts`, "buyers
see their own disputes … nothing of the merchant's") now also asserts that the buyer screen has no "Verified against
record", "Conflicting", "No time on record", "Sources for the generated draft", "DisputeDesk's records" or `demo:` text,
and no `ref-list`, `draft-sources`, `tag-v-` or `tag-claim-` markup. Test count unchanged (91), and it passes.

## 7. Repository hygiene

| Item | Result |
|------|--------|
| Secret scan of the working diff and the new source files | No key, token or private-key pattern |
| `.env` | Ignored by git, not tracked, not read by the probe, not edited |
| Database, credential or env files pending | None |
| PayPal sandbox scripts and `sample-dispute.json` | Unchanged (single object) |
| Migrations | None added; released v1–v3 untouched |
| Dependencies | None added |
| `.claude/launch.json` | Unchanged |

Pending (uncommitted) changes: `client/src/AnalysisPanel.tsx`, `Landing.tsx`, `styles.css`, `ui.test.ts`;
`server/src/app.ts`, `app.test.ts`, `assist.ts`; `shared/types.ts`; untracked `server/src/provenance.ts`,
`provenance.test.ts`, `claims.test.ts` and the reports. `Landing.tsx` and part of `styles.css` are earlier UI fixes from
before Phase 7.

## 8. Known limitations

- The probe ran with no PayPal or Gemini client, so the 200 paths of `/api/analysis/ai` and the sandbox list were not
  exercised live. They are covered by the mocked route tests, and running them live would need approval.
- Claim detection stays heuristic and advisory (7.3 report §9).
- The browser check is from Phase 7.4; 7.5 changed no UI code, so it was not repeated.

## 9. Verdict

**PASS.** All suites, typechecks and the build pass. The live probe passes 86/86 with zero outbound requests: role
table, 404 parity, buyer projection, Origin and Host guards, headers and the audit log. The copy review found no wording
that implies document inspection. Phase 7 (7.2–7.5) is ready to commit when you approve it. Nothing has been committed
or pushed.
