# DisputeDesk AI: Stage 3.2 Release Audit (merchant document upload)

**Date:** 2026-11-09
**Scope:** every Phase 3.2 change, `7c2bed2..92d3196` (14 files, +1471 / −14).
**Type:** read-only. No source file was changed, nothing was installed, migration v5 was not run on the real database, no document was uploaded, and PayPal and Gemini were not called. Nothing was committed or pushed.

**Base correction:** the audit request says the changes are uncommitted on `7c2bed2`. They were committed as `92d3196` ("Add Stage 3.2 merchant document upload and the Stage 3 reports") before this audit started. The audited diff is the same.

## 1. Verdict

**Ready for Phase 3.3 once three small fixes and one backup are done.** There are no critical findings.

- **Three medium findings:**
  - M1: one AI-check message now says something untrue.
  - M2: the "documents change nothing" test is narrower than its title.
  - M3: the database itself doesn't enforce document ownership.
- **Backup:** the real database is still v4 and has no v4 backup. The next start of this code upgrades it.

## 2. Results by area

| # | Area | Result |
|---|------|--------|
| 1 | Git diff and new files | PASS |
| 2 | Migration v5 and the append-only audit log | PASS |
| 3 | Upload route order and body-size limit | PASS (low notes L1, L2) |
| 4 | File signature and declared type | PASS (note for 3.4: L6) |
| 5 | Account ownership and isolation between accounts | NEEDS ATTENTION (M3) |
| 6 | Buyer and admin restrictions | PASS |
| 7 | Sandbox disputes kept out | PASS |
| 8 | Upload rate and storage limits | PASS (low notes L2, L3) |
| 9 | Filename cleaning and response headers | PASS (low notes L4, L5) |
| 10 | Delete and cascade | PASS |
| 11 | Privacy, logging and audit data | PASS (low note L7) |
| 12 | No change to analysis, readiness, drafts, checklist, Insights or Gemini | NEEDS ATTENTION (M1, M2) |
| 13 | Browser accessibility and layout | PASS (from the 3.2 browser check; not re-run here) |

### Checks run in this audit

| Check | Result |
|-------|--------|
| Server tests | 259 run, 259 passed |
| Server typecheck | Exit 0 |
| Client tests | 108 run, 108 passed |
| Client typecheck | Exit 0 |
| Real database, opened read-only | `schema_migrations` max version 4, 602 audit rows, `integrity_check` ok, no document tables |

## 3. Area details

### 1. Git diff and new files: PASS
- **Changed files:** `server/src/{app,db,store,documents}.ts`, `shared/types.ts`, `client/src/{Documents.tsx,analysis.ts,AnalysisPanel.tsx,styles.css}`, three test files and two reports.
- **What is not in it:**
  - no `.env`, database file, credentials or dependency change;
  - no change to the PayPal sandbox scripts or the demo data files.
- A secret scan of the staged diff matched only report prose and a test filename.

### 2. Migration v5 and the audit log: PASS
- **Forward-only:** v5 is added at the end, and v1 to v4 are unchanged.
- **Tables:** `documents`, `document_blobs`, `document_pages` and `document_links` are all `STRICT`. Each has CHECK limits on type, size, name length, status, page and item ID.
- **Audit log:**
  - It is rebuilt with `rebuildAuditLog(V5_AUDIT_EVENTS)`, the same tested path as v2 to v4.
  - The rebuild keeps row IDs, indexes and the append-only triggers.
  - `store.test.ts` "upgrading a version 4 database…" shows that every audit row and confirmation survives, that the new events insert, and that UPDATE and DELETE are still refused.
- **Foreign keys:** `PRAGMA foreign_keys = ON` is set when the database opens (`db.ts:272`), so the cascades work.

### 3. Upload route order and body-size limit: PASS
The order in `app.ts`:
1. `requireRole("merchant")`
2. declared type on the allowlist (415)
3. per-merchant rate limit, counted before the body is read (429)
4. `express.raw({ limit: 5 MB })` (413)
5. empty body (400)
6. signature check (415)
7. `findDispute` (404)
8. `addDocument`, which checks the limits inside its transaction (409)

