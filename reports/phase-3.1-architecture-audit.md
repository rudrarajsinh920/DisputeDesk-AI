# DisputeDesk AI: Stage 3 Evidence Document Intelligence, Architecture Audit

**Date:** 2026-11-09
**Base:** `master` at `7c2bed2`, in sync with `origin/master`, live database at schema v4.
**Scope:** design only. No source code, dependency, migration, database or Git change. No document was uploaded and no PayPal or Gemini request was made. This file is the only one created.

## 1. Summary

DisputeDesk has no upload, file storage or document parsing today. Every request body is JSON of 64 kB at most, and evidence is a set of boolean flags in the demo records. Stage 3 is therefore a new capability, not an extension.

**Recommended smallest secure design:**
- Merchants only, demo disputes only.
- PDF (with a text layer), PNG and JPEG, 5 MB per file and 10 files per dispute.
- Bytes stored in SQLite, never on the web path. Uploads are raw binary bodies, so no multipart library is needed.
- Text extracted deterministically in a sandboxed worker, page by page.
- **No OCR and no Gemini in Stage 3.**

A document never changes an evidence status by itself. The merchant links it to a checklist item, and it is shown as "Document attached, not verified", like a gap confirmation. Stage 4 can later compare extracted facts with the records through the existing provenance model, which already reserves `source_type: "document"`.

## 2. Current architecture findings

### 2.1 Upload and storage

| Area | Today |
|------|-------|
| Upload routes | None. All 21 routes are JSON (`express.json`, 1 kB to 64 kB). Nothing uses multipart, `express.raw` or `express.static`. |
| File system | The server reads only `.env` (config) and the SQLite file (`server/data/`, git-ignored). |
| Dependencies | Server: `express` only. Nothing parses PDFs or images. |
| Evidence | Boolean flags per dispute (`dispute_evidence`), from `demo-disputes.json`. "Available" means the record says so. DisputeDesk never opens a document, and the README says this many times. |
| Provenance | `SourceType` already reserves `"document"`, and comments say it is never produced because there is no document upload. `EvidenceRef.ref` is `"<source>:<dispute_id>:<path>"`. |

### 2.2 Authentication and ownership

- Sessions are stored in the database: an `HttpOnly; Secure; SameSite=Strict` `__Host-` cookie, with the token hashed. Passwords use scrypt.
- `requireRole` is on every route except sign-in and sign-out. A test fails if a route is missing from the role table.
- `canAccess`:
  - admin can access everything;
  - sandbox disputes need a merchant with sandbox access;
  - demo disputes must be in the account's `dispute_ids`.
- **Shared access:** no demo dispute is shared between two merchants, but buyers share disputes with merchants (DEMO-1001 is merchant-a and buyer-a; DEMO-1002 merchant-a and buyer-b; DEMO-1003 merchant-b and buyer-b). **Dispute access alone must not grant document access:** buyers must never see merchant documents.
- Another account's dispute answers 404, exactly like a missing one, and is audited. Admin is read-only.
- Writes from another site are refused (Origin and Sec-Fetch-Site). The API CSP is `default-src 'none'` with `nosniff` and CORP `same-origin`. The page CSP is strict (`script-src 'self'`, no inline style; `img-src 'self' data:`).

### 2.3 Database

- Schema v4: `accounts`, `disputes`, `dispute_evidence`, `dispute_access`, `sessions`, `audit_log` (append-only, CHECK-listed events) and `gap_confirmations`.
- `PRAGMA foreign_keys = ON`, WAL mode, one transaction per migration, forward-only.
- A new audit event needs a new migration with `rebuildAuditLog`.
- `disputes` holds demo records only. PayPal sandbox disputes are never stored (a project guarantee).

### 2.4 AI and prompt injection

- Gemini gets only the listed record values, inside a `<data>` block with `<`, `>` and `&` escaped. Values that read like instructions (`looksLikeInstructions`) are withheld.
- The output is schema-checked, every line is checked against the records, and invented facts are dropped.
- The "AI only words" guarantee rules out using Gemini to *extract* facts from documents: that would make the model a source of facts.

### 2.5 Claims and Stage 4 hooks

- The claim check (`/api/analysis/check`) already links claim kinds to the records that may back them. Tracking never backs a delivery claim.
- `ParagraphClaim.refs` holds provenance refs, so a document ref can slot in later.

