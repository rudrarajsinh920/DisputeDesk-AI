# DisputeDesk AI: Stage 2.2 Evidence Gap Resolution Architecture Audit

**Date:** 2026-11-09
**Type:** Architecture audit only. No application code, schema, dependency, Git history or deployment was changed, and no PayPal or Gemini request was made.

## 0. Repository state (Phase A)

| Check | Result |
|-------|--------|
| Branch | `master` |
| HEAD | `56108a0` "Add Stage 2.1 evidence checklist implementation report" |
| `bca4118` present | Yes: "Add evidence checklist per dispute reason (Stage 2.1)", the parent of HEAD |
| Working tree | Clean. No modified or untracked files before this report. |
| Remote tracking | `origin/master`, 0 ahead and 0 behind (local tracking ref; no `git fetch` was run) |
| Other files | `reports/phase-2.1-report.pdf` and `reports/phase-2.2-report.pdf` already exist. Neither was opened or changed. |

## 1. Existing architecture findings (Phase B)

### 1.1 How missing, unverified and conflicting evidence is represented

**Three layers, all computed on every request and never stored:**

1. **Evidence engine** (`server/src/evidence.ts`): `assess()` gives each of the 4 evidence kinds a status of `available`, `missing` or `unverified`.
   - A `false` flag means missing. A missing finding's explanation ends with `NOT_PROOF`.
   - An absent flag means unverified.
   - An available finding named in a contradiction is downgraded to `unverified`.
   - `findContradictions()` has 4 delivery rules.
2. **Provenance** (`server/src/provenance.ts`): `buildProvenance()` adds a `VerificationState` (`verified`, `unverified`, `missing` or `conflicting`) and the refs behind each finding. `findingState()` gives `conflicting` precedence.
3. **Checklist** (`server/src/checklist.ts:199`, `buildChecklist()`): maps the two layers above to a `ChecklistStatus`:
   - available;
   - missing;
   - conflicting;
   - `needs_confirmation`: the engine's unverified state, plus every item with no record field;
   - `not_applicable`.

**Readiness:** the counts (`shared/readiness.ts:29`) read only the engine.

**Claim checks:** "Check my edits" (`server/src/assist.ts`) marks a paragraph as having "No supporting record in DisputeDesk" (`NO_RECORD`, `:343`) when its evidence is missing or not on record. Refunds (`:379`), offers (`:380`) and attachments (`:381`) are never backed.

### 1.2 How checklist guidance is generated

- **Static text in `checklist.ts`:**
  - `ENGINE_GUIDES` covers the 4 engine kinds;
  - `RECORD_GUIDES` (`:78`) covers the 6 items with no record field;
  - `REASONS` holds the per-reason lists, the reason-specific "why" text and the "not applicable" text.
- **Fields on each item:** `why`, `where[]`, `check_before_adding[]` and `limits`. A missing item's `limits` text also ends with `NOT_PROOF`.
- **Tier:** every item is `general` or `disputedesk`, never `official`.
- **Checked by tests:** wording rules, the tier rule, and agreement with the engine on every demo record (`server/src/checklist.test.ts`).
- **Screen** (`client/src/AnalysisPanel.tsx:263–`): `CHECKLIST_STATUS` holds the status labels and `TIERS` the guidance labels. `ChecklistItems` renders the folded panels "How to fill this gap", "Based on" and "Not applicable to this reason (n)".

### 1.3 Are source paths already available?

**Yes.** Every engine item carries `refs` of the form `<source>:<dispute_id>:<field>`, the client resolves them to full `EvidenceRef` entries, and "Based on" shows the field, the source type, the origin, the record ID, the time ("No time on record") and the verification state.

Items with no record field have `refs: []`, which is honest: no record shows them.

### 1.4 Can merchant confirmation be represented without changing system status?

**Yes, as a separate layer.**
- Nothing in the engine, provenance, readiness, contradictions, the draft or the claim checks reads anything except the record. A confirmation stored elsewhere and joined only in the checklist response cannot change any of them, as long as no existing function reads it.
- This can be enforced by tests: the evidence engine, provenance, readiness, draft and claim-check output must be identical with and without a confirmation.

### 1.5 Audit, access control and data isolation today

- **Access:**
  - Every route uses `requireRole` (`app.ts:136`). The account comes from the server session, never from the request.
  - `findDispute` (`app.ts:158`) validates the lookup, then `canAccess` (`auth.ts:162`) decides. Admin can see everything; a sandbox dispute needs a merchant with sandbox access; a demo dispute must be in the account's `dispute_ids`.
  - Another account's dispute returns the same 404 as an unknown one, and is audited as `dispute_access_denied`.
