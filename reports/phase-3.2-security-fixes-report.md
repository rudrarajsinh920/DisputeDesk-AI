# DisputeDesk AI: Stage 3.2 Final Security Fixes (M3, L1, L2)

**Date:** 2026-11-09
**Base:** `master` at `06ae2a1`, 2 commits ahead of `origin/master`. The request said `92d3196`; the M1 and M2 audit fixes were committed on top of it as `06ae2a1` before this work.
**Source:** `reports/phase-3.2-release-audit.md`, findings M3, L1 and L2. Only those three are implemented here.
**Status:** uncommitted. The real database was not migrated. PayPal and Gemini were not called. No dependency was added.

## 1. Summary

| Finding | Fix | Result |
|---------|-----|--------|
| M3: ownership not enforced by the database | Migration v6 adds a `BEFORE INSERT` trigger on `documents` | Done |
| L1: body read before the access check | The dispute access check runs before `express.raw` | Done |
| L2: compressed bodies accepted | `inflate: false` on the upload parser, and a 415 answer for compressed bodies | Done |

The M1 wording and the M2 regression test are unchanged, and both still pass.

## 2. Changes

| File | Change |
|------|--------|
| `server/src/db.ts` | Migration 6, "documents: only a merchant with access to the dispute may own one" (v5 is unchanged). |
| `server/src/app.ts` | Upload route: a new middleware loads the dispute from `X-Dispute-Id` with `findDispute`, after the role, type and rate checks and before `express.raw`. `express.raw` gets `inflate: false`. The error handler maps `encoding.unsupported` to 415 `unsupported_content_encoding`. |
| `server/src/store.test.ts` | The v4-to-v5 test now stops at v5. A new v6 test covers the trigger, the upgrade and re-seeding. `addDocument` is imported. |
| `server/src/app.test.ts` | The sandbox test now expects the trigger's error (it fires before the foreign key). Two new tests cover L1 and L2. `gzipSync` is imported from `node:zlib`. |

### M3: the trigger in migration v6

```sql
CREATE TRIGGER documents_owner_check BEFORE INSERT ON documents
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND role = 'merchant')
  OR NOT EXISTS (SELECT 1 FROM dispute_access WHERE account_id = NEW.account_id AND dispute_id = NEW.dispute_id)
BEGIN
  SELECT RAISE(ABORT, 'document owner constraint failed: the account must be a merchant with access to the dispute');
END;
```

- **Error:** `RAISE(ABORT)` gives `SQLITE_CONSTRAINT_TRIGGER`. The statement is rolled back, and `addDocument`'s transaction rolls back with it, so no blob and no audit row are written.
- **No cascade:** there is no foreign key to `dispute_access`. Seeding still deletes and re-grants each account's access rows, and documents stay.
- **Existing rows:** not rechecked, because a trigger runs only on new inserts. The real database has no documents, so this only affects databases that already ran v5.

### L1: the order of the upload route

1. `requireRole("merchant")`
2. declared type on the allowlist (415)
3. rate limit, counted per attempt (429)
4. **new:** `findDispute({ source: "demo", dispute_id: X-Dispute-Id })`: 400 when the ID is missing or invalid, and 404 when the dispute is unknown or can't be reached. The 404 is the same for both, and a denied existing dispute is audited as `dispute_access_denied`.
5. `express.raw({ limit: 5 MB, inflate: false })` (413 or 415)
6. empty body (400), then the signature check (415)
7. `addDocument`, which checks the limits and is now backed by the trigger

The dispute loaded in step 4 is passed on in `res.locals`, so the handler doesn't look it up again.

**Behaviour change:** for a dispute the merchant can't reach, a request with an empty or mislabelled body now gets 404 rather than 400 or 415. That is deliberate: the dispute is checked first, so a file is never read for an unreachable dispute.

### L2: compressed bodies
- With `inflate: false`, body-parser refuses any `Content-Encoding` other than `identity`.
- That error now returns 415 `{ code: "unsupported_content_encoding", message: "Send the request body uncompressed." }`. Before, it fell through to the generic 500.
- The JSON routes keep their default parser settings. An unknown encoding on them now also returns 415 rather than 500.

## 3. Tests

### New and changed tests

**`store.test.ts`: "version 6: only a merchant with access to the dispute can own a document, and re-seeding keeps documents"**
- **The upgrade:** a v5 database with one document upgrades to v6. The audit log is unchanged and the document is kept.
- **Allowed:** merchant-a with access, by direct insert and through `addDocument`.
- **Refused, each with "document owner constraint failed":**
  - a merchant without access (merchant-a on DEMO-1003);
  - a buyer who has access (buyer-a on DEMO-1001);
  - another merchant (merchant-b on DEMO-1001);
  - admin;
  - an unknown account.
