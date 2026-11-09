# DisputeDesk AI: Stage 2.1 Evidence Checklist Implementation Report

**Date:** 2026-11-09
**Commit:** `bca4118` "Add evidence checklist per dispute reason (Stage 2.1)", on `master` and pushed to GitHub (`origin/master` = `bca4118`).
**Design source:** `reports/phase-2.1-architecture-audit.md`.

## 1. Summary

Every dispute now has an evidence checklist for its reason. The checklist says which evidence is in the records, which is missing or conflicting, and what the merchant must confirm from their own records, with guidance for each gap.

- **Statuses come from the existing evidence engine.** The checklist never decides a status on its own, so it cannot disagree with the Evidence analysis section.
- **Read-only.** There is no database change, no new dependency, no audit event and no AI call. Nothing is sent to PayPal.
- **No item is presented as an official PayPal requirement.** Every item is labelled "General guidance" or "DisputeDesk guidance".

## 2. What was built

### 2.1a Server

| File | Change |
|------|--------|
| `server/src/checklist.ts` (new) | `buildChecklist(dispute, analysis)`: the reason map, the gap guidance text and the status derivation. |
| `shared/types.ts` | Added the types `RequirementTier`, `ChecklistStatus`, `ChecklistItem` and `EvidenceChecklist`. Nothing existing changed. |
| `server/src/evidence.ts` | Exported the existing `NOT_PROOF` sentence. Its text didn't change. |
| `server/src/app.ts` | Added the route `POST /api/analysis/checklist`. |

**Reason lists:**

| Reason | Items | Not applicable |
|--------|-------|----------------|
| Item not received | Shipping tracking (key), proof of delivery (key), order confirmation, customer communication | — |
| Not as described | Order confirmation (key), customer communication (key), listing at time of sale, return tracking, shipping tracking, proof of delivery | — |
| Unauthorized | Order confirmation (key), customer communication (key), shipping address, shipping tracking, proof of delivery | — |
| Duplicate transaction | Refund ID, the other payment's transaction ID, order confirmation, customer communication | Shipping tracking, proof of delivery |
| Credit not processed | Refund ID, return tracking, customer communication, order confirmation | Shipping tracking, proof of delivery |
| Any other reason | The four standard evidence items plus "Your position and the records behind it" (`reason_known: false`) | — |

**How each status is set:**
- **Conflicting:** a contradiction names the item's record. This is the same rule the source tracking already uses.
- **Available, missing:** the engine's own status.
- **Confirm from your records:** the engine marks the item unverified because its flag was not supplied, or no record field can show the item at all (refund ID, listing, return tracking, shipping address, other transaction, your position).
- **Not applicable:** the item does not bear on this reason. These items are listed last and never counted as gaps.

**Order:** key items come first, then supporting items, then not-applicable items.

**Guidance for each item:**
- **Why it may matter:** why the evidence could help for this reason.
- **Where you might find it:** phrased as places the merchant may look.
- **Check before adding:** what to confirm before using the evidence.
- **What DisputeDesk can't see:** the limits of the records. For a missing item, this text also ends with the sentence that missing from the records does not show the event did not happen.

**Fixed notes on every checklist:**
- Missing from the records is not proof that something did not happen.
- DisputeDesk does not open your documents or other systems.
- The checklist is guidance, not PayPal's requirements.

**The route `POST /api/analysis/checklist`:**
- **Access:** the same guard as `/api/analysis`. Merchants and admin get 200 for disputes they can see, and buyers get 403. Signed-out requests get 401. Another account's dispute gets a 404 identical to an unknown dispute.
- **Body limit:** 4 kB.
- **Nothing is stored or audited.**

### 2.1b Client

| File | Change |
|------|--------|
| `client/src/analysis.ts` | Added `fetchChecklist`, which calls the new route and validates its response. |
| `client/src/AnalysisPanel.tsx` | Added the "Evidence checklist for this reason" section, between "Claim and records" and "Evidence analysis". |
| `client/src/DisputeDetail.tsx` | Added a "Checklist" entry to the section tabs. |
| `client/src/styles.css` | Added a conflict badge, styles for the folded guidance, and 44px summaries on touch screens. |

**What the section shows:**
- **Count line:** for example, "Available in records: 3 · Conflicting records: 1". It shows counts only, never a score.
- **One row per item:**
  - the item name;
  - "Key for this reason", where it applies;
  - a guidance label: General guidance or DisputeDesk guidance;
  - a status label: Available in records, Missing from records, Conflicting records, or Confirm from your records.
- **Folded panels:**
  - "How to fill this gap" on every item that isn't available;
  - "Based on", listing the record fields behind the status;
  - "Not applicable to this reason (n)".