- **Write protection:** a cross-site guard checks `Origin` and `Sec-Fetch-Site` (`app.ts:222`) on every POST, and the session cookie is `SameSite=Strict`.
- **Audit log** (`server/src/store.ts:141`, `audit()`):
  - append-only, enforced by triggers;
  - fixed event list per migration (`db.ts:15–30`, V1–V3), so a new event needs a forward-only migration that rebuilds the table with `rebuildAuditLog` (`db.ts:34`);
  - entries hold IDs and a short detail only, never secrets.
- **Storage:**
  - Demo disputes are mirrored from the fixture files on every start (`seedDemo`, `store.ts:127`). `writeDispute` uses `ON CONFLICT DO UPDATE` (an upsert), so rows that point at a dispute survive restarts. Only disputes removed from the files are deleted, with a cascade.
  - **PayPal sandbox disputes are never stored** (CLAUDE.md, `db.ts` comment).
- **Demo ownership:** merchant-a sees DEMO-1001 and DEMO-1002; merchant-b sees DEMO-1003; merchant-c sees DEMO-2001 to DEMO-2014. Buyers share disputes with merchants, and admin sees all.
- **The checklist route** (`app.ts`, `POST /api/analysis/checklist`): merchant and admin, read-only, not audited.

### 1.6 Can gap resolution be added without changing the evidence engine?

**Yes.**
- **Guidance changes:** better sources, an overview and clearer labels are pure changes to `checklist.ts` and `AnalysisPanel.tsx`.
- **Merchant confirmation:** needs a new store and new routes, but no change to `evidence.ts`, `provenance.ts`, `readiness.ts` or `assist.ts`.

## 2. Reusable Stage 2.1 components

| Component | Where | Reuse |
|-----------|-------|-------|
| `buildChecklist` and its item model | `server/src/checklist.ts` | The single place that decides which gaps exist. A confirmation is valid only for an item the current checklist shows as missing or "confirm from your records". |
| `why`, `where`, `check_before_adding` and `limits` | `checklist.ts` | Already answer questions 1–4 in the brief. Stage 2.2 refines them, with no rewrite. |
| Status and guidance labels, and the folded panels | `AnalysisPanel.tsx:263–` | The confirmation control goes inside the existing "How to fill this gap" panel, so no new panel is needed. |
| `RefList` and the "Based on" panel | `AnalysisPanel.tsx:56` | Answers question 6: is there a record the system can check? |
| `findDispute`, `canAccess` and the 404-for-others rule | `app.ts`, `auth.ts` | Reused unchanged for the confirmation routes. |
| `audit()` and `rebuildAuditLog` | `store.ts`, `db.ts` | The new events follow the same migration pattern as v2 and v3. |
| Role-table and protected-route tests | `app.test.ts` | They force any new route into the access matrix. |
| Wording-rule tests | `checklist.test.ts` | Extended to the confirmation text. |

## 3. Proposed workflow (Phase C)

For each checklist item that needs attention (missing or "confirm from your records"):

1. **Evidence gap:** the item name and its system status, which stays unchanged.
2. **Why it may matter:** `why`.
3. **Where to look:** `where`, now with a source label on each entry (section 6).
4. **Check before adding:** `check_before_adding`.
5. **Current state:** the derived state from section 4.
6. **Basis:** "Record in DisputeDesk" (refs shown) or "Your confirmation" (no ref, with its limit sentence).

**Not offered for:**
- Available items: they are already backed by a record.
- Conflicting items: a confirmation must not appear to settle a conflict. The guidance says to resolve the conflict in the source records.
- Not-applicable items.

**What a confirmation means:** "I have this in my own records and have checked it against the list above."

**What a confirmation does not do:**
- It does not change the item's status, the readiness counts, the draft and its `[NEEDS MERCHANT INPUT]` markers, the claim checks, Insights or anything sent to Gemini.
- It does not prove the event happened, and it does not mark the gap "resolved".

**Reviewers:** a confirmed gap stays listed as a gap, with its system status ("Missing from records") next to a separate "Merchant-confirmed" label. Admin, the read-only reviewer, sees the same row with the time and the account that confirmed it.

## 4. Recommended state model

**Evaluated states:**

