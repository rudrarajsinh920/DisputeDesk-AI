# DisputeDesk AI: Stage 3.2 Implementation Report (merchant document upload)

**Date:** 2026-11-09
**Base:** `master` at `7c2bed2`. Everything below is uncommitted.
**Source:** `reports/phase-3.1-architecture-audit.md`, approved with its recommended defaults (D1 to D11). This is Phase 3.2 only.

## 1. Summary

Merchants can now attach files to their own demo disputes:
- PDF, PNG and JPEG only, checked by the file's first bytes;
- 5 MB per file, 10 files per dispute, 50 MB per account, 20 uploads per 15 minutes;
- they can list and delete them.

DisputeDesk stores each file and does not read it yet. Every file shows as **Not verified** with the status "Stored. Text not read yet."

Nothing about evidence changes. Evidence statuses, readiness, the checklist, the draft and anything sent to Gemini are the same as before; tests check this.

Not in this phase:
- reading text from PDFs (3.3, needs `pdfjs-dist`);
- linking a file to a checklist item, and downloading it (3.4);
- docs and the release audit (3.5).

No dependency was added.

## 2. Changed files

| File | Change |
|------|--------|
| `server/src/db.ts` | Migration v5: `documents`, `document_blobs`, `document_pages`, `document_links`, plus 7 `document_*` audit events (audit log rebuilt, rows kept). |
| `server/src/documents.ts` | New. `sniffMediaType` (file signature) and `cleanDocumentName` (display-only filename). |
| `server/src/store.ts` | `listDocuments`, `addDocument` (limits checked inside the insert transaction), `deleteDocument`. |
| `server/src/app.ts` | Three routes (below); `findDispute` takes an optional lookup; an upload rate limiter. |
| `shared/types.ts` | `DisputeDocument`, `DocumentStatus`, `DocumentMediaType`, `DOCUMENT_MEDIA_TYPES`, `DOCUMENT_LIMITS`. |
| `client/src/Documents.tsx` | New. "Your documents" section: list, upload field, delete. |
| `client/src/analysis.ts` | `fetchDocuments`, `uploadDocument`, `deleteDocument`. |
| `client/src/AnalysisPanel.tsx` | Shows the section after the checklist, on demo disputes only. |
| `client/src/styles.css` | Section styles; long names wrap; the native file button matches the secondary buttons. |
| Tests | `server/src/app.test.ts`, `server/src/store.test.ts`, `client/src/ui.test.ts`. |

## 3. Routes

| Route | Who | What |
|-------|-----|------|
| `POST /api/documents` `{source, dispute_id}` | Merchant (own files), admin (all, read-only) | List metadata. Never the bytes. |
| `POST /api/documents/upload` | Merchant | The body is the file. The dispute is in `X-Dispute-Id`, the percent-encoded filename in `X-Document-Name` (neither goes in a URL). Answers 201. |
| `POST /api/documents/delete` `{source, dispute_id, document_id}` | Merchant (own files) | Deletes the file. Its bytes, pages and links go with it. |

The checks on the upload route run in this order:
1. Session and role: 401 when signed out, 403 for buyers and admin.
2. The declared type is on the allowlist: otherwise 415.
3. Rate limit: 429, with `Retry-After`.
4. The body is read, at most 5 MB: otherwise 413.
5. The body is not empty: otherwise 400.
6. The file's first bytes match the declared type: otherwise 415.
7. The dispute is a demo dispute this merchant can reach: otherwise 404, the same as an unknown ID, and the attempt is audited.
8. In one transaction: the count, size and duplicate limits (409), the insert, and the audit entry.

**Other behaviour:**
- **Access:**
  - Another merchant gets the same 404 body as an unknown dispute.
  - A document ID from another dispute or account gets 404 `document_not_found`.
  - Buyers get 403 on all three routes, including on DEMO-1001, which Buyer A shares with Merchant A.
- **Sandbox:**
  - List and delete with `source: "paypal_sandbox"` get 409 before any lookup, so PayPal is never called.
  - Uploads always look up a demo dispute.
  - The database refuses a document on a dispute it doesn't hold (foreign key).
