# DisputeDesk AI: Stage 2.2 Verification and Release Audit

**Date:** 2026-11-09
**Scope:** Stage 2.2a (`c841345`, `c6ae9c2`) and Stage 2.2b (`771c99e`).
**Method:** read-only review of the diffs and the current code, plus the existing tests, typechecks and build. No source code, database, report or Git state was changed. No PayPal or Gemini request was made.

## Final verdict: READY WITH CONDITIONS

No critical or high findings. Two conditions before release:

1. **Back up the real database before the first start of `771c99e`.** It is at schema v3 today and moves to v4 one-way (finding M2).
2. **Decide on the "Needs attention" count** (finding M1): accept it as designed, or keep confirmed gaps inside that count.

## 1. Git state

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD | `771c99e79afee82f79c4fab4639a8c55eaf7d3cd` |
| Working tree | Clean. No modified or untracked files, before and after the audit. |
| Stash | Empty |
| `origin/master` | `56108a0` |
| Unpushed commits | `c841345` (2.2a and the 2.2 design audit), `c6ae9c2` (Devpost copy and the "counts only" sentence), `771c99e` (2.2b and its report) |

The client build wrote `client/dist/`, which is git-ignored. Nothing else was written.

## 2. Stage 2.2a verification

| Item | Result | Evidence |
|------|--------|----------|
| Structured evidence source labels | **Verified** | `ChecklistItem.where` is `{ kind: SourceKind; text }[]` (`shared/types.ts`). There are 8 kinds. Every entry in `server/src/checklist.ts` has a kind. The client renders them as "Carrier or shipping:", "PayPal or payment account:", and so on (`SOURCE_LABELS`). No kind suggests that DisputeDesk opens the system. |
| "Not shown by records" wording | **Verified** | `CHECKLIST_STATUS.needs_confirmation.label` is "Not shown by records". The old label "Confirm from your records" no longer appears in the client. |
| Conflicting-evidence guidance | **Verified** | `CONFLICT_NOTE` ("The records disagree on this item. Check each record at its source before adding either one.") is added to the limits of conflicting items only. `NOT_PROOF` is added to missing items only. A test checks that each appears only for its status. |
| Checklist overview counts | **Verified** | Counts only, no score or share. `c6ae9c2` added "Counts only: review each item before you respond." 2.2b extended the line to "Needs attention · Merchant-confirmed · Record available · Conflicting". |
| Four more dispute-reason fixtures | **Verified** | DEMO-3001 `INCORRECT_AMOUNT`, DEMO-3002 `PAYMENT_BY_OTHER_MEANS`, DEMO-3003 `CANCELED_RECURRING_BILLING`, DEMO-3004 `PROBLEM_WITH_REMITTANCE`. They are reachable only by the new synthetic "Demo Merchant D" (`paypal_sandbox: false`). The README lists the account. |

## 3. Stage 2.2b code review

### 3.1 Migration v4

- It adds `gap_confirmations` and an index, and rebuilds `audit_log` with the two new events. It is appended at the end; v1 to v3 are unchanged.
- `migrate` runs each migration inside `BEGIN IMMEDIATE`. If v4 fails, nothing is applied and the server refuses to start.
- The audit-log rebuild copies every row with its id and recreates the append-only triggers. This is the same helper v2 and v3 use. A test upgrades a v3 database and checks that every audit entry survives.
- **No rollback.** There is no down migration. After v4, an older server throws "The database schema (version 4) is newer than this server (version 3)" and won't start. The only way back is a file backup taken before the upgrade.
- The real database `server/data/disputedesk.sqlite` is at **v3** (read in read-only mode during this audit). It was not migrated.

### 3.2 Constraints and foreign keys

- `PRAGMA foreign_keys = ON` is set in `openDatabase`, so the foreign keys and cascades are enforced.
- `account_id → accounts(id) ON DELETE CASCADE` and `dispute_id → disputes(dispute_id) ON DELETE CASCADE`. `disputes` only ever holds demo records, so a sandbox dispute ID can't be stored. A test checks this.
- `item_id` has a CHECK for 1 to 40 characters of `[a-z_]` only. The route applies the same pattern.
- The primary key `(account_id, dispute_id, item_id)` gives one row per account per item. The table is `STRICT, WITHOUT ROWID`. It has no free-text column.
- Seeding keeps confirmations:
  - `seedDemo` and `writeAccount` use `ON CONFLICT DO UPDATE`, not `REPLACE`, so a restart does not cascade-delete confirmations.
  - Removing a dispute or account from the demo files does delete its confirmations.
  - `writeAccount` deletes and re-adds `dispute_access`. Confirmations don't reference that table, so they survive. Reads join it, so they require current access.

### 3.3 Transaction integrity