| Proposed state | Decision | Reason |
|----------------|----------|--------|
| Needs attention | Keep | Missing or "confirm from your records", with no confirmation. |
| Merchant checking | **Drop** | It records no fact. It is a to-do mark that could be read as progress. An open guidance panel already shows that the merchant is looking. |
| Merchant confirmed | Keep | A separate layer, never a system status. |
| Record available | Keep | The existing `available` status, backed by refs. |
| Conflicting evidence | Keep | The existing `conflicting` status. It takes precedence, and it cannot be confirmed. |
| Not applicable | Keep | The existing `not_applicable` status, shown folded. |

**Minimal model:**
- The **system status** stays the existing `ChecklistStatus` and is unchanged.
- Add one **separate field per item**: `confirmation: { confirmed_at: number; by: string } | null`. It may be set only when the status is `missing` or `needs_confirmation`.
- The **display state** is derived and never stored:

| System status | Confirmation | Shown as |
|---------------|--------------|----------|
| available | — | Record available |
| conflicting | — (not allowed) | Conflicting records |
| missing or needs_confirmation | none | Needs attention |
| missing or needs_confirmation | present | Merchant-confirmed (the system status is still shown) |
| not_applicable | — | Not applicable |

**How the 5 kinds of information in the brief map:**
- System-verified record → "Available in records", plus provenance "Verified against record".
- Merchant-confirmed information → the "Merchant-confirmed" label.
- Unverified information → today labelled "Confirm from your records". **Recommend renaming it to "Not shown by records"**, so it is not confused with "Merchant-confirmed" (decision D5).
- Missing information → "Missing from records".
- Conflicting information → "Conflicting records".

**A stale confirmation stops counting.** If a later record makes the item available or conflicting, or the reason changes and the item disappears, the confirmation is not shown and does not count. The row stays in storage until it is withdrawn or cleaned up (section 5.4).

## 5. Data model and API proposal (Phase F)

### 5.1 Does Stage 2.2 need persistent state?

**Not for most of its value.** The read-only part needs no storage:
- source labels;
- an overview;
- clearer wording;
- demo records for the 4 untested reasons;
- reading more PayPal evidence types.

**Confirmation needs storage to mean anything to a reviewer.**

| Storage option | Verdict |
|----------------|---------|
| React state only | Lost when the merchant leaves the dispute. Not visible to reviewers. Too weak to be worth a button. |
| Browser `localStorage` | Per device, not visible to admin, not audited, can be edited by the user. **Not recommended:** it looks like a record without being one. |
| Server database (migration v4) | Visible to reviewers, audited, and isolated by account. **Recommended, if confirmation is approved.** |

**Recommendation:** split the stage.
- **2.2a:** read-only, with no storage.
- **2.2b:** confirmation, only after you approve migration v4 (decisions D1–D4).

### 5.2 Schema (migration v4, proposed, not implemented)

```sql
CREATE TABLE gap_confirmations (
  account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source = 'demo'),               -- see D3 for sandbox
  dispute_id   TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 40 AND item_id NOT GLOB '*[^a-z_]*'),
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, dispute_id, item_id)
) STRICT, WITHOUT ROWID;
```

**The same migration** rebuilds the audit log with `V4_AUDIT_EVENTS = [...V3, "gap_confirmed", "gap_confirmation_withdrawn"]`, using `rebuildAuditLog`.

**What the table holds:**
- **No free text:** no note, file name or value. This avoids personal data, injection text and invented facts (D2).
- **IDs and a time only.**

**Effects of the foreign keys:**
- The `disputes` foreign key means demo disputes removed from the fixture files take their confirmations with them on the next `seedDemo`.
- The `accounts` foreign key does the same for removed accounts.
- The upsert in `writeDispute` keeps confirmations across restarts.

### 5.3 API (proposed)

**Read:**
- `POST /api/analysis/checklist` gains one additive top-level key: `confirmations: { item_id, confirmed_at, account_id }[]`.
- Only confirmations for items currently eligible are returned.
- `items`, `notes` and every 2.1 field stay byte-identical. The existing 2.1 test that compares the whole response would be changed to compare everything except `confirmations` (D6).
- Admin gets confirmations from every account with access, buyers get 403 as today, and confirmations are never sent to Gemini.

**Write: `POST /api/analysis/checklist/confirm`**
- Body: `{ source, dispute_id, item_id, confirmed: boolean }`, limit 1 kB.
- **Merchant only.** Admin gets 403 (read-only), buyers 403, and signed-out requests 401.
- `findDispute`, then `buildChecklist`:
  - an unknown or not-owned dispute → 404, the same as today;
  - an `item_id` not in the checklist, or with a status other than `missing` or `needs_confirmation` → `409 not_confirmable`, and nothing is written.