## 3. Recommended minimal Stage 3 architecture

```
Merchant browser
  │ POST /api/documents (raw bytes, Content-Type set, ≤ 5 MB)
  ▼
Express route: requireRole("merchant") → findDispute (demo only) → limits → magic-byte check
  │ one transaction: document row + blob row + audit "document_uploaded"
  ▼
Extraction queue (in process) → worker_threads Worker with resourceLimits and a time limit
  │ PDF text layer page by page; images: no text in Stage 3
  ▼
document_pages rows (page, text, sha256) + status "extracted" | "no_text" | "failed"
  ▼
Checklist UI: "Documents" list per dispute; link a document to a checklist item;
  shown as "Document attached, not verified". Status, readiness, draft and Gemini input unchanged.
```

**Principles:**
1. **Merchant-private.** A document belongs to the uploading account and that dispute. Admin can read the metadata and extracted text (read-only); download of the original is a decision (D5). Buyers never see documents. Another account gets the same 404.
2. **Bytes are inert.** They are stored as a BLOB, never served inline or rendered by the app. Downloads use a fixed `Content-Type`, `Content-Disposition: attachment`, `nosniff` and `CSP: sandbox`.
3. **Parsing is isolated.** It runs in a worker thread with memory and time limits. A crash marks the document `failed` and doesn't stop the server.
4. **Extracted text is untrusted data.** It is shown as plain text (React escaping) and not sent to Gemini in Stage 3.
5. **No automatic evidence.** Linking a document is a merchant statement and never changes an engine status. Stage 4 may compare facts with the records, never decide that a document is genuine.

## 4. Threat model and privacy risks

| # | Threat | Mitigation in the design |
|---|--------|--------------------------|
| T1 | Another merchant or a buyer reads a document | Every document route goes through `findDispute` and `canAccess`, *and* a check that `document.account_id` is the caller (admin read-only). Buyers get 403 on every document route. Tests cover each role, with the same 404 shape. |
| T2 | Guessing document IDs | Random 128-bit IDs (`randomUUID`). The ownership check is applied anyway, and misses are audited (`dispute_access_denied`). |
| T3 | Path traversal or stored filenames | No file-system paths, because bytes live in SQLite. The original filename is kept only as display text: NFC-normalised, stripped of control and path characters, at most 120 characters, never used in a header without RFC 5987 encoding. |
| T4 | Executable or active content (HTML, SVG, scripts, PDF JavaScript) | An allowlist by magic bytes (`%PDF-`, PNG signature, JPEG `FF D8 FF`) that must agree with the declared `Content-Type`. Anything else gets 415. The browser never renders a PDF from DisputeDesk; only extracted text is shown. Downloads are attachments with `CSP: sandbox`. |
| T5 | Malware | DisputeDesk never runs a file, and only the extractor parses it. There is no antivirus without a new service (ClamAV): open decision D7. The UI says files are not scanned. |
| T6 | Malformed or hostile PDFs (parser bugs, decompression bombs, deep nesting) | Worker `resourceLimits` (for example 128 MB heap), a 10-second time limit, at most 20 pages, at most 200 kB of text per page and 1 MB per document. A failure gives status `failed`, with no retry loop. The parser is a pinned, patched version with eval off (see 6.2). |
| T7 | Body or disk exhaustion | `express.raw({ limit: "5mb", type: [allowlist] })` on this route only. At most 10 documents per dispute and 50 MB per account, checked in the insert transaction. A per-account upload limit reuses the sliding-window limiter. |
| T8 | Prompt injection in extracted text | Stage 3 sends no document text to Gemini. In Stage 4, any excerpt sent goes through `looksLikeInstructions`, is quoted inside the escaped `<data>` block, and the output checks stay. Document text never becomes an instruction or a fact without a record match. |
| T9 | Stored XSS via extracted text | It is rendered only as React text nodes: no `dangerouslySetInnerHTML`, no Markdown or HTML rendering. The page CSP stays as it is. |
| T10 | Cross-site upload | The existing Origin and Sec-Fetch-Site guard covers the new POST and DELETE routes. |
| T11 | Treating a document as verified evidence | Labels are "Document attached, not verified" and "Text found on page n". Statuses, readiness, draft, claim checks, Insights and Gemini input are unchanged, enforced by the same before/after tests as 2.2b. |
| T12 | Real personal data in a demo | The hackathon build accepts uploads on demo disputes only, with a banner: "Upload only synthetic test files". Sample files go in `test/fixtures/` and are synthetic. |
| T13 | Secrets or document text in the audit log or server logs | The audit log holds IDs, page counts and status only. It never holds filenames, text or hashes of text. Server logs don't print document content. |
| T14 | Retention beyond need | Delete is a real delete (cascades to blob and pages); the audit keeps IDs only. A retention limit is decision D4. |