- **Generic note:** reasons without their own list show "No reason-specific checklist for this reason; showing general evidence."
- **Load states:** a loading state, and an error state with a Try again button.
- **No AI buttons and no edit controls.**

## 3. Verification

| Check | Result |
|-------|--------|
| Server tests (`npm test` in `server/`) | 236 passed, 0 failed (225 before plus 11 new) |
| Client tests (`npm test` in `client/`) | 96 passed, 0 failed (91 before plus 5 new) |
| Server typecheck | Clean |
| Client typecheck (`npm run typecheck`) | Clean, exit code 0 |
| Client build (`npm run build`) | Succeeds. The existing warning about chunks over 500 kB remains. |
| Browser: DEMO-1002 as Demo Merchant A | The section renders. Proof of delivery shows "Conflicting records", matching Evidence analysis. The Checklist tab is highlighted while the section is in view. |
| Browser: 320px wide | No sideways scroll; no element runs past the screen edge; every folded-panel summary is 44px tall. |
| Browser console | One 401 from the session check before sign-in, the same one seen in earlier phases. No other errors. |

**How the browser check ran:** an isolated server on 127.0.0.1:3001 with a throwaway database, test-only passwords and outbound requests blocked. The real database `server/data/disputedesk.sqlite` was not touched. The throwaway database was deleted afterwards.

**What the new tests cover:**
- **Server, 8 tests in `checklist.test.ts`:**
  - the item list for each reason, and the generic list;
  - the order of items;
  - every status;
  - agreement with the engine and provenance on every demo record;
  - a changed reason changes the checklist without changing the record or the engine statuses;
  - no item is labelled official without a citation;
  - every item has its guidance text;
  - the banned-wording rules.
- **Server, 3 tests in `app.test.ts`:**
  - the route's output for every demo record, and that nothing is audited;
  - another account's dispute gets a 404 identical to an unknown one;
  - checklist data never appears in another response or in the Gemini request.
- **Client, 5 tests in `ui.test.ts`:**
  - every status and guidance label renders as text;
  - the guidance panels stay folded, and the section has no buttons or forms;
  - the generic-list note;
  - the loading and error states;
  - the section's position in the dispute view.

## 4. Changes to existing tests

Existing tests changed only where they pin a list that now has one more entry. No assertion was relaxed, and no test was removed.

**`server/src/app.test.ts`:**
- Added `POST /api/analysis/checklist` to the list of protected routes.
- Added it to the list of admin read-only routes.
- Added two rows to the role matrix: a demo dispute and a sandbox dispute.

**`client/src/ui.test.ts`:**
- The expected tab order now includes "Checklist".
- The list of endpoints the client may call now includes `/api/analysis/checklist`.
- The expected number of `fetch` calls goes from 15 to 16.

## 5. Guarantees kept

- **The evidence engine stays the source of truth.** The checklist only reads its output.
- **No invented facts and no invented PayPal requirements.** The only statement about PayPal's documentation is the existing refund-ID sentence, and that item is labelled "General guidance", not official.
- **Missing is never presented as proof.**
- **Data separation:**
  - buyers never receive the checklist;
  - the checklist is never sent to Gemini;
  - another account's dispute gets 404.
- **No PayPal write calls, no migration and no new dependency.**

## 6. Known limits and open items

1. **Untested reasons.** Four labelled reasons have no demo records: incorrect amount, paid by other means, canceled recurring billing, and problem with remittance. Their generic checklist is covered by unit tests only.
2. **Not-applicable group not seen in the browser.** Demo Merchant A has no duplicate or credit-not-processed dispute. The group is covered by a client test.
3. **Unverified PayPal statement.** The refund-ID sentence ("PayPal's dispute reasons reference lists proof of refund") has no checked source link. To label any item "PayPal-documented", the user needs to supply verified PayPal documentation with a URL and the date checked.
4. **Partial reading of PayPal evidence.** For sandbox disputes, `paypal.ts` reads only proof-of-delivery and tracking evidence from PayPal's record (gap G8 in the audit), so items backed by other submitted evidence types show "Confirm from your records".
5. **Folded-panel arrows on touch screens.** Summaries use the same flex layout as the existing "Sources for the generated draft" panel, so their disclosure arrow is hidden on touch screens, as it already is there.

## 7. Next stages (from the audit, not started)

| Stage | Scope | Needs approval for |
|-------|-------|--------------------|
| 2.2 | User review of the guidance text; optional demo records for the 4 untested reasons; optional reading of more PayPal evidence types; optional contradiction rules for refunds and duplicates | — |
| 2.3 | Document upload, storage, validation, delete and retention | Database migration v4; possibly a file-upload library |
| 2.4 | Reading facts from documents, merchant confirmation of each fact, document source references | Possibly migration v5; a text-recognition (OCR) library, if wanted |