- `confirmed: true` → `INSERT … ON CONFLICT DO NOTHING`. Confirming again is a no-op returning 200 with the existing `confirmed_at`, and it adds no new audit entry.
- `confirmed: false` → `DELETE` the row. Withdrawing a confirmation that doesn't exist is a no-op returning 200.
- Each real change writes one audit event: `gap_confirmed` or `gap_confirmation_withdrawn`, with `account_id`, `dispute_id` and `detail = item_id`.
- The response is the updated checklist (the same shape as the read), so the screen redraws from server truth.

### 5.4 Ownership, deletion, retention and rollback

- **Ownership:** a confirmation belongs to the account that made it, and only that account can withdraw it. Admin can read it but cannot change it.
- **Cross-account isolation:**
  - every write goes through `findDispute` and `canAccess`;
  - every read filters by the accounts that have access to the dispute;
  - there is no route that lists confirmations across disputes.
- **Deletion:** withdrawing deletes the row. The audit log keeps the two events, with IDs only. Dispute and account deletion cascade.
- **Retention:** demo data only, removed when the fixtures change. A time limit (for example, purge on start 90 days after the confirmation) is optional (D4).
- **Rollback:** migrations are forward-only, and `migrate()` refuses to start an older server on a newer database (`db.ts`).
  - Code rollback: hide the routes and the UI; the table stays inert.
  - Schema rollback: a later migration v5 drops the table.
  - There is no down-migration.

## 6. Source discovery guidance (Phase D)

- **Add a source label to each `where` entry.** Change `where: string[]` to `where: { kind: SourceKind; text: string }[]`, where `SourceKind` is one of:
  - `shipping_provider`
  - `payment_records`
  - `order_system`
  - `customer_support`
  - `refund_records`
  - `listing_history`
  - `merchant_documents` (invoices and receipts)
  - `paypal_dispute`

  This changes the shape of `where`, so the 2.1 client and tests need updating (D7). It is listed as 2.2a work.
- **Every label is a place the merchant looks.** None implies DisputeDesk can open it. The read-only PayPal GET already used by `paypal.ts` is the only external source DisputeDesk reads.
- **System-readable sources:** "Tracking you already added in PayPal" and "the messages in this PayPal dispute" are sources DisputeDesk does read for sandbox disputes. They can say "DisputeDesk reads this from the PayPal record" only where `paypal.ts` really maps it (tracking, proof of delivery and messages). Other submitted evidence types are not read today (gap G8).
- **Optional G8 work:** reading more submitted evidence types from the existing read-only `GET /v1/customer/disputes/{id}` would turn some gaps into real system records. It needs no write call, but it changes `paypal.ts` and is tested with mocks only (D8).
- **No official requirements.** All guidance stays `general` or `disputedesk`. The refund-ID sentence stays labelled "General guidance" until you supply a checked PayPal source (D9).

## 7. UI/UX proposal (Phase E)

**Overview line:** replace the current count line with "Needs attention: n · Merchant-confirmed: n · Record available: n · Conflicting: n". It shows counts only, never a score or a share.

**Gap rows:**
- **Status shown twice:** the system status badge stays exactly as today. When the item is confirmed, a second label "Merchant-confirmed" is added, styled as an outline tag, so it can't be mistaken for a system status.
- **Where it goes:** the confirmation sits at the end of the existing "How to fill this gap" panel, so the row gets no new top-level button.
- **The control:** one native `<button aria-pressed>`, labelled "I have this in my records" or "Withdraw my confirmation".
- **The limit sentence,** always visible next to the button: "Your confirmation is recorded as yours. It does not change the evidence status, and DisputeDesk has not seen the record."
- **After a change:** a polite `aria-live` message ("Confirmation recorded" or "Confirmation withdrawn"), and focus stays on the button.
- **Conflicting rows** show "Resolve the conflicting records at their source" instead of a button.

**Source labels:** small text labels in front of each "where" entry. The text carries the meaning, not colour.

**Admin:**
- Admin sees "Merchant-confirmed by Demo Merchant A, 9 Nov 2026" with no button.
- Admin can't change a confirmation, because the role is read-only.

**Buyer:** no change. Buyers never receive the checklist or any confirmations.