**Privacy risks to state in the product:**
- Documents may contain buyer addresses and payment details. They are kept unencrypted in the local SQLite file (decision D6).
- Backups such as `disputedesk-v3-backup-*.sqlite` will also contain documents once any are uploaded.

## 5. Proposed database changes (design only, migration v5)

```sql
-- One uploaded file. Merchant-owned, demo disputes only (FK to disputes, which holds only demo records).
CREATE TABLE documents (
  id            TEXT PRIMARY KEY CHECK (length(id) = 36),                -- randomUUID
  account_id    TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  dispute_id    TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  media_type    TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size     INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),               -- of the bytes; duplicate detection
  page_count    INTEGER CHECK (page_count BETWEEN 0 AND 20),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'extracted', 'no_text', 'failed')),
  uploaded_at   INTEGER NOT NULL,
  UNIQUE (account_id, dispute_id, sha256)
) STRICT;
CREATE INDEX idx_documents_dispute ON documents (dispute_id);

-- Bytes kept apart so listing documents never loads them.
CREATE TABLE document_blobs (
  document_id TEXT PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  bytes       BLOB NOT NULL
) STRICT, WITHOUT ROWID;

-- Extracted text, one row per page. The unit of provenance.
CREATE TABLE document_pages (
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page BETWEEN 1 AND 20),
  text        TEXT NOT NULL CHECK (length(text) <= 200000),
  text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
  method      TEXT NOT NULL CHECK (method IN ('pdf_text')),               -- 'ocr' added only with OCR
  PRIMARY KEY (document_id, page)
) STRICT, WITHOUT ROWID;

-- The merchant's statement that a document is the record for a checklist item. IDs only.
CREATE TABLE document_links (
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 40 AND item_id NOT GLOB '*[^a-z_]*'),
  linked_at   INTEGER NOT NULL,
  PRIMARY KEY (document_id, item_id)
) STRICT, WITHOUT ROWID;

-- rebuildAuditLog(V5_AUDIT_EVENTS) adding: document_uploaded, document_extracted, document_extraction_failed,
-- document_deleted, document_linked, document_unlinked, document_downloaded.
```

**Notes:**
- Same pattern as v4: forward-only, one transaction, the audit log copied by id.
- The audit-log rebuild copies every row, which takes a moment on a larger log but stays atomic.
- `UNIQUE (account_id, dispute_id, sha256)` stops the same file being uploaded twice.
- `documents.account_id` together with the FK on `dispute_id` gives ownership. Reads also join `dispute_access`, as v4 does, so an account that loses access loses its documents' visibility.
- **Before migrating:** take a v4 backup the same way as the v3 one (`VACUUM INTO`). The backup will then hold any documents (T14).

## 6. Storage and extraction design

### 6.1 Storage: SQLite BLOB (recommended) or files

| | SQLite BLOB | Files in `server/data/documents/<uuid>` |
|---|---|---|
| Isolation | One FK and cascade path, no paths at all | Must prevent traversal, symlinks and orphaned files |
| Atomic delete with metadata | Yes, one transaction | Two-step, so orphans are possible |
| Backup | One file (`VACUUM INTO`) | DB and folder must be copied together |
| Size | Fine at 5 MB × 10 per dispute for a demo; the DB grows | Better for large volumes |
| Dependencies | None | None |

Recommendation: BLOB for Stage 3. Revisit with object storage if DisputeDesk ever handles real merchant volumes.

### 6.2 Extraction options

Node 24 has no PDF parser. Every real option adds one dependency.