- **Before the body is read:** no one signed out, no buyer, no admin, and no request with a wrong declared type gets a body read.
- **Size limit:** body-parser refuses a `Content-Length` over 5 MB before reading. It also stops a chunked body as soon as it passes 5 MB.
- **Error format:** the error handler turns `entity.too.large` into a JSON 413 (`app.ts:694`).
- **Cross-site guard:** the global Origin and `Sec-Fetch-Site` guard runs before every route. A test covers it: "an upload from another site's page is refused before the file is stored".

### 4. File signature and declared type: PASS
- `sniffMediaType` checks the leading bytes: `%PDF-`, the 8-byte PNG signature, and `FF D8 FF`.
- The result must equal the declared type, so a ZIP or HTML file sent as a PDF is refused, and so is a PDF sent as a PNG.
- Signature checks only see the start of a file, so a polyglot file passes. That is harmless in 3.2 because nothing serves the bytes back. It matters for the 3.4 download route (L6).

### 5. Ownership and isolation: NEEDS ATTENTION (M3)
- **What the app enforces:**
  - `findDispute` runs `canAccess` before any read or write.
  - `deleteDocument` matches on `id AND account_id AND dispute_id`.
  - `listDocuments` joins `dispute_access` and filters by account for merchants.
  - Tests cover Merchant B by dispute and by document ID, Buyer A on a shared dispute, and admin writes. Each gets the same 404 or a 403.
- **What the database does not enforce:**
  - `documents` has foreign keys to `accounts` and to `disputes`, but not to `dispute_access`.
  - So a code bug could insert a document for an account that can't reach the dispute.
  - A composite foreign key with cascade would be wrong here: `seedDemo` deletes and re-grants each account's access rows on every start (`store.ts:50`), so it would wipe every document on restart. `gap_confirmations` follows the same pattern for the same reason. See M3 for the fix.

### 6. Buyer and admin restrictions: PASS
- **Role matrix in `app.test.ts`:**
  - list `[200, 200, 404, 403, 403]`
  - upload `[403, 201, 404, 403, 403]`
  - delete `[403, 404, 404, 403, 403]`
- **Admin read-only:** `/api/documents` is the only new route in `ADMIN_READ_ONLY_POSTS`, and the matrix test fails if admin gets a 200 on any other POST.
- **Route table:** the test compares registered routes to `PROTECTED` plus `PUBLIC_ROUTES` (`app.test.ts:1144`), so all three routes are included.
- **Buyer screens:** they never import the documents module (client test).

### 7. Sandbox disputes: PASS
- **List and delete:** refused with 409 when `source === "paypal_sandbox"`, before `findDispute` runs, so PayPal is never called.
- **Upload:** always looks up `source: "demo"`.
- **Database:** the `disputes` foreign key refuses any dispute it doesn't hold, and sandbox disputes are never stored there.
- A test covers each case with a mocked PayPal client that counts calls.

### 8. Upload rate and storage limits: PASS
- **Rate:** 20 attempts per merchant per 15 minutes.
  - The count is taken synchronously before `next()`, so even simultaneous requests can't buffer more than 20 × 5 MB per merchant per window.
  - `LOGIN_MAX_FAILURES_PER_ADDRESS` (100) keeps enough history for a limit of 20.
  - The key map is capped at `LIMITER_MAX_KEYS`.
- **Storage:**
  - 10 files per dispute, 50 MB per account, and no duplicate file on a dispute.
  - The limits are checked inside the insert transaction, and `UNIQUE (account_id, dispute_id, sha256)` backs up the duplicate check.
  - Only demo merchant accounts can upload, so total storage is at most the number of merchants × 50 MB.
- **Not covered:** no cap on all merchants' uploads at once (L2), and documents that become hidden still count against the account's quota (L3).

