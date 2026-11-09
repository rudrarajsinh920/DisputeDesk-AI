# DisputeDesk AI: Stage 3.3 Secure PDF Text Extraction

**Date:** 2026-11-09
**Base:** `master` at `882f22e`, 4 commits ahead of `origin/master`.
**Status:** uncommitted, waiting for review.
- The real database was not migrated.
- PayPal and Gemini were not called.
- One approved dependency was added (`pdfjs-dist@6.4.299`).

## 1. Summary

Merchants' PDFs now have their text layer read in the background, in a separate worker thread with memory and time limits. The text is stored page by page, each page with a hash of its text.

- **Merchants:** they can open "Show text" on their own documents.
- **Admin:** reads the same text, read-only.
- **Buyers:** get 403.
- **Another merchant:** gets 404, the same answer as for a missing document.

Scanned PDFs and images end as `no_text`; there is no OCR. Malformed, encrypted, oversized, too-long or slow files end as `failed`.

No text reaches Gemini, and nothing about extraction changes an evidence status, readiness, the checklist, provenance or a draft.

## 2. Architecture

```
upload route ─▶ addDocument (PDF: "pending", image: "no_text")
             └▶ extractor.enqueue(id)            (after the 201 is sent)

createExtractor (extract.ts): one document at a time, in upload order;
  on start, queues every PDF still "pending" from an earlier run
    └▶ extractPdf(bytes) ─▶ new Worker(extract-worker.ts)
         resourceLimits: 128 MB old generation, 16 MB young, 4 MB stack
         env: {} (no API keys), stdout/stderr drained and discarded
         10 s time limit ─▶ worker.terminate()
         crash / exit / out of memory ─▶ "worker_failed"
    └▶ saveExtraction (store.ts): one transaction
         only if the document still exists and is still "pending"
         document_pages rows (page, text, text_sha256, method 'pdf_text')
         status "extracted" | "no_text" | "failed", page_count
         audit: document_extracted / document_extraction_failed (IDs and a fixed code only)

POST /api/documents/pages ─▶ getDocumentPages: owner merchant or admin, while the account has access
```

**The worker (`extract-worker.ts`)** uses the pdfjs legacy build.
- **Options:** `disableFontFace`, no system fonts, no XFA, no streaming or auto-fetch, `stopAtErrors`, no offscreen canvas or image decoder, `verbosity: 0`.
- **Limits:** more than 20 pages is refused before any page is read. More than 200,000 characters on a page, or 1,000,000 in the document, fails the document.
- **Cleaning:** text is normalised to NFC, with control and invisible formatting characters removed (bidi overrides, zero-width), keeping line breaks and tabs.
- **Encrypted PDFs** report `encrypted`; anything else unreadable reports `unreadable`.

## 3. Files changed

| File | Change |
|------|--------|
| `server/src/extract.ts` (new) | The extraction limits, `extractPdf` (worker runner) and `createExtractor` (queue that resumes on start). |
| `server/src/extract-worker.ts` (new) | Text-layer reading in the worker. Blocks `@napi-rs/*` from loading. |
| `server/src/test-pdfs.ts` (new) | Synthetic PDF builders for tests (text, dense text, empty, image-only, malformed, encrypted). There are no binary fixtures. |
| `server/src/extract.test.ts` (new) | 13 tests: the worker, the limits, failures, the queue, ownership and no side effects. |
| `server/src/store.ts` | `pendingPdfIds`, `pendingPdf`, `saveExtraction` and `getDocumentPages`. Images start as `no_text`. |
| `server/src/app.ts` | An `extractor` option, a queue after upload, and `POST /api/documents/pages`. The UUID check is shared. |
| `server/src/app.test.ts` | The role table, image status, the no-change test (now runs a real extraction first), an end-to-end test, and a restart test. |
| `shared/types.ts` | The `DocumentPage` type. |
| `client/src/Documents.tsx` | Status lines, a "Show text" view (page by page, plain `<pre>`, labelled unchecked), and refreshing every 2 s up to 15 times while a PDF is pending. |
| `client/src/analysis.ts` | `fetchDocumentPages`. |
| `client/src/styles.css` | Styles for the text box: wraps anywhere, scrolls inside the box, no inline styles. |
| `client/src/ui.test.ts` | Status lines, the text view (XSS shown as text, admin can read), and the endpoint allowlist. |
| `server/package.json`, `server/package-lock.json` | `pdfjs-dist` pinned at `6.4.299`. |