| Option | What it gives | Risks and costs | Verdict |
|--------|---------------|-----------------|---------|
| `pdfjs-dist` (Mozilla, Apache-2.0) in a worker | Text layer per page with positions; no native code | Large package. CVE-2024-4367 (font code run through eval) is fixed from 4.2.67; set `isEvalSupported: false`, pin a current version, and no rendering. | **Recommended**, as one new server dependency (needs approval) |
| `unpdf` (a wrapper around pdf.js) | Simpler API, same engine | One more layer to trust | Optional alternative |
| Hand-written PDF text parser | No dependency | Parsing PDFs safely is hard (filters, fonts, encodings), so the risk is high | Not recommended |
| OCR with `tesseract.js` (WASM) | Text from images and scans | Heavy and slow (seconds per page). By default it fetches language data from a CDN, so the data must be bundled locally. Errors are common, so OCR text is "machine-read, may be wrong". | **Defer** (D2) |
| Gemini multimodal | Strong OCR and layout reading | Sends whole documents to Google, breaks "AI only words", and its output can't be traced to a source | **Not recommended** for extraction |

**In Stage 3:**
- An image is stored and can be linked to a checklist item, but its status is `no_text`.
- A scanned PDF (no text layer) is also `no_text`.
- The UI says "No text found. DisputeDesk does not read scanned images yet."

### 6.3 Provenance

- A new `EvidenceRef` form: `ref = "demo:<dispute_id>:document/<document_id>/p<page>"`, with `source_type: "document"` and a new origin `"merchant_upload"`. `field` names the page and `value` is an excerpt (at most 300 characters).
- An excerpt pointer is `{ document_id, page, start, end, text_sha256 }`. The character offsets are into the stored page text. The hash shows the text hasn't changed since the match.
- **Labels:**
  - "From your document *name*, page n (text read by DisputeDesk; the document itself is not verified)".
  - Never "Verified against record" unless Stage 4 matches the text to a record value, and even then: "Matches the record", not "verified".

## 7. Human review and confirmation boundaries

| Action | Who | Effect |
|--------|-----|--------|
| Upload or delete a document | The owning merchant only | Stored or removed; audited. No status change. |
| Link a document to a checklist item | The owning merchant only | Row shows "Document attached, not verified". It counts inside "Needs attention", like a confirmation. |
| View the extracted text | Owner; admin read-only | Plain text, page by page |
| Download the original | Owner (admin: D5) | Attachment only, audited |
| Change an evidence status, readiness, the draft or Gemini input | Nobody, in Stage 3 | Enforced by before/after tests |
| Submit anything to PayPal | Never | Unchanged guarantee |

## 8. Stage 4 compatibility (evidence-to-claim matching)

What Stage 3 must keep possible:
- **Page-level text with hashes and offsets**, so a Stage 4 finding can cite `document/<id>/p<page>` and an exact span.
- **Deterministic fact finders** run over the page text: tracking-number patterns, dates, amounts with currency, order IDs. Each match is a candidate with its span, never a fact.
- **Comparison with the records** gives "matches the record value R3", "differs from the record" (shown as a conflict, never resolved automatically) or "not on record".
- **The claim check** can accept document refs as supporting refs for the claim kinds they fit, keeping the existing rule that tracking never backs delivery.
- **Any Gemini wording** about documents gets only matched excerpts, filtered by `looksLikeInstructions`, and the same line checks.

## 9. Implementation phases (after approval)

| Phase | Content | New dependency |
|-------|---------|----------------|
| 3.2 | Migration v5 (tables and audit events). Upload, list and delete routes: raw body, magic bytes, limits, ownership, role table. A documents list in the dispute view. No extraction. | None |
| 3.3 | Extraction worker: PDF text layer, limits, statuses, page view. Synthetic fixture PDFs, including hostile ones (truncated, oversized, encrypted, JavaScript, many pages). | `pdfjs-dist` (approval) |
| 3.4 | Link a document to a checklist item; labels; counts; the attachment download route with hardened headers. | None |
| 3.5 | Regression and privacy audit; README and Devpost copy; release audit. | None |
| Later | OCR (D2), sandbox disputes (D3), antivirus (D7), Stage 4 matching. | Per decision |

## 10. Acceptance tests

