# DisputeDesk AI: Stage 3.5 Final Regression, Privacy and Release Audit

**Date:** 2026-11-10
**Base:** `master` at `d3db9f7`, 8 commits ahead of `origin/master`, not pushed.
**Verdict:** **PASS WITH CONDITIONS.** No critical, high or medium finding is open. The project is **not release-ready**:
the demo video does not exist yet (release blocker), and the saved file name of a download has not been checked in
Chrome, Edge or Firefox.

Nothing was committed, pushed or deployed. The real database and both backups were never opened (SHA-256 identical
before and after). PayPal and Gemini were not called. No dependency was added.

## 1. Tools used

| Tool | Used for |
|------|----------|
| Bash, node | Git inspection, code reading, test runs, typechecks, build, scratch database copies, migration checks, hashes, secret scan |
| Desktop app built-in browser | Every browser check in §4, including a real Download click |
| Vite dev server (`.claude/launch.json` "client") | The page, proxied to a scratch API server |
| Scratch API server (scratchpad script) | A file copy of the real database, PayPal and Gemini off, every outbound `fetch` blocked |

Installed but not used: subagents (`ecc:security-reviewer`, `ecc:code-reviewer`, `ecc:e2e-runner`), design and testing
skills. `chrome-devtools` failed to connect. Nothing was installed or enabled.

## 2. Phase A: baseline

| Item | Value |
|------|-------|
| Branch, HEAD | `master`, `d3db9f7` |
| Stage 3.4 commits | `f31d059` and `d3db9f7`, both present |
| Uncommitted at start | `reports/phase-3.4-implementation-report.md` (the report update), kept |
| Schema | Migrations 1–6 in `server/src/db.ts`. The real database is at **version 4** (602 audit rows): the next start of this server will migrate it to 6. Back it up first (a v4 backup already exists). |
| Tests at start | Server 282, client 115 |
| Docs | README and the Devpost copy predated Stages 3.3 and 3.4 (§5, finding D1) |

## 3. Phase B: regression audit (code and tests)

| Area | Result | Evidence |
|------|--------|----------|
| Evidence statuses from fixed rules; missing and conflicting shown as such; confirmations change nothing; readiness is counts only | Holds | `evidence.ts`, `checklist.ts`; the no-change test (analysis, checklist, list, draft, Insights, admin, buyer views and exact Gemini requests compared with every document linked to every gap) |
| AI lines checked against records | Holds | `assist.ts` checks; AI routes build their input only from `buildAiRequest(dispute, analysis)` (`app.ts` ~752) |
| Upload limits (type by first bytes, 5 MB, 10 per dispute, 50 MB per account, duplicates) | Holds | Server tests |
| PDF extraction (encrypted, unreadable, scanned, oversized, too many pages, decompression bomb, timeout) | Holds | `extract.test.ts`; a failed read is stored as `failed` with a fixed code; `saveExtraction` ignores a file deleted mid-read |
| Extracted text treated as untrusted | Holds | Rendered as text; label "Text as written in the file…" |
| Links: own documents, gaps only, stale links removable, no effect on evidence | Holds | Server tests incl. the repeated, stale and racing test |
| Download: exact bytes and safe headers | Holds | Server tests (SHA-256 for PDF, PNG, JPEG, 5 MB; hostile names) and the browser check |
| Access: buyer, other merchant, admin | Holds | Role table test for every route; store queries join `dispute_access` |
| Deletion removes text and links | Holds | Foreign keys with cascade, `PRAGMA foreign_keys = ON`; tested |
| Audit entries | IDs and fixed codes only, never names or text | `store.ts` audit calls (lines 260–402) |
| Document text or links reach Gemini | Never | `assist.ts`, `buyer.ts`, `intelligence.ts` import no document code |
| PayPal | Read-only (token and GET) | Unchanged |

## 4. Phase C: browser check (scratch database, synthetic files)

The scratch server ran on a file copy of the real database (it migrated v4 → v6, integrity ok, no foreign-key errors).

| Check | Result |
|-------|--------|
| Merchant A sign-in, DEMO-1001 | Works |
| PDF upload (synthetic, 2 pages, 981 bytes) | "Text read from 2 pages." |
| Show text | Pages 1 and 2 shown as written, with the untrusted-text label |
| Link to Shipping tracking | "Linked to: Shipping tracking (not verified)"; checklist row tag "Document attached, not verified"; "Needs attention: 2 (0 merchant-confirmed, 1 with a document attached)"; readiness still "Key evidence 0 of 2" |
| Unlink | Tag and count suffix gone |
| **Download button clicked** | `POST /api/documents/download` 200. The file was saved to the Downloads folder: 981 bytes, SHA-256 `bb9f604d…09e5`, identical to the upload. The page did not open or show it; "… handed to your browser's downloads." was announced. **The built-in browser saved it as `38af6b9b-…-94864179c001.tmp`, not under the file's name**, so the saved name is unverified (condition C2). |
| Delete | List and checklist both updated; focus stays in the section (the delete confirmation was accepted by the test) |
| Malformed PDF | "DisputeDesk couldn't read text from this file."; the server kept running |
| Buyer A | No document information on screen; every document route and the checklist answer 403 |
| Admin | Sees the file, its owner and "Linked to"; no checkbox, Download, Delete or upload; download and link answer 403 |
| Merchant B | Another merchant's dispute: 404 `dispute_not_found`. Own dispute with Merchant A's document ID: the same 404 `document_not_found`, byte for byte, as a random ID, on download, text, link and delete |
| 375 px | No sideways page scroll (only the case tabs scroll, as designed). Finding U1: the "Link to checklist gaps" toggle was 21 px tall; fixed, now 45 px |
| Server stopped | Download: "Couldn't download that. The DisputeDesk server is not responding… (HTTP 502)"; unlink: "Couldn't save that…", the checkbox keeps the server's state |
| Console | Only the 401, 403, 404 and 502 answers caused on purpose above; no script errors |
| Checklist request ordering | Can't be forced in a browser; covered by the `checklistGate` unit test |