- **Audit:** `document_uploaded` and `document_deleted` hold the account, dispute and document ID only. They never hold the filename, the bytes or a hash.
- **Filenames:** shown as text only. The server percent-decodes and NFC-normalises them, and removes control and bidi characters. It replaces `/` and `\`, cuts names to 120 characters, and turns an empty name, "." or ".." into "document".
- **Cross-site guard:** the existing Origin and Sec-Fetch-Site guard covers the new POSTs. A cross-site upload gets 403 and nothing is stored.

## 4. Database (migration v5)

The tables follow the audit's section 5. `documents.status` is `pending` for every upload in this phase. `document_pages` and `document_links` are created now, so 3.3 and 3.4 need no new migration; nothing writes to them yet.

Documents survive a restart, because seeding upserts disputes. A dispute removed from the demo files takes its documents with it (cascade).

**Live database:** not migrated. `server/data/disputedesk.sqlite` is still v4 (602 audit rows, integrity OK). The browser check used a scratch copy made with `VACUUM INTO`. The copy upgraded to v5 with integrity OK and was then deleted.

**Before the first real start of this code**, take a v4 backup the same way as the v3 one. Once files are uploaded, any later backup will contain them.

## 5. Tests

| Check | Result |
|-------|--------|
| Server tests | 259 tests, 259 passed (247 before) |
| Server typecheck | Exit 0 |
| Client tests | 108 tests, 108 passed (103 before) |
| Client typecheck | Exit 0 |
| Client production build | Built. Existing warning only: main chunk over 500 kB. |

**New server tests:**
- **Route table and role matrix:** updated for the three routes.
- **Upload:**
  - PDF, PNG and JPEG are accepted.
  - Only metadata is listed.
  - The audit holds IDs only.
- **Refusals:**
  - HTML, SVG and ZIP;
  - ZIP or HTML declared as PDF;
  - PDF declared as PNG, and PNG declared as JPEG;
  - no Content-Type, an empty body, 5 MB + 1 byte;
  - no dispute, an unknown dispute.
  - Nothing is stored in any of these cases.
  - Exactly 5 MB is accepted.
- **Filenames:** `../../etc/passwd`, backslashes, control characters, an RTL override, HTML, "..", empty, 500 characters, and invalid percent-encoding.
- **Access:**
  - Merchant B by dispute and by document ID;
  - Buyer A on a shared dispute;
  - admin read-only;
  - denied attempts are audited.
- **Sandbox:** 409 for list and delete, no PayPal calls, and the foreign key refuses the row.
- **Limits:** the 11th file, 50 MB per account, a duplicate file, and the upload rate limit (with a reset after 15 minutes).
- **Delete:** cascades to the blob, pages and links; a second delete gets 404; bad IDs get 400.
- **No change elsewhere:** the analysis, checklist and dispute list are identical after uploads on DEMO-1001 and DEMO-1002.
- **Cross-site:** an upload with another site's Origin or `Sec-Fetch-Site: cross-site` is refused.
- **Migration:**
  - A v4 database upgrades to v5 and keeps every audit row and confirmation.
  - The new events work, and the append-only triggers stay.
  - The table constraints refuse bad rows.
  - The v3-to-v4 test now stops at v4.

**New client tests:**
- the list shows "Not verified" and no other "verified" wording;
- the upload field has its label and `accept` list, with no inline styles;
- a filename containing HTML is escaped;
- admin gets no buttons and no file field;
- a full dispute disables the field;
- the error is announced (`role="alert"`, `aria-describedby`);
- the browser-side type and size checks;
- the section is shown on demo disputes only, never on sandbox disputes, and the buyer screens don't reference documents;
- the endpoint list and fetch count are updated.

**Browser check:** `localhost:5173` against a scratch copy on `127.0.0.1:3001`, with outbound requests blocked and probe-only passwords.
- Uploaded a synthetic PDF with a long name and a PNG named `<b>label</b>.png`. The second was stored as `<b>label<_b>.png` and shown as text.
- At 320px there is no sideways scroll, long names wrap, and targets are 44px.
- **One bug found and fixed:** the native file field's minimum width stretched the detail column and clipped the panel. `min-width: 0` and `width: 100%` fixed it.
- Delete through the UI works and is announced. Focus now moves to the section heading (it used to fall back to the panel).
- Console: only the two 401s from the signed-out session check before sign-in, an existing behaviour.

## 6. Limitations and open points

- Files are not read, scanned or verified. The notice says so.
- Delete asks with the browser's own `confirm` dialog.
- Files are stored unencrypted in the SQLite file (D6), and any backup taken after uploads will contain them.
- The upload limiter is in memory, so it resets when the server restarts. This is the same as the sign-in and AI limiters.
- The low findings L2 to L6 from the 2.2 release audit are still open.
- The README and Devpost copy don't mention documents yet (Phase 3.5).

## 7. Git state

| Item | Value |
|------|-------|
| Branch | `master`, HEAD `7c2bed2`, in sync with `origin/master` before this work |
| Modified | `client/src/AnalysisPanel.tsx`, `client/src/analysis.ts`, `client/src/styles.css`, `client/src/ui.test.ts`, `server/src/app.test.ts`, `server/src/app.ts`, `server/src/db.ts`, `server/src/store.test.ts`, `server/src/store.ts`, `shared/types.ts` |
| Untracked | `client/src/Documents.tsx`, `server/src/documents.ts`, `reports/phase-3.1-architecture-audit.md`, this report |
| Not changed | `.env`, dependencies, the PayPal sandbox scripts, the demo data files, the live database |

Nothing is committed or pushed. Waiting for review before Phase 3.3.