**Mobile and keyboard:**
- The 44px touch rules and the 320px layout from 2.1 apply.
- Everything is reached with Tab, Enter or Space on native `details`, `summary` and `button` elements.
- There are no hover-only controls.

**Design skills:** of the skills listed in this environment, these fit 2.2b:
- `impeccable:impeccable`
- `emil-design-eng`
- `taste-skill:design-taste-frontend`
- `ui-ux-pro-max:ui-ux-pro-max`
- `design:accessibility-review`
- `design:ux-copy`
- `gsap-skills:*`, which is not recommended: this is a work screen, and motion would add nothing.

None was invoked for this audit, because no screen was built. `web-design-guidelines` fetches its rules from GitHub, which is an external request, so it needs your approval before use. The `chrome-devtools` MCP server failed to connect this session; the built-in browser pane is available for checks.

## 8. Security and privacy analysis

- **Confirmations shown as proof (main risk).** Mitigations:
  - a separate field and a separate label;
  - the limit sentence;
  - no change to statuses, counts, the draft, claims or Gemini input, enforced by tests.
- **Cross-account confirmation.** Every write goes through `findDispute` and `canAccess`, which returns a 404 identical to an unknown dispute. The table key includes `account_id`.
- **Cross-site requests.** The existing `Origin` and `Sec-Fetch-Site` guard covers the new POST, and the cookie is `SameSite=Strict`.
- **Admin writes.** Refused with 403. The `ADMIN_READ_ONLY_POSTS` test keeps the confirm route off the admin list.
- **Buyers.** 403 on both routes. A test checks that no buyer response contains `confirmations` or `confirmed_at`.
- **Personal data and injection.** No free text is stored. `item_id` is checked against the current checklist and the table's `CHECK`. SQL uses `?` placeholders only.
- **PayPal sandbox.** Sandbox disputes are never stored. Storing confirmations against sandbox dispute IDs would store a sandbox reference, so it is excluded by `CHECK (source = 'demo')` unless you decide otherwise (D3).
- **Audit.** Two new append-only events, IDs only. There is no confirmation spam, because repeating a confirmation writes nothing.
- **Gemini.** Confirmations are never in the AI request. A test asserts this, the way 2.1 does for checklist keys.

## 9. Testing strategy (Phase G)

**Server, `checklist.test.ts` and a new `confirmations.test.ts`:**
1. **Confirmation versus system status.** For every demo record and every confirmable item, confirming leaves these identical:
   - `analyzeDispute`, `buildProvenance` and `readiness`;
   - `checkMerchantDraft` claim results;
   - the draft text and its markers;
   - the item's `status`.

   Only `confirmations` changes.
2. **Missing and conflicting.**
   - Missing and "not shown by records" items can be confirmed.
   - Conflicting, available and not-applicable items return 409, and nothing is written.
   - A missing item keeps its `NOT_PROOF` text after confirmation.
3. **Repeated confirmation.**
   - A second confirm returns 200, with one row, the same `confirmed_at` and one audit event.
   - A withdraw then a confirm gives one row again and three events.
4. **Stale confirmation.** After the record changes and the item becomes available, the confirmation isn't returned.
5. **Wording rules.** The confirmation and limit text never say "verified", "proves", "resolved" or "complete", or any banned outcome word.

**Server, `app.test.ts`:**

6. **Access.** For the confirm route:
   - the owner merchant gets 200;
   - another merchant gets a 404 identical to an unknown dispute, and `dispute_access_denied` is audited;
   - admin gets 403 on the write and 200 on the read;
   - buyers get 403;
   - signed-out requests get 401;
   - a cross-site Origin is refused.

   Both routes go in the role table.
7. **Isolation.** Merchant-a's confirmation never appears in merchant-b's or a buyer's response, or in Insights, the dispute list or a Gemini request.
8. **Database.**
   - Migration v4 applies on top of v3 data, and the old audit rows survive.
   - The table rejects a sandbox source and an invalid `item_id`.
   - Confirmations survive `seedDemo` and are deleted when their dispute leaves the fixtures.

**Client, `ui.test.ts`:**

9. The "Merchant-confirmed" label renders next to an unchanged status badge.
10. The limit sentence is always present.
11. No button appears on conflicting, available or not-applicable rows.
12. Admin sees confirmations without a button.
13. The overview counts are right.
14. The button uses `aria-pressed`, and a live region exists.

**Regression:**

15. **Stage 1 and 2.1 suites pass,** with the only test changes being the list entries the new routes require and the D6 comparison.
16. **Browser check** at desktop width and 320px, done with the keyboard only, on the isolated server with a throwaway database.