## 4. Migration

**None.** Migration v5 already has everything extraction needs:
- `documents.status` (`pending` / `extracted` / `no_text` / `failed`) and `page_count` (0–20);
- `document_pages` (text up to 200,000 characters, `text_sha256`, `method 'pdf_text'`);
- the audit events `document_extracted` and `document_extraction_failed`.

The migration history is unchanged and still ends at v6. The 1,000,000-character limit per document is checked in the worker, not by the database.

**Disposable-copy check:** I made a copy of the current real database with `VACUUM INTO`, opening the real one read-only.
- The copy upgraded v4 → v6, with 602 audit rows and integrity ok.
- I then uploaded two synthetic PDFs and read them on that copy.
- The copy was deleted afterwards.

**Real database and backups** (read-only check afterwards):

| File | Version | Audit rows |
|------|---------|-----------|
| `disputedesk.sqlite` | 4 (no document tables) | 602 |
| `disputedesk-v4-backup-2026-11-09.sqlite` | 4 | 602 |
| `disputedesk-v3-backup-2026-11-09.sqlite` | 3 | 602 |

The real database's main file and its `-wal` file kept their timestamps. Only the `-shm` file, SQLite's shared-memory index, was touched by the read-only open.

## 5. Dependency changes

- **Added:** `pdfjs-dist` `6.4.299`, pinned exactly (Apache-2.0, released 2026-10-03). It's the only new direct dependency, and `npm` reported 0 vulnerabilities.
- **Install command:** `npm install --save-exact --omit=optional pdfjs-dist@6.4.299`.
  - It left out `@napi-rs/canvas`, the native rendering package.
  - It also removed TypeScript 7's optional native package `@typescript/typescript-win32-x64@7.0.2`, which broke `tsc`. I restored that package from the npm registry tarball after checking that its sha512 matches the lockfile's `integrity` value.
  - Nothing else in `node_modules` was changed by hand.
- **Lockfile:** it lists the optional `@napi-rs/canvas` packages as `optional`. A later plain `npm install` would download them. The worker refuses to load them anyway (a `module.registerHooks` resolve hook), and they aren't needed for reading text.
- **Eval:** this pdfjs version has no `eval` or `new Function` code at all; the `isEvalSupported` option has been removed upstream. That's the class of bug behind CVE-2024-4367.

## 6. Security decisions

| Risk | Decision |
|------|----------|
| Hostile or malformed PDF | Parsed only in a fresh worker with memory limits and a 10 s limit. Each file can only fail its own document. No retry loop. |
| Decompression bomb, deep nesting | The worker's memory limit (128 MB old generation) and time limit. The upload limit stays 5 MB. |
| Too many pages, too much text | 20 pages (checked before reading any page), 200,000 characters per page, 1,000,000 per document. |
| Secrets reaching the parser | The worker gets an empty environment, and the test proves it. |
| Document text in logs | The worker's stdout/stderr are drained and discarded. Audit entries hold IDs and a fixed failure code only. The error log names the document ID only. |
| Stored XSS | The text is returned as JSON strings and rendered as React text inside `<pre>`. Nothing is parsed as HTML or Markdown, and the CSP is unchanged. Tests check that `<img onerror>` and `<script>` come out as text. |
| Prompt injection | No document text is sent to Gemini; the regression test checks the exact Gemini request bodies. |
| Privacy | The owner merchant and admin (read-only) can read the text. Another merchant gets 404, the same as a missing document; buyers get 403. Pages need dispute access, like the document list. |
| Facts from documents | The text is labelled "not checked against your records", and evidence statuses, readiness, checklist, provenance and drafts are unchanged (tested). |
| Deleted mid-read | Results are saved only if the document still exists and is still `pending`. Deleting a document cascades to its pages. |
| Restart mid-read | `pending` PDFs are queued again on start. |
| Native code | The worker refuses `@napi-rs/*`. |