- `confirmGap` and `withdrawGap` each write the row and the audit entry in one transaction. An audit entry is written only when a row changed (`changes > 0`), so a repeat or a no-op leaves no event.
- The checklist is rebuilt and the write runs synchronously in one request handler, with no `await` in between, so there is no window where the item can change between the check and the write.

### 3.4 Audit log

- New events: `gap_confirmed` and `gap_confirmation_withdrawn`. Each holds `account_id`, `dispute_id` and `detail = item_id`. No text or secrets.
- The log is still append-only (triggers recreated). A test checks the event sequence for confirm, repeat, withdraw and re-confirm.
- See L2 on volume.

### 3.5 Confirm and withdraw route: `POST /api/analysis/checklist/confirm`

Order of checks:
1. Merchant role (`requireRole("merchant")`).
2. Body of 1 kB at most.
3. `item_id` must match `^[a-z_]{1,40}$` and `confirmed` must be a boolean. Otherwise 400.
4. `source === "paypal_sandbox"`: 409, with no lookup.
5. `findDispute`, which validates the lookup, checks access and returns the same 404 for a missing dispute or another account's.
6. A confirm needs an item that is in the checklist and currently confirmable (`missing` or `needs_confirmation`). Otherwise 409.
7. A withdraw is always allowed, but only deletes the caller's own row.

What this means:
- Step 3 runs before the access check, but its answer doesn't depend on the dispute, so it reveals nothing about which disputes exist.
- The 409 in step 6 comes only after access is granted, so it can't be used to probe other accounts' disputes.

### 3.6 Access controls

| Role | Checklist read | Confirm or withdraw |
|------|----------------|---------------------|
| Signed out | 401 | 401 |
| Merchant, own demo dispute | Own confirmations only | Allowed for gaps |
| Merchant, another account's dispute | 404, identical to a missing dispute | 404, audited as `dispute_access_denied` |
| Admin | Every account's confirmations | 403 (read-only) |
| Buyer | 403 | 403 |

The role table test lists the new route with `[403, 200, 404, 403, 403]`. The account always comes from the server session.

### 3.7 Cross-account privacy

- `listConfirmations` filters by `account_id` for merchants. Admin passes `null`.
- The query joins `dispute_access`, so a confirmation from an account that lost access is not returned to anyone.
- A merchant never receives another merchant's account ID or display name. A test covers this.

### 3.8 Stale confirmations

- `checklistFor` returns only confirmations whose item is currently `missing` or `needs_confirmation`. A confirmation on an item that became available, became conflicting, or left the reason's list is kept in storage but not shown or counted. A test covers this.
- The server allows withdrawing a stale confirmation. The UI does not offer it (see L4).

### 3.9 Gemini, Insights and buyer isolation

- `gap_confirmations`, `listConfirmations` and `confirmations` appear only in `store.ts`, `app.ts` (`checklistFor` and the confirm route), `shared/types.ts`, `client/src/analysis.ts` and `client/src/AnalysisPanel.tsx`.
- `assist.ts`, `buyer.ts`, `intelligence.ts`, `provenance.ts`, `evidence.ts` and `shared/readiness.ts` never read them. The only "confirmation" hits in `intelligence.ts` are the pre-existing words "order confirmations".
- The checklist and confirm routes are not open to buyers.
- A test confirms every gap on every demo record and checks that the analysis, readiness, draft, claim checks, checklist items, Insights and the Gemini request body are identical before and after.

### 3.10 PayPal sandbox isolation

- A sandbox request is refused in step 4, before `findDispute`, so `paypal.listDisputes` and `getDisputeDetails` are never called. A test with a mocked PayPal client checks this.
- The `disputes` foreign key refuses sandbox IDs at the database level, as a second guard.
- `checklistFor` returns `confirmations: []` for sandbox disputes without querying.
- The client shows the button only when `dispute.source === "demo"`.

### 3.11 Client accessibility and error handling

- **Button:**
  - It's a real `<button>` with `aria-pressed` and a label that never changes ("I have this in my records").
  - While its request is in flight it has `aria-disabled`.
  - It has 44px targets on coarse pointers.
  - The pressed state shows a ✓ as well as a colour change.
- A polite live region (`role="status"`) announces "Confirmation recorded." or "Confirmation withdrawn." Focus stays on the button.
- On failure, a `role="alert"` message reads "Couldn't save that. …". The screen is redrawn only from the server's answer, never optimistically, so a failed save changes nothing.
- The strict CSP is kept: no inline styles.

### 3.12 Can a confirmation be mistaken for system-verified evidence?

Mostly no. These safeguards are in place:
- The status badge never changes. A confirmed gap still reads "Missing from records" or "Not shown by records".
- "Merchant-confirmed" is a separate tag with a dashed outline and no fill. It looks unlike the green "Available in records" badge and the "PayPal-documented" tag.
- A confirmed gap is never counted as "Record available".
- The analysis, readiness, draft markers and claim checks ignore confirmations, so the draft still asks for merchant input.
- Admin sees "Merchant-confirmed by {name}, {date}. DisputeDesk has not seen the record."
- The count line ends with "Counts only: review each item before you respond."