## 10. Implementation sequence

| Step | Scope | Storage | Dependency |
|------|-------|---------|------------|
| **2.2a** | Read-only gap resolution: source labels (D7), the overview line, the label rename (D5), the conflict guidance text, demo records for the 4 untested reasons, and your review of all guidance text | None | None |
| **2.2b** | Migration v4, `gap_confirmations` and two audit events; the confirm route and the read key; the confirmation UI; tests 1–16 | v4 (needs approval) | None |
| **2.2c (optional)** | G8: read more submitted evidence types from the existing PayPal GET, tested with mocks only | None | None |

Stages 2.3 and 2.4 (documents) are unchanged from the 2.1 audit and are still the only way to get a system-verifiable record of something the current records lack.

## 11. Risks and trade-offs

- **Confirmation inflation.** A merchant may click through without checking. Mitigations:
  - the confirmation never changes status or counts;
  - the button sits after the "check before adding" list;
  - the limit sentence is always shown.
- **A false sense of completion.** An overview showing "Needs attention: 0" could be read as "ready". Mitigation: a merchant-confirmed item stays counted in its own group, never as "Record available". The overview never says "complete".
- **Schema growth for a demo product.** Migration v4 is the first table holding merchant-entered state. That is why 2.2a ships first and 2.2b waits for approval.
- **Changing the 2.1 response.** The additive `confirmations` key requires one 2.1 test to compare everything except that key. The alternative, a separate read route, costs one more request per dispute.
- **No sandbox confirmations.** This keeps the "never stored" rule, but sandbox users can't confirm.
- **Item IDs are fixed strings.** If an item is renamed later, old confirmations go stale. Mitigation: treat item IDs as stable, and test them against the reason map.

## 12. Acceptance criteria

1. Every item that needs attention shows its gap, why it may matter, where to look (with source labels), what to check, its current state, and whether it rests on a record or on a confirmation.
2. A confirmation never changes:
   - the evidence engine, provenance or readiness output;
   - the checklist `status`;
   - the draft text or markers;
   - the claim checks, Insights or the Gemini input.

   Tested on every demo record.
3. Only missing and "not shown by records" items can be confirmed. Other statuses return 409, and nothing is written.
4. Confirming is idempotent. Withdrawing deletes the row, and every real change writes one audit event with IDs only.
5. Only the owning merchant can confirm or withdraw. Another account gets a 404 identical to an unknown dispute. Admin is read-only, buyers get 403, and signed-out requests get 401.
6. Buyers, Insights, the dispute list and Gemini never receive confirmations.
7. A confirmed gap is still shown as a gap, with its system status and a separate "Merchant-confirmed" label. The confirmation text never says "verified", "proves" or "resolved".
8. No official PayPal requirement is added, and no text implies DisputeDesk opens carrier, bank, store or document systems.
9. All Stage 1 and 2.1 tests pass. The only test changes are list entries and the D6 comparison.
10. The UI works with the keyboard alone, at 320px, with 44px targets and an `aria-live` announcement.
11. 2.2a adds no migration and no dependency. 2.2b adds only migration v4, and no dependency.

## 13. Decisions requiring your approval

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Build merchant confirmation at all (2.2b), with migration v4 | Yes, after 2.2a ships |
| D2 | Allow a free-text note with a confirmation | No. IDs and a time only. |
| D3 | Allow confirmations on PayPal sandbox disputes, which would store sandbox dispute IDs | No. Demo only, to keep "sandbox disputes are never stored". |
| D4 | Retention limit for confirmations | None beyond cascades for demo data; add a 90-day purge if wanted |
| D5 | Rename the status label "Confirm from your records" to "Not shown by records" | Yes, to avoid confusion with "Merchant-confirmed" |
| D6 | Add `confirmations` to the existing checklist response, and change the one 2.1 test that compares the whole response | Yes. The alternative is a separate read route. |
| D7 | Change `where` from text to text plus a source label, which changes the 2.1 shape and tests | Yes, in 2.2a |
| D8 | Read more submitted evidence types from the existing read-only PayPal GET (G8) | Optional 2.2c, mocks only |
| D9 | Supply checked PayPal documentation (URL and date) for any item to be labelled "PayPal-documented" | Your call. Nothing is labelled official until then. |
| D10 | Use the external `web-design-guidelines` fetch during 2.2b UI work | Only if you approve the external request |

---

Stopping here for review. No implementation was started.