## 7. Tests

| Check | Result |
|-------|--------|
| Server tests | 277 run, 277 passed (262 before, plus 13 extraction tests and 2 app tests) |
| Server typecheck | Exit 0 |
| Client tests | 110 run, 110 passed (108 before, plus 2) |
| Client typecheck | Exit 0 |
| Client production build | Built. Existing warning only: main chunk over 500 kB. |

**Coverage of the requested cases:**

| Case | Where |
|------|-------|
| Valid text PDF | `extract.test.ts` (exact text per page, hashes, 2 pages) and the app end-to-end test |
| Empty PDF | `extract.test.ts`: pages with no text, status `no_text` |
| Scanned / image-only PDF, images | `extract.test.ts` and `app.test.ts`: `no_text` |
| Malformed, encrypted, non-PDF | `extract.test.ts`: `unreadable`, `encrypted` |
| Oversized | The existing 413 upload test (over 5 MB), plus the per-page and per-document text limits |
| Too many pages | 20 allowed, 21 refused |
| Timeout | Real worker, 1 ms limit gives `timeout` |
| Worker failure | A crash, `process.exit` and running out of memory each give `worker_failed`. A rejected runner marks only its own document failed, and the queue goes on. |
| Unauthorized merchant | `extract.test.ts` and `app.test.ts`: 404, identical to a missing document |
| Buyer denied | `app.test.ts` and the role table: 403 |
| Readiness and Gemini unchanged | The no-change test now uploads a text PDF claiming tracking and delivery, waits for extraction, and compares analysis, checklist, list, draft (with Gemini request bodies), Insights, admin and buyer views. |

**Browser check** (on a throwaway copy, PayPal and Gemini off, outbound calls blocked):
- The text PDF shows "Text read from 2 pages". "Show text" shows Page 1 and Page 2, with `<img src=x onerror=alert(1)>` as text and no `<img>` element.
- The scanned PDF shows "No text found…".
- Readiness still shows "Key evidence 0 of 2".
- Buyer A gets 403 for the text, and the buyer list shows no document data.
- Merchant B gets 404.
- At 375px wide there's no sideways scroll.
- The console shows only my own probes' 4xx answers and the known 401s from the session check before sign-in. No script errors.

## 8. Known limitations

- **No OCR:** scanned PDFs and images stay `no_text`, as specified.
- **Off-page text is skipped:** pdfjs doesn't return text placed outside the page area, so it isn't stored.
- **Text order:** follows the PDF's content order. Multi-column layouts can read out of visual order.
- **Single-process queue:** one document at a time, in memory. A heavy file can delay others by up to 10 s each.
- **Polling limit:** the client refreshes 15 times, every 2 s. After about 30 s a reload is needed to see the result.
- **Failure detail:** the failure reason is kept in the audit log only. The UI shows a single "couldn't read" message.
- **Existing rows aren't re-read:** documents already marked `failed` aren't retried, and images uploaded before this change stay `pending`. There are none in the real database, which has no document tables yet.
- **The text is not verified.** Linking documents to checklist items, downloads and comparing facts with the records are Stage 3.4 and later.
- **Open from the 3.2 audit:** L3 to L8 still apply.

## 9. Git status

| Item | Value |
|------|-------|
| Branch | `master`, HEAD `882f22e`, 4 commits ahead of `origin/master`, not pushed |
| Modified | `client/src/Documents.tsx`, `client/src/analysis.ts`, `client/src/styles.css`, `client/src/ui.test.ts`, `server/package.json`, `server/package-lock.json`, `server/src/app.test.ts`, `server/src/app.ts`, `server/src/store.ts`, `shared/types.ts` |
| New | `server/src/extract.ts`, `server/src/extract-worker.ts`, `server/src/extract.test.ts`, `server/src/test-pdfs.ts`, this report |
| Not changed | `.env`, migrations, the demo data, the PayPal sandbox scripts, the real database, both backups, earlier reports |

Nothing is committed. Stage 3.4 has not been started.
