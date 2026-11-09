# DisputeDesk AI: Stage 2.2b Merchant Gap Confirmation Implementation Report

**Date:** 2026-11-09
**Commit:** the commit that adds this report, on `master`. Not pushed.
**Design source:** `reports/phase-2.2-architecture-audit.md` (Stage 2.2b section, decisions D1 to D10).

## 1. Summary

A merchant can now mark a checklist gap as "I have this in my records". The confirmation is stored with who and when, shown as a "Merchant-confirmed" tag beside the unchanged status, and can be withdrawn.

- **The evidence engine stays the source of truth.** A confirmation never changes an evidence status, a readiness count, the draft, the claim check, Insights or anything sent to Gemini. A test confirms every gap on every demo record and checks all of these are identical.
- **Demo disputes only, merchants only.** PayPal sandbox disputes are refused before any lookup, so no PayPal call is made. Admin reads every account's confirmations and cannot write. Buyers never see them.
- **IDs and a time only.** No free text is stored or accepted.

## 2. Decisions used

The audit's recommended defaults:

| Decision | Choice |
|----------|--------|
| D1 Build it | Yes, with migration v4. |
| D2 What is stored | Account, dispute, item ID and time. No notes. |
| D3 Which disputes | Demo disputes only. |
| D4 Retention | No time limit. Deleting a dispute or account removes its confirmations. |
| D6 API shape | Confirmations are added to the existing checklist response. |
| D10 External guidelines | Not fetched. |

**One change from the audit:** the table has no `source` column. Its foreign key to `disputes`, which only ever holds demo records, already keeps confirmations demo-only. A sandbox dispute ID is refused by the database.

## 3. What was built

### 3.1 Server

| File | Change |
|------|--------|
| `shared/types.ts` | `GapConfirmation` (`item_id`, `account_id`, `display_name`, `confirmed_at` as ISO UTC), `CONFIRMABLE = ["missing", "needs_confirmation"]`, and an optional `confirmations` field on `EvidenceChecklist`. |
| `server/src/db.ts` | Migration v4: the `gap_confirmations` table and its index, and the audit log rebuilt to allow two new events, `gap_confirmed` and `gap_confirmation_withdrawn`. Earlier migrations are unchanged. |
| `server/src/store.ts` | `listConfirmations`, `confirmGap` and `withdrawGap`. Each write and its audit event run in one transaction, and an event is written only when a row actually changes. |
| `server/src/app.ts` | `checklistFor` adds the confirmations to the checklist response. New route `POST /api/analysis/checklist/confirm`. |

**The table:**

```sql
CREATE TABLE gap_confirmations (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  dispute_id TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 40 AND item_id NOT GLOB '*[^a-z_]*'),
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, dispute_id, item_id)
) STRICT, WITHOUT ROWID;
```

**The route `POST /api/analysis/checklist/confirm`:**

| Case | Answer |
|------|--------|
| Merchant, own demo dispute, item currently missing or "not shown by records" | 200 with the updated checklist |
| `item_id` not matching `^[a-z_]{1,40}$`, or `confirmed` not a boolean | 400 `invalid_request` |
| PayPal sandbox dispute | 409 `not_confirmable`, before any lookup or PayPal call |
| Item not in the checklist, or conflicting, available or not applicable | 409 `not_confirmable` (confirm only; a withdraw is always allowed) |
| Another account's dispute, or a missing one | 404, identical in both cases; `dispute_access_denied` is audited |
| Admin, buyer | 403 |
| Signed out | 401 |
| Write from another site | Refused by the existing Origin and Sec-Fetch-Site guard |

The body limit is 1 kB. Confirming twice stores one row and writes one audit event.

**What each account sees in the checklist response:**
- A merchant sees only their own confirmations.
- Admin sees every account's confirmations.
- Sandbox disputes always get an empty list.
- A confirmation whose item is no longer a gap (the records changed) is kept but not shown. It can still be withdrawn.
- Only accounts with current access to the dispute appear.

### 3.2 Client

| File | Change |
|------|--------|
| `client/src/analysis.ts` | `fetchConfirm(dispute, itemId, confirmed)`. Sends IDs only and checks the reply has a `confirmations` list. |
| `client/src/AnalysisPanel.tsx` | The confirm button, the tag, the admin read-only line, the count and a live region. |
| `client/src/styles.css` | `.tag-confirmed` (dashed outline, no fill), `.confirm-gap` spacing, and a check mark on the pressed button. |