1. **Access matrix** for every new route: signed out 401; buyer 403; owning merchant 2xx; another merchant 404 with the same body as an unknown ID; admin read-only (writes get 403). The role table is updated.
2. **Cross-account:** merchant B can't list, read, link, download or delete merchant A's document, by dispute ID or document ID. Each attempt is audited.
3. **Sandbox:** an upload for `source: "paypal_sandbox"` is refused before any PayPal call (mocked client never called); the database refuses a sandbox dispute ID.
4. **Formats:**
   - PDF, PNG and JPEG are accepted.
   - HTML, SVG, ZIP or DOCX are refused with 415, as is a PDF renamed `.png`, or bytes that don't match the `Content-Type`.
   - Empty or over-limit bodies get 413 or 400.
   - The 11th file on a dispute and an account over 50 MB are refused.
5. **Filenames:** `../../x`, control characters, 500 characters and RTL override characters are stored safely and shown as text.
6. **Hostile PDFs:** a truncated file, a deeply nested one, a decompression bomb, an encrypted one, one with embedded JavaScript and one with 1,000 pages. Each ends `failed` or capped within the time limit, the server keeps answering, and nothing is retried.
7. **Extraction:** a synthetic 2-page PDF gives exactly 2 page rows with the right text and hashes; a scanned PDF and an image give `no_text`.
8. **Nothing changes elsewhere:** uploading and linking documents on every demo dispute leaves the analysis, readiness, draft, claim checks, checklist statuses, Insights and the Gemini request body identical.
9. **Injection:** a PDF whose text says "ignore previous instructions…" is stored and shown as plain text and is never in any Gemini request.
10. **XSS:** extracted text `<img src=x onerror=…>` renders as text; the page CSP is unchanged.
11. **Download headers:** `Content-Disposition: attachment`, a fixed `Content-Type`, `nosniff`, `CSP: sandbox`, `Cache-Control: no-store`.
12. **Delete:** cascades to the blob, pages and links; audit entries hold IDs only; a deleted document gets 404.
13. **Migration:** a v4 database upgrades to v5 with every audit row kept; v5 then refuses an older server.
14. **UI:** labels never say "verified"; a linked document still counts under "Needs attention"; keyboard upload works; errors are announced; no sideways scroll at 320px.

## 11. Open decisions and trade-offs

| # | Decision | Recommended default |
|---|----------|---------------------|
| D1 | Formats | PDF, PNG, JPEG only. No Office, HTML, SVG, HEIC or ZIP. |
| D2 | OCR in Stage 3 | No. Defer; it needs a heavy dependency and its text is error-prone. |
| D3 | Sandbox disputes | No. Storing documents against sandbox IDs breaks "sandbox disputes are never stored". |
| D4 | Retention | Kept until the merchant deletes; deleting the dispute or account cascades. Optionally a 30-day limit for the demo. |
| D5 | Can admin download originals? | No. Admin sees metadata and extracted text only, which keeps exposure smaller. |
| D6 | Encryption at rest | No for the local demo (the key would sit next to the database). Required before any real data. |
| D7 | Antivirus | None. Files are never run; the UI says files are not scanned. ClamAV only for a real deployment. |
| D8 | Storage | SQLite BLOB (section 6.1). |
| D9 | Parser dependency | `pdfjs-dist`, pinned, in a worker, eval off. Needs explicit approval under "no new dependencies unless needed". |
| D10 | Gemini on documents | None in Stage 3. In Stage 4, only matched excerpts, through the existing checks. |
| D11 | Limits | 5 MB per file, 20 pages, 10 files per dispute, 50 MB per account, 10-second extraction time limit. |

**Trade-offs:**
- **No OCR:** photos of receipts and scanned labels, the most common real evidence, give no text in Stage 3. They can still be attached and linked.
- **Demo-only:** keeps the guarantees intact, but the feature can't be shown on sandbox disputes.
- **BLOB storage:** simple and safe, but the database grows with every upload, and backups grow with it.

## 12. Git state

| | Before the audit | After the audit |
|---|---|---|
| Branch | `master` | `master` |
| HEAD | `7c2bed2` | `7c2bed2` |
| `origin/master` | in sync | in sync |
| Working tree | clean | one untracked file: `reports/phase-3.1-architecture-audit.md` (this report) |
| Stash | empty | empty |

No source, test, configuration, dependency, migration or database file was modified. Commands run: Git status and log, file listing, `grep`, and one read of `demo-accounts.json`.