### 9. Filenames and response headers: PASS
- **Filename cleaning:** `cleanDocumentName` percent-decodes the name and falls back to "" on bad input. It NFC-normalises it, removes `Cc`, `Cf`, `Zl` and `Zp` characters, and replaces `/` and `\`. It then collapses spaces, cuts the name to 120 code points, and turns a name made only of dots into "document".
- **Display:** the name is shown as React text only, never in a header, URL or path. The HTML test confirms it is escaped.
- **Headers:** every response carries the API headers: `nosniff`, `X-Frame-Options: DENY`, `CSP default-src 'none'`, `CORP same-origin` and `no-referrer`. That includes the 413 and 415 errors.
- **Leaks:** responses never include bytes, `sha256` or a file path. `toDocument` returns metadata only.

### 10. Delete and cascade: PASS
- One transaction deletes the row and, if a row went, writes `document_deleted` with the ID only.
- The blob, pages and links cascade through `ON DELETE CASCADE` (tested).
- A demo dispute removed from the demo files takes its documents with it (tested).
- A second delete gets 404. An ID that isn't a lowercase UUID gets 400.

### 11. Privacy, logging and audit data: PASS
- **Audit:** `document_uploaded` and `document_deleted` hold the account, dispute and document ID. A test checks that the filename doesn't appear anywhere in `audit_log`.
- **Server logs:** nothing logs a request body or header. The only `console.*` calls in `server/src` are the Gemini and PayPal error codes, the generic "Unexpected server error: \<message\>", and the start-up lines.
- **Admin list:** shows `account_id`, as intended for read-only admin.

### 12. Evidence, drafts, Insights and Gemini unchanged: NEEDS ATTENTION
- **Code:** nothing outside the three document routes reads the document tables. A grep of `server/src` and `shared` finds them only in `store.ts` and `app.ts`. `evidence.ts`, `assist.ts`, `buyer.ts`, `intelligence.ts` and `shared/readiness.ts` never read documents.
- **Test gap (M2):** the regression test "documents change no evidence status, readiness, checklist or draft" compares only `/api/analysis`, `/api/analysis/checklist` and `/api/disputes`. It doesn't compare the draft or the request sent to (mocked) Gemini, and it doesn't compare Insights or the buyer view.
- **Wording (M1):** one draft-check message is no longer true now that files can be stored.

### 13. Browser accessibility and layout: PASS
This audit did not re-run the browser. The Phase 3.2 browser check on a scratch database found:
- no sideways scroll at 320px;
- 44px targets;
- a labelled file field with `accept`;
- errors in `role="alert"` linked by `aria-describedby`;
- an sr-only live status;
- focus moving to the section heading after a delete;
- a "Not verified" tag on every file.

The code review agrees: no inline styles, `aria-busy` on the section, the field disabled while saving or when full, and repeat clicks blocked by the `busy` ref.

## 4. Findings

### Critical
None.

### Medium

**M1. A draft-check message now says DisputeDesk holds no documents.**
- **Where:** `server/src/assist.ts:381` adds "…DisputeDesk holds no documents, so it can't back an attachment." when a draft mentions an attachment. The comment at `assist.ts:202` says the same.
- **Why it matters:** merchants can now store files, so the sentence is untrue in the product, which breaks the "never state untrue facts" rule.
- **Fix:** "…DisputeDesk hasn't checked any file, so it can't back an attachment." Keep the logic; only the wording changes. The Insights lines ("DisputeDesk does not inspect documents") are still true and should be looked at again in 3.3.

**M2. The no-regression test doesn't cover drafts, Gemini, Insights or buyers.**
- **Where:** `app.test.ts:2147`.
- **Why it matters:** Phase 3.3 adds extracted text, which is the first thing that could reach a prompt by mistake. This test should catch that, and it can't yet.
- **Fix:** in the same test, also compare before and after:
  - the merchant draft request that the mocked Gemini client receives (`/api/analysis/ai`);
  - `/api/intelligence`, for the merchant and for admin;
  - the buyer view of the shared DEMO-1001, along with the buyer explanation request;
  - the analysis with confirmations present.

**M3. Document ownership is enforced by the app, not the database.**
- **Where:** migration v5 has no link from `documents` to `dispute_access` (area 5).
- **Fix:** a new migration (v6), since v5 is released and must not be edited. Add a `BEFORE INSERT` trigger on `documents` that raises unless a matching `dispute_access` row exists and the account's role is `merchant`. A trigger, unlike a foreign key, doesn't cascade when access is re-seeded. Recommended, not blocking: the app checks are tested.

### Low
- **L1. Upload order.** The file is read and hashed before the dispute access check, so a merchant can make the server buffer up to 5 MB for a dispute they can't reach. It is rate-limited, but checking `X-Dispute-Id` with `findDispute` before `express.raw` would be cheaper. The denied attempt would still be audited as before.
- **L2. Compressed bodies and memory.**
  - `express.raw` accepts `Content-Encoding: gzip/deflate/br` (the `inflate: true` default). The 5 MB limit applies after decompression, so this is safe but unneeded. Use `inflate: false`.
  - Nothing caps uploads from all merchants at once. That is fine for a local demo with a few accounts, but deployment would need a cap.
- **L3. Hidden documents still count against storage.** If an account loses access to a dispute in `demo-accounts.json`, its documents there disappear from every list, admin's included. They still count toward its 50 MB and the merchant can't delete them. Count only reachable documents, or remove them when access is re-seeded.
- **L4. Removing `Cf` characters breaks some names.** It also removes ZWJ and ZWNJ, which emoji sequences and Persian or Indic names need. Consider keeping U+200C and U+200D and removing only the bidi controls (U+202A–U+202E and U+2066–U+2069) plus the other format characters.
- **L5. Name direction.** Add `unicode-bidi: isolate` (or `dir="auto"`) to `.document-name`, so a right-to-left name can't reorder the text next to it.
- **L6. For the 3.4 download route.** Serve files only with `Content-Disposition: attachment`, the stored `Content-Type`, `nosniff` and `CSP: sandbox`. Polyglot files pass the signature check.
- **L7. Body-parser errors other than parse and size.** Errors such as `request.aborted` and `encoding.unsupported` reach the generic 500 handler and log "Unexpected server error: …". The log line holds only the parser's message, never bytes. Mapping them to 400 or 415 would be tidier.
- **L8. The audit request is out of date.** It describes the work as uncommitted. Future audit prompts should start from `92d3196`.

## 5. Required before Phase 3.3

1. **Back up the real v4 database** before any start of the v5 code, the same way as the v3 backup (`VACUUM INTO`, preserved, never modified). There is no v4 backup yet: `server/data/` holds only `disputedesk-v3-backup-2026-11-09.sqlite`.
2. **M1:** correct the draft-check message in `assist.ts`.
3. **M2:** extend the no-regression test to cover the Gemini draft request, Insights and the buyer view.

Recommended alongside them: M3 (the v6 ownership trigger), L1 and L2 (`inflate: false`, and the dispute check before reading the body). The other low findings can wait for 3.4 or 3.5.

## 6. Git status

| Item | Value |
|------|-------|
| Branch | `master`, HEAD `92d3196`, 1 commit ahead of `origin/master` (not pushed) |
| Working tree | Clean before this audit. Adds this report only (untracked). |
| Real database | `server/data/disputedesk.sqlite`, schema v4, 602 audit rows, integrity ok. Not migrated. |
| Backups | `disputedesk-v3-backup-2026-11-09.sqlite` (kept, not touched). No v4 backup yet. |

Waiting for approval before any fix or Phase 3.3.

## 7. Fixes applied (approved 2026-11-09)

| Item | Change | Check |
|------|--------|-------|
| v4 backup | `server/data/disputedesk-v4-backup-2026-11-09.sqlite`, made with `VACUUM INTO` from the real database opened read-only. The real database and the v3 backup were not touched. | Backup is version 4, has 602 audit rows, and `integrity_check` is ok |
| M1 | `assist.ts`: the message now reads "DisputeDesk hasn't checked any file, so it can't back an attachment." The comment above `ATTACHMENT` was updated too. `claims.test.ts` expects the new text. Older reports still quote the old wording as history. | `claims.test.ts` passes |
| M2 | `app.test.ts`: the no-regression test now uses a mocked Gemini client and a fixed clock, with a merchant confirmation on DEMO-1001. Before and after the uploads it compares:<ul><li>the merchant's analysis, checklist, dispute list, draft, Insights and Insights explanation;</li><li>admin's analysis and Insights;</li><li>Buyer A's dispute list and explanation;</li><li>the exact request body each Gemini call received.</li></ul> | Passes |

**After the fixes:** server tests 259 of 259 passed, client tests 108 of 108 passed, and both typechecks exit 0.

**Still open:** M3 and L1 to L8 (recommended, not blocking). Nothing is committed.