**On screen:**
- Inside "How to fill this gap", on a confirmable item, a merchant sees a button labelled "I have this in my records". It is a toggle (`aria-pressed`) and its label never changes.
- Under the button, always visible: "Your confirmation is recorded as yours. It does not change the evidence status, and DisputeDesk has not seen the record."
- A confirmed item shows a dashed "Merchant-confirmed" tag after its status badge. The badge itself is unchanged.
- The count line reads "Needs attention: n · Merchant-confirmed: n · Record available: n · Conflicting: n. Counts only: review each item before you respond."
- Admin sees "Merchant-confirmed by {name}, {date}. DisputeDesk has not seen the record." and no button.
- A screen reader hears "Confirmation recorded." or "Confirmation withdrawn." If saving fails, an error says so and the state is unchanged.
- Only merchants on demo disputes get the button.

## 4. Verification

All of these ran on the tree committed here.

| Check | Result |
|-------|--------|
| Server tests (`npm test` in `server/`) | 247 passed, 0 failed |
| Client tests (`npm test` in `client/`) | 101 passed, 0 failed |
| Server typecheck | Clean |
| Client typecheck | Clean |
| Client build | Succeeds, with the existing chunk-size warning |

`security-headers.test.ts` failed once during one full client run, then passed alone and on the next full run. It was not changed in this stage.

**New tests:**

| File | Tests |
|------|-------|
| `server/src/app.test.ts` | 5 new: confirming every gap on every demo record changes no status, count, draft, claim or other checklist field; only gaps can be confirmed, bad input is refused, and sandbox disputes never reach PayPal; confirming twice is one row and one event, and withdraw and re-confirm add one event each; a confirmation stays with its account (other merchants get 404; buyers, Insights and Gemini never see it); a confirmation on an item that is no longer a gap is kept but not shown. The route is in the role table. |
| `server/src/store.test.ts` | 4 new: recorded once with its audit entry and removed on withdraw; the table holds only IDs and a time, for stored demo disputes, with a plain item ID; confirmations survive a restart, go with their dispute or account, and only accounts with access are listed; upgrading a v3 database adds the table and events and keeps every audit entry. |
| `client/src/ui.test.ts` | 3 new: a merchant can confirm only gaps, the status badge stays and the limit sentence is always shown; conflicting records can't be confirmed, and admin reads who confirmed and when with no button; a confirmation on an item that is no longer a gap shows nothing, and busy and error states are plain. |

**Browser check.** Run on an isolated server on port 3001 with a throwaway database, deleted afterwards. The real database was not used.
- Merchant A on DEMO-1001: pressing Enter on the button kept focus, set `aria-pressed` to true and announced "Confirmation recorded."
- The counts changed to show 1 merchant-confirmed. The "Missing from records" badge stayed, with the tag beside it.
- The confirmation survived a reload.
- `/api/analysis` returned the same evidence statuses as before.
- Admin saw "Merchant-confirmed by Demo Merchant A, Nov 9, 2026" with no button. An admin write got 403.
- At 320px wide: no sideways scroll, buttons 44px tall, and the pressed button showed a check mark.
- Console: three 401s from session checks while signed out, and the 403 from the admin write test. Both expected.
- No screenshot was taken because the app window was hidden. The checks used the page's DOM and computed styles.

## 5. Changes to existing tests

| File | Change | Why |
|------|--------|-----|
| `server/src/app.test.ts` | Expected checklist now includes `confirmations: []` | D6 adds the field to the response. |
| `server/src/app.test.ts` | Confirm route added to the role table: `[403, 200, 404, 403, 403]` | Every route must be in the table. |
| `server/src/db.test.ts` | The v2-upgrade test migrates `MIGRATIONS.slice(0, 3)` | It was pinned to "all migrations"; v4 is now last. |
| `client/src/ui.test.ts` | Endpoint allowlist includes the confirm route; fetch count 17 | The client has one more endpoint. |

## 6. Guarantees kept

- The deterministic evidence engine still decides every status and contradiction.
- Nothing about confirmations reaches Gemini, buyers or Insights.
- No PayPal call is added. Sandbox disputes are refused before any lookup.
- Another account's dispute still answers 404, exactly like a missing one. Admin is read-only.
- The account comes from the server session, never from the request.
- SQL uses `?` placeholders only. The new migration was added at the end; released migrations are unchanged.
- The audit log stays append-only and holds IDs only.
- No inline styles; the strict CSP is unchanged. No new dependency.

## 7. Known limits and open items

- **The real database upgrades to v4 on the next server start.** Migrations only go forward: after that, an older server version refuses that database.
- A confirmation is the merchant's own statement. DisputeDesk has not seen the record, and the page says so every time.
- The README walkthrough and the Devpost copy do not yet mention confirmation.
- The dated phase reports were left unchanged.