## 5. Phase D: findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| D1 | Medium (docs) | README said DisputeDesk does not read document text and that files can't be downloaded or linked; the audit-log list and limits left out Stages 3.3–3.4; no extraction limits were documented. Devpost said "316 automated tests" and said nothing of text, links or downloads. | Fixed (§6) |
| U1 | Low (accessibility) | "Link to checklist gaps" toggle 21 px tall at every width, below the 24 px minimum target. Root cause: no padding on the `summary`. | Fixed: `padding: 12px 0` (`styles.css`), measured 45 px; regression test added |
| C1 | Release blocker | No demo video: the Devpost link is still "(YouTube link here)". | Open: needs the video |
| C2 | Low (verification gap) | The real Download click saved exact bytes, but the built-in browser named the file with a random `.tmp` name, so the `download` attribute's file name was not observed in a standard browser. | Open: check once in Chrome |
| I1 | Info | The real database is at version 4; the next server start migrates it to 6. Migrating copies of both backups (v3 and v4) to 6 kept all 602 audit rows with integrity ok. | Back up before the next start |
| I2 | Info | Memory pdfjs uses outside the JavaScript heap has no operating-system cap (a hostile PDF can use a lot of memory for up to 10 s); the child-process cleanup is tested on Windows only. | Documented in README Limits |
| I3 | Info | Files are stored unencrypted in SQLite and not virus-scanned. | Documented |

No critical or high findings. No change needed a new feature, dependency, real-database migration or redesign.

## 6. Phase E: documentation changes

**README.md**
- Intro: statuses come from records only; uploaded files are stored and read, never checked or counted.
- New bullet on merchant documents, a pdfjs-dist row in Tools used, and a new **Documents** section: upload limits,
  text reading and its limits (child process, 128 MB heap, 10 s, 20 pages, no OCR), linking, download headers, delete,
  and who sees what.
- Audit log: extraction, link, unlink and download events; IDs only, never file names or text.
- Demo step 2: Show text, link, download.
- Limits: no document verification, no OCR, no encryption at rest, no virus scan, the child-process limits, the
  Windows-only cleanup test, and that the saved download name has not been checked in Chrome, Edge or Firefox.

**reports/devpost-description.md**
- Documents: text reading (no OCR), links as the merchant's statement, downloads, nothing changes a status or reaches Gemini.
- How we built it: pdfjs-dist in a child process; test count corrected to 398 (282 server, 116 client).
- The video link is left as a placeholder (C1).

Claims checked against the code: no OCR, verification, automatic submission, automatic resolution, guaranteed outcome,
production-grade security or encryption at rest is claimed. Demo and PayPal sandbox data stay clearly separated.

## 7. Phase F: final release checks (all run)

| Check | Result |
|-------|--------|
| Server tests | 282 run, 282 passed |
| Client tests | 116 run, 116 passed (115 plus the U1 test) |
| Server typecheck | No errors |
| Client typecheck | No errors |
| Production build | Built (existing chunk-size warning only) |
| Migration from v3 (backup copy) | v3 → v6, 602 audit rows kept, `integrity_check` ok, `foreign_key_check` empty |
| Migration from v4 (backup copy, and the real database's copy) | v4 → v6, same result |
| Secret scan of the diff | No secrets or demo passwords; matches were the words "secrets" and "token" in README text |
| Real database and backups | SHA-256 identical to the baseline taken at the Stage 3.4 audit |
| Privacy and access regression | Role table, cross-account 404 and no-change tests pass; browser checks in §4 |

## 8. Git and data state

| Item | Value |
|------|-------|
| Branch, HEAD | `master`, `d3db9f7`, 8 ahead of `origin/master`, not pushed |
| Uncommitted | `README.md`, `client/src/styles.css`, `client/src/ui.test.ts`, `reports/devpost-description.md`, `reports/phase-3.4-implementation-report.md` (from before this stage), and this report (new) |
| Left outside the project | The downloaded test file in the Downloads folder (`38af6b9b-d101-4a50-aec0-94864179c001.tmp`, synthetic); scratch copies in the session scratchpad |

## 9. Definition of done

| # | Item | Status |
|---|------|--------|
| 1 | Critical and high findings resolved | None found |
| 2 | No open medium affecting privacy, security, evidence or data | Met |
| 3 | Merchant, buyer and admin workflows pass | Met (browser and tests) |
| 4 | Actual download verified in a browser | Met for the bytes; the saved name is open (C2) |
| 5 | Document content isolated from Gemini and evidence | Met |
| 6 | Tests, typechecks and build pass | Met |
| 7 | README and Devpost match the implementation | Met, except the missing video link |
| 8 | Remaining limitations documented | Met |
| 9 | Git and database state preserved and reported | Met |

## 10. Needs manual approval or action

1. Record the demo video and replace "(YouTube link here)" in `reports/devpost-description.md` (release blocker).
2. Download a file once in Chrome and check its saved name (C2).
3. Back up `server/data/disputedesk.sqlite` before the next server start, which migrates it from version 4 to 6.
4. Commit this stage's changes, and push when ready.
