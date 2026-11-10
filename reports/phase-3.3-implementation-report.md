# DisputeDesk AI: Stage 3.3 Secure PDF Text Extraction

**Date:** 2026-11-09
**Base:** `master` at `882f22e`, 4 commits ahead of `origin/master`.
**Status:** committed as `58503f4`. The audit fixes in section 10 are uncommitted, waiting for review.
- The real database was not migrated.
- PayPal and Gemini were not called.
- One approved dependency was added (`pdfjs-dist@6.4.299`).

## 1. Summary

Merchants' PDFs now have their text layer read in the background, in a separate child process with memory and time limits. The text is stored page by page, each page with a hash of its text.

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
    └▶ extractPdf(bytes) ─▶ spawn(node --max-old-space-size=128 extract-worker.ts)
         bytes sent over IPC; env: {} (no API keys); stdout/stderr ignored
         10 s time limit ─▶ child.kill("SIGKILL")
         crash / exit / out of memory ─▶ "worker_failed"
    └▶ saveExtraction (store.ts): one transaction
         only if the document still exists and is still "pending"
         document_pages rows (page, text, text_sha256, method 'pdf_text')
         status "extracted" | "no_text" | "failed", page_count
         audit: document_extracted / document_extraction_failed (IDs and a fixed code only)

POST /api/documents/pages ─▶ getDocumentPages: owner merchant or admin, while the account has access
```

**The worker (`extract-worker.ts`)** runs in its own child process, one per PDF, and uses the pdfjs legacy build. A process rather than a worker thread: the memory pdfjs uses to decompress a file sits outside the JavaScript heap limit, so a file that inflates to gigabytes must be able to crash only its own process (audit finding F1, section 10).
- **Options:** `disableFontFace`, no system fonts, no XFA, no streaming or auto-fetch, `stopAtErrors`, no offscreen canvas or image decoder, `verbosity: 0`.
- **Limits:** more than 20 pages is refused before any page is read. More than 200,000 characters on a page, or 1,000,000 in the document, fails the document.
- **Cleaning (`cleanText` in `extract.ts`):** text is normalised to NFC. Control characters and the bidi embeddings, overrides and isolates (U+202A–202E, U+2066–2069) are removed; line breaks and tabs are kept. Joiners (ZWJ, ZWNJ), direction marks (LRM, RLM, ALM) and soft hyphens are kept, because Indic, Persian and Arabic text and emoji need them (audit finding F2).
- **Not byte-exact:** pdfjs itself applies NFKC to ligatures and Arabic presentation forms, and puts right-to-left text in reading order.
- **Encrypted PDFs** report `encrypted`; anything else unreadable reports `unreadable`.

## 3. Files changed

| File | Change |
|------|--------|
| `server/src/extract.ts` (new) | The extraction limits, `cleanText`, `extractPdf` (child-process runner) and `createExtractor` (queue that resumes on start). |
| `server/src/extract-worker.ts` (new) | Text-layer reading in the worker. Blocks `@napi-rs/*` from loading. |
| `server/src/test-pdfs.ts` (new) | Synthetic PDF builders for tests (text, dense text, empty, image-only, malformed, encrypted, decompression bomb). There are no binary fixtures. |
| `server/src/extract.test.ts` (new) | 15 tests: the worker, the limits, failures, a decompression bomb, multilingual cleaning, the queue, ownership and no side effects. |
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
| Hostile or malformed PDF | Parsed only in a fresh child process with a memory limit and a 10 s limit. Each file can only fail its own document. No retry loop. |
| Decompression bomb, deep nesting | Parsed in its own process, so running out of memory ends only that process, never the server; the 10 s limit caps how long it can grow. The 128 MB heap limit does not cover decompression buffers. The upload limit stays 5 MB. |
| Too many pages, too much text | 20 pages (checked before reading any page), 200,000 characters per page, 1,000,000 per document. |
| Secrets reaching the parser | The worker gets an empty environment, and the test proves it. |
| Document text in logs | The worker's stdout/stderr are ignored. Audit entries hold IDs and a fixed failure code only. The error log names the document ID only. |
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
| Server tests | 279 run, 279 passed (262 before, plus 15 extraction tests and 2 app tests) |
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
| Decompression bomb | About 64 KB inflating to 64 MB: parsed, and the server grows by less than 40 MB |
| Multilingual text | `cleanText` keeps Gujarati, Hindi, joined conjuncts, Persian ZWNJ, emoji sequences, Hebrew and Arabic marks, Tamil and ligatures; removes bidi overrides, isolates and control characters |
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
| Branch | `master`, HEAD `58503f4` (Stage 3.3), 5 commits ahead of `origin/master`, not pushed |
| Modified since `58503f4` (audit fixes) | `server/src/extract.ts`, `server/src/extract-worker.ts`, `server/src/extract.test.ts`, `server/src/test-pdfs.ts`, this report |
| Not changed | `.env`, migrations, the demo data, the PayPal sandbox scripts, the real database, both backups, earlier reports |

The audit fixes are not committed. Stage 3.4 has not been started.

## 10. Audit fixes (2026-11-10)

An independent audit of `58503f4` gave PASS WITH CONDITIONS, with two findings to fix before closing Stage 3.3.

| Finding | Problem | Fix | Evidence |
|---------|---------|-----|----------|
| F1 (Medium) | A worker thread's heap limit does not cover the buffers pdfjs uses to decompress a file. A 255 KB PDF inflating to 256 MB pushed the whole server from 318 MB to 891 MB, so a file of a few MB could exhaust memory and crash the server. | Each PDF is parsed in its own child process (`spawn` with `--max-old-space-size=128`, bytes over IPC, empty environment, output ignored, killed at 10 s). Out of memory now ends only that process. | The same 256 MB bomb leaves the server at 319 MB. New test: a 64 MB bomb grows the server by less than 40 MB. |
| F2 (Low) | The cleaner removed every Unicode format character (`\p{Cf}`), including ZWJ and ZWNJ (Hindi, Gujarati and Persian text, emoji sequences), the RLM and ALM direction marks, and soft hyphens. | Only control characters and the bidi embeddings, overrides and isolates (U+202A–202E, U+2066–2069) are removed. The cleaner is now `cleanText` in `extract.ts`. | New multilingual test. |

**Other audit findings, left as documented:**
- **The worker is not a security boundary:** the child process can still read files, use the network and start processes. The empty environment and the `@napi-rs` block are only extra layers of protection. The actual protection is that pdfjs runs no code from the PDF. That is fine for synthetic data; real customer documents need an OS-level sandbox.
- **Retries:** a save that throws leaves the document `pending` and runs it again on every start, with no retry cap.
- **Ordering:** documents are read one at a time, so a slow file delays the ones after it.
- **Client:** it stops polling after 30 s, so a long-running read needs a reload to show its result.
- **Stage 3.2 images:** images stored as `pending` by Stage 3.2 stay `pending`. None exist in the real database.
- **Advisories:** pdfjs security advisories were not checked online.

**Checks after the fixes:**
- Server tests: 279 run, 279 passed.
- Client tests: 110 run, 110 passed.
- Both typechecks exit 0.
- The production build succeeds (existing chunk-size warning only).

**What changed in the design:** each document now costs a process start (about 0.2–0.6 s). The empty environment was tested on Windows only.
