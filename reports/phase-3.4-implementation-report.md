# DisputeDesk AI: Stage 3.4 Document Links and Downloads

**Date:** 2026-11-10
**Base:** `master` at `791fc4d` (Stage 3.3 closed).
**Status:** committed as `f31d059` (feature) and `d3db9f7` (audit fixes), not pushed. Independent audit: PASS WITH
CONDITIONS, no critical or high findings; the one medium and all seven low findings are fixed (§10).
- The real database was not migrated.
- PayPal and Gemini were not called.
- No dependency was added.

## 1. Summary

A merchant can now say that one of their documents is the record for a checklist gap, and can download their own original file.

- **Linking:** each document in "Your documents" has a folded "Link to checklist gaps" list with one checkbox per gap (a missing item, or one the records don't show). Checked means linked.
- **On the checklist:** the gap row shows "Document attached, not verified" and the file name. It stays a gap: "Needs attention" is not lowered, and the count line adds "N with a document attached".
- **Download:** "Download" saves the merchant's own original as an attachment. The browser never renders or runs it.
- **Admin:** sees links (with the owner's account) on the checklist and the documents list; can't link, unlink or download.
- **Buyers:** 403 on every new route. **Another merchant:** 404, identical to a missing document.

A link is a merchant statement. No evidence status, readiness count, checklist status, provenance, draft or Gemini input changes.

## 2. Decisions

| Question | Decision | Why |
|----------|----------|-----|
| Which items can be linked | Gaps only (`missing`, `needs_confirmation`), like gap confirmations | Chosen by the user; matches the 3.1 design (§7). |
| Where the merchant links | From the document, with checkboxes | Chosen by the user. |
| Unlink | Always allowed, even if the item is no longer a gap | Same as withdrawing a confirmation: an old link can always be removed. |
| Links on items that are no longer gaps | Kept, not shown on the checklist; still listed on the document so they can be removed | Same rule as confirmations. |
| Admin download | No | Decision D5 in the 3.1 audit: admin reads metadata and text only. |
| Download transport | `POST` with JSON, then a `blob:` download in the browser | Keeps the existing write-request protections (Origin and Sec-Fetch-Site checks) and puts no ID in a URL. |

## 3. Architecture

```
POST /api/documents/link   { source, dispute_id, document_id, item_id, linked }   merchant only
  validate (UUID, item ID, boolean) ─▶ sandbox: 409 ─▶ findDispute (404 for another account's dispute)
  linking: the item must be a gap now, else 409 not_linkable
  setDocumentLink (store.ts): one transaction; only the account's own document on that dispute, while it has access
    insert ON CONFLICT DO NOTHING / delete; audit document_linked | document_unlinked "<document_id> <item_id>"
  ─▶ { documents, checklist }

POST /api/documents/download { source, dispute_id, document_id }   merchant only
  downloadDocument (store.ts): own document only; audit document_downloaded "<document_id>"
  ─▶ bytes with Content-Type from the allowlist, Content-Disposition: attachment (ASCII fallback name +
     RFC 6266 filename*), nosniff, CSP "default-src 'none'; frame-ancestors 'none'; sandbox", Cache-Control: no-store

POST /api/analysis/checklist (and confirm): adds attachments for gap items (merchant: own; admin: all)
POST /api/documents/delete: now also returns the checklist (the document's links go with it)
```

**Client:** the checklist is loaded once in `AnalysisView` (`useChecklist`) and shared. The documents section updates it from the server's answer after a link, unlink or delete, so both sections always show the same state.

## 4. Files changed

| File | Change |
|------|--------|
| `shared/types.ts` | `DisputeDocument.linked_items`, the `DocumentAttachment` type, `EvidenceChecklist.attachments`. |
| `server/src/store.ts` | `linked_items` on listed documents, `setDocumentLink`, `listAttachments`, `downloadDocument`. |
| `server/src/app.ts` | Attachments on the checklist, the link and download routes, the checklist in the delete answer. |
| `server/src/app.test.ts` | Role table rows for both routes, an end-to-end link/unlink/download test, and the no-change test now links every document to every gap. The test helper doesn't parse downloads as JSON. |
| `client/src/analysis.ts` | `linkDocument`, `downloadDocument`; `deleteDocument` returns the checklist too. |
| `client/src/Documents.tsx` | "Linked to" line, "Link to checklist gaps" checkboxes, Download button, `DOCUMENT_LINK_NOTICE`. Audit fixes: a "checklist not loaded" state, one download at a time. |
| `client/src/AnalysisPanel.tsx` | Shared checklist state, "Document attached, not verified" tag and line, the count line. Audit fix: `checklistGate` applies answers in request order. |
| `client/src/styles.css` | `.document-links`, `.document-link` (44 px rows, wraps long names). |
| `client/src/ui.test.ts` | Fixtures, the endpoint allowlist (23 fetch calls), two new tests. |

## 5. Migration

**None.** Migration v5 already created `document_links` (document, item, time; cascades with the document) and the audit events `document_linked`, `document_unlinked` and `document_downloaded`. The history still ends at v6.

## 6. Security decisions

| Risk | Decision |
|------|----------|
| Linking someone else's document | The store checks owner, dispute and current access in the same transaction as the write. Another account gets 404, identical to a missing document (tested). |
| A link treated as evidence | Gaps only; the tag says "not verified"; Needs attention is never lowered; the no-change test links every document to every gap and compares analysis, checklist (without the attachments key), list, draft, Insights, admin and buyer views and the exact Gemini requests. |
| Downloaded file run or rendered | Attachment only, fixed type from the allowlist, `nosniff`, a `sandbox` CSP, `no-store`. The client hands the blob to the browser's download and never opens it. |
| Header injection by file name | The ASCII fallback name is fixed (`document.pdf`); the real name is percent-encoded in `filename*` with `encodeFilename` (RFC 8187 characters only, so `' ( ) *` are encoded too). Names were already cleaned at upload. Tested with quotes, CR/LF, `Set-Cookie`, an RTL override and a long Devanagari name. |
| Cross-site requests | Both routes are `POST` with JSON, so the existing Origin and Sec-Fetch-Site checks apply. |
| Admin writes | Link and download are merchant-only; admin gets 403 (role table). |
| Audit privacy | IDs only: `<document_id> <item_id>` or `<document_id>`. |

## 7. Tests

| Check | Result |
|-------|--------|
| Server tests | 282 run, 282 passed (279 before Stage 3.4, plus 1 with the feature and 2 with the audit fixes) |
| Server typecheck | No errors |
| Client tests | 115 run, 115 passed (110 before Stage 3.4, plus 2 with the feature and 3 with the audit fixes) |
| Client typecheck | No errors |
| Client production build | Built. Existing chunk-size warning only. |

**Browser check** (scratch copy of the real database, migrated v4 → v6, 602 audit rows, integrity ok; PayPal and Gemini off; outbound calls blocked):
- Signed in as Demo Merchant A and uploaded a synthetic 2-page PDF to DEMO-1001.
- Linked it to "Shipping tracking" with the checkbox: the document shows "Linked to: Shipping tracking (not verified)"; the checklist row keeps "Missing from records" and adds "Document attached, not verified"; the count line reads "Needs attention: 2 (0 merchant-confirmed, 1 with a document attached)"; readiness still reads "Key evidence 0 of 2".
- Download: 200, `application/pdf`, attachment, the `sandbox` CSP, `nosniff`, `no-store`, all 989 bytes (checked from the page's own session; the button was not clicked, so no file was saved).
- Unlinking removed the tag and the count suffix.
- At the pane's 268 px width there was no sideways scroll.
- Console: only the known 401s from the session check before sign-in.

## 8. Known limitations

- **Nothing is compared:** a link says nothing about what the file contains. Matching document text to records is Stage 4.
- **Item labels in the documents section** come from the shared checklist. Until it loads, a document says the gaps will show once it has, and its links are given as a count.
- **Links on items that later stop being gaps** are kept but not shown on the checklist (same as confirmations).
- **Download in the UI** was not clicked in a browser, so no file was saved by one. Headers and exact bytes (SHA-256, PDF, PNG, JPEG and 5 MB) are checked by the server tests; the button states by the client tests. Interrupted downloads are left to the browser and are not tested.
- **The audit fixes were not re-checked in the browser;** the client tests cover their rendering.
- **Carried over from Stage 3.3:** a hostile PDF can still use a lot of machine memory for up to 10 s (no OS memory limit), and pdfjs skips most standalone joiners and direction marks and expands ligatures before `cleanText` runs (now stated in the Stage 3.3 report).

## 9. Git status

| Item | Value |
|------|-------|
| Branch | `master`, not pushed |
| Commits | `f31d059` Add Stage 3.4 document links to checklist gaps and owner downloads (10 files); `d3db9f7` Fix Stage 3.4 audit findings for document links and downloads (7 files) |
| Not changed | `.env`, migrations, demo data, PayPal sandbox scripts, dependencies, the real database and both backups (SHA-256 identical before and after every test run) |

Stage 3.5 (regression and privacy audit, README and Devpost copy, release audit) has not been started.

## 10. Independent audit and fixes

A read-only audit of `f31d059` gave **PASS WITH CONDITIONS**: no critical or high findings. Confirmed sound: input
validation, merchant-only routes, ownership checked inside the write transaction, another merchant's document answering
404 exactly like a missing one, gap-only linking, cascade on delete, ID-only audit entries, the download headers, and no
link ever reaching evidence statuses, readiness, drafts, Insights, buyer views or Gemini. All findings are fixed in
`d3db9f7`:

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| M1 | Medium | While the checklist was loading or had failed, each document said "This dispute has no checklist gaps to link a file to", and "Linked to" showed raw item IDs. | `linkable` is `null` until the checklist is known: the document says the gaps will show once it has loaded, and links are given as a count. |
| L1 | Low | `filename*` used `encodeURIComponent`, which leaves `' ( ) *` unencoded (not RFC 8187). No injection was possible. | `encodeFilename` in `app.ts` encodes them too. |
| L2 | Low | Download had no busy state: repeated clicks fetched and audited the file again. | One download at a time; buttons disabled, "Downloading…", and "Preparing …" / "… handed to your browser's downloads." announced. |
| L3 | Low | Checklist answers from the checklist and documents sections could arrive out of order; the last to arrive won. | `checklistGate` (`AnalysisPanel.tsx`): each request takes a ticket; an older answer never overwrites a newer one; an answer for another dispute is ignored. |
| L4 | Low | A delete or link that saved, with an unusable checklist in the answer, showed "Couldn't save that". | The document list is kept and the checklist is loaded again. |
| L5 | Low | The download test compared text, not bytes. | The test helper returns the raw bytes; downloads are compared byte for byte and by SHA-256. |
| L6 | Low | Missing tests. | Added: PNG, JPEG and 5 MB downloads; hostile file names; malformed download requests; repeated link and unlink (5 audits each); a stale link listed and removable but not on the checklist; a link racing a delete (no link outlives its document); checklist answer ordering; the not-loaded state; the busy download button; a saved change with an unusable checklist. |
| L7 | Low (docs) | The Stage 3.3 report read as if joiners, direction marks and ligatures survive extraction. | The Stage 3.3 report now says pdfjs skips glyphs whose text is a lone format character, applies NFKC to ligatures and special spaces and reorders right-to-left runs, before `cleanText`; `cleanText` alone keeps them. |