The remaining risks are M1 (the "Needs attention" count drops to 0) and L1 (the merchant's caveat is behind a disclosure).

## 4. Security findings

No new vulnerability found.
- Parameterised SQL only.
- Session-based identity; no role or account ID is read from the request.
- Body size limits are set.
- The existing cross-site write guard applies to the new POST.
- 404s don't reveal whether another account's dispute exists.
- Audit entries hold IDs only.
- No credential or token reaches the client.
- Demo passwords stay in the README by project design; this audit does not repeat them.

## 5. Test results

All run during this audit on HEAD `771c99e`, with in-memory or temporary databases only. The two file-based tests use `mkdtemp` folders, not `server/data/`.

| Check | Command | Result |
|-------|---------|--------|
| Server tests | `npm test` in `server/` | 247 tests, 247 passed, 0 failed, 0 skipped |
| Server typecheck | `npm run typecheck` in `server/` | Exit 0, no errors |
| Client tests | `npm test` in `client/` | 101 tests, 101 passed, 0 failed, 0 skipped |
| Client typecheck | `npm run typecheck` in `client/` | Exit 0, no errors |
| Client build | `npm run build` in `client/` | Built. One existing warning: main chunk 550 kB (over 500 kB). |

`security-headers.test.ts`, which failed once during 2.2b development, passed in this run.

## 6. Migration risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| One-way upgrade, v3 to v4 | After the first start, an older server refuses the database. | Copy `server/data/disputedesk.sqlite` (and any `-wal` or `-shm` files) with the server stopped, before starting `771c99e`. |
| Audit-log table rebuild | The whole log is copied inside one transaction, which takes longer on a large log. | The current file is about 150 kB, so negligible. The transaction is atomic either way. |
| Demo-file edits | Removing a demo dispute or account deletes its confirmations through the cascade. | Intended (D4). |

## 7. Findings by priority

### Critical
None.

### High
None.

### Medium

**M1. "Needs attention" drops when a gap is confirmed.**
- Where: `client/src/AnalysisPanel.tsx`, `ChecklistItems`.
- After a merchant confirms every gap, the overview reads "Needs attention: 0 · Merchant-confirmed: n". That number is the most likely place a confirmation could be read as "resolved".
- It matches the approved design (`phase-2.2-architecture-audit.md`, overview table and "false sense of completion" risk). It is mitigated by:
  - the unchanged status badges;
  - the separate "Merchant-confirmed" count;
  - the "Counts only" sentence.
- Condition: accept as designed, or count confirmed gaps inside "Needs attention", for example "Needs attention: n (m merchant-confirmed)".

**M2. Migration v4 is irreversible on the real database.**
- The database is at v3 and has no down migration.
- Condition: take a file backup before the first start.

### Low

**L1. The merchant's caveat is collapsed.**
- In the merchant view, the collapsed row shows the status badge and the "Merchant-confirmed" tag.
- The sentence "DisputeDesk has not seen the record" sits inside the "How to fill this gap" disclosure. Admin sees it inline.
- Consider showing a one-line caveat inline for merchants too.

**L2. No rate limit on the confirm route.**
- Each real toggle writes an audit row, and the admin view lists only the newest 200.
- A signed-in merchant toggling repeatedly could push older events out of that view. Nothing is deleted.
- The same pattern already exists for `analysis_viewed` and `intelligence_viewed`.

**L3. Clicks during a pending save are ignored silently.**
- While one save is in flight, clicks on other items' buttons do nothing (`if (pending) return`), and only the pending button is marked `aria-disabled`.

**L4. Stale confirmations come back.**
- The UI can't withdraw a hidden stale confirmation, because the button only shows on confirmable items.
- If the item later becomes a gap again, for example after a demo-file edit, the old confirmation reappears with its original date.
- The server supports the withdraw.

**L5. The confirm request has no abort signal.**
- An unmount during the save is harmless in React 19.

**L6. Formatting nit.**
- `export type AuditEntry ={` in `server/src/store.ts` is missing a space. This is cosmetic.

## 8. Known limitations

- A confirmation is the merchant's own statement. DisputeDesk has not seen the record, and confirmations never feed the draft, AI, Insights or buyers. This is by design.
- Confirmations are demo-only. Sandbox disputes are never stored.
- No retention limit (D4). A stale row stays until it is withdrawn or its dispute or account is removed.
- The README walkthrough and the Devpost copy don't mention confirmation yet.
- The 2.2b browser check used the DOM only; no screenshot was taken. No browser check was repeated in this audit.
- Three commits are not pushed.