- **The store's insert:** `addDocument` for merchant-b also throws, and leaves no audit row and no blob.
- **Restart:** `seedDemo` runs twice. All three documents stay, and the trigger still refuses.

**`app.test.ts`: "an upload to a dispute the merchant can't reach is refused before the body is read, exactly like a missing one"**
- **How:** the request declares `Content-Length: 5 MB`, sends only the 9-byte PDF fixture, and never finishes. The client gives up after 5 s. A server that read the body first would never answer, so the test would fail.
- **Results:**
  - merchant-b on DEMO-1001 gets 404, with the same body as the unknown DEMO-9999;
  - `dispute_access_denied` is audited for merchant-b on DEMO-1001;
  - no `X-Dispute-Id` gets 400;
  - buyer-a and admin get 403;
  - no documents are stored.

**`app.test.ts`: "compressed upload bodies are refused; plain PDF, PNG and JPEG uploads still work"**
- A gzipped PDF with `Content-Encoding: gzip` gets 415 `unsupported_content_encoding`, and nothing is stored.
- `Content-Encoding: identity` with a PDF gets 201.
- A plain PNG and a plain JPEG get 201.

**Changed tests:**
- The sandbox test's direct insert of `PP-D-1` now matches `/constraint failed/`. The trigger fires before the foreign key, and the row is still refused.
- The v4-to-v5 store test runs `MIGRATIONS.slice(0, 5)` and expects version 5.

### Full results

| Check | Result |
|-------|--------|
| Server tests | 262 run, 262 passed (259 before, plus 3 new) |
| Server typecheck | Exit 0 |
| Client tests | 108 run, 108 passed |
| Client typecheck | Exit 0 |
| Client production build | Built. Existing warning only: main chunk over 500 kB. |
| M1 (`claims.test.ts`) and M2 (the extended no-regression test) | Pass |

### Migration on a scratch database
A scratch copy was made of `disputedesk-v4-backup-2026-11-09.sqlite` (opened read-only, copied with `VACUUM INTO` into the session scratchpad). It was migrated in two steps, then deleted.

| Step | Version | Audit rows | Integrity | Foreign key problems |
|------|---------|-----------|-----------|----------------------|
| Start | 4 | 602 | ok | 0 |
| After v5 | 5 | 602 | ok | 0 |
| After v6 | 6 | 602 | ok | 0 |

After v6, the trigger exists, `DELETE FROM audit_log` is still refused (append-only), and a merchant-b document on DEMO-1001 is refused with the trigger's message.

### Real database and backups (read-only check after the work)

| File | Version | Audit rows | Last modified |
|------|---------|-----------|---------------|
| `disputedesk.sqlite` | 4 | 602 | unchanged (Nov 6) |
| `disputedesk-v4-backup-2026-11-09.sqlite` | 4 | 602 | unchanged (19:58) |
| `disputedesk-v3-backup-2026-11-09.sqlite` | 3 | 602 | unchanged (14:44) |

## 4. Remaining risks

- **The trigger covers INSERT only.** An `UPDATE` of `account_id` or `dispute_id` isn't checked. No code updates those columns. A `BEFORE UPDATE OF account_id, dispute_id` trigger would close this; it was left out because the scope here was INSERT.
- **Existing rows are not rechecked.** The same goes for an account whose role or access changes later. L3 is still open: documents on a dispute an account can no longer reach are hidden, still count toward its 50 MB, and can't be deleted by the merchant.
- **The L1 test reasons about the old code rather than running it.** I didn't revert `app.ts` to watch the test fail. The test only passes if the server answers before reading the 5 MB body.
- **Unread bodies on refusal.** Node discards the rest of a refused upload, and may close the connection. Nothing is buffered.
- **Next real start.** Starting the server with this code moves the real database from v4 straight to v6. The v4 backup is the way back.
- **Still open from the audit:** L3 to L8, including polyglot handling for the 3.4 download route and the filename `Cf`/bidi notes.

## 5. Git status

| Item | Value |
|------|-------|
| Branch | `master`, HEAD `06ae2a1`, 2 commits ahead of `origin/master`, not pushed |
| Before this work | Clean |
| Modified | `server/src/app.test.ts`, `server/src/app.ts`, `server/src/db.ts`, `server/src/store.test.ts` (+147 / −8) |
| Untracked | This report |
| Not changed | `.env`, dependencies, the client, the demo data, the PayPal sandbox scripts, the real database, both backups, every earlier report |

Nothing is committed. Waiting for review.
