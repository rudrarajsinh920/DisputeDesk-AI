# DisputeDesk AI: Stage 2.1 Evidence Collection Intelligence Architecture Audit

Date: 2026-11-08
Mode: audit and design only. No source, schema, migration, dependency or configuration was changed. Nothing was
committed or pushed, and no live PayPal or Gemini call was made. `.env` was not read. This report is the only new file.

Naming note: `reports/phase-2.1-report.pdf` is from the earlier phase numbering (before the hackathon stages). This
report has a different name and does not replace it.

## 0. Repository state

| Item | Result |
|------|--------|
| Branch / HEAD | `master` at `3e22ee6` "Add Phase 8.3 release verification and fix submission copy" |
| Remote | In sync with `origin/master` (0 ahead, 0 behind) |
| Working tree | Clean before this report. No untracked files. |
| Stage 1 baseline | Tests ran in Phase 8.3: server 225/225, client 91/91, both typechecks and the build pass. Not re-run here: no code changed. |

## 1. Current architecture findings

### 1.1 Dispute reasons

- **The reason is a free string.** `Dispute.reason: string` (`shared/types.ts:21`). It is not an enum: PayPal values pass through unchanged (`paypal.ts:162`, `text(d.reason) ?? "UNKNOWN"`).
- **Labels.** `REASON_LABELS` in `shared/disputes.ts:15–25` covers 9 PayPal reason codes:
  - `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`
  - `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`
  - `UNAUTHORISED`
  - `CREDIT_NOT_PROCESSED`
  - `DUPLICATE_TRANSACTION`
  - `INCORRECT_AMOUNT`
  - `PAYMENT_BY_OTHER_MEANS`
  - `CANCELED_RECURRING_BILLING`
  - `PROBLEM_WITH_REMITTANCE`

  Unknown codes fall back to `humanize()`.
- **The demo set uses 5 reasons.** `demo-disputes.json` has 16 records: not received 8, not as described 4, credit not processed 2, unauthorised 1, duplicate 1. There are no demo records for the other 4 labelled reasons.

### 1.2 Evidence requirements today

All of the rules live in `server/src/evidence.ts`:

- **Four fixed evidence kinds.** `EVIDENCE_KEYS` (`:19`) is `order_confirmation`, `shipping_tracking`, `proof_of_delivery` and `customer_communication`. The same list is fixed in `EvidenceKey` (`shared/types.ts:46`) and in the database `CHECK` constraint (`db.ts:14, :89`).
- **One sentence per kind.** `RELEVANCE` (`:28`) is reason-independent text.
- **The key set is the only reason-specific requirement.** `KEY_EVIDENCE` (`:36–40`) covers three reasons:
  - not received → tracking and proof of delivery;
  - not as described → order confirmation and communication;
  - unauthorised → order confirmation and communication.

  Every other reason has no key evidence, so every item is "supporting".
- **Refund reasons get a gap, not a checklist item.** `REFUND_REASONS` (`:44`) adds a `[NEEDS MERCHANT INPUT: … refund ID …]` draft marker and a next step for credit not processed and duplicate. There is no refund field, so the refund ID is never an evidence item.
- **The only claim about an official source.** The comment at `evidence.ts:42` and `shared/disputes.ts:3` says "PayPal's dispute reasons reference lists proof of refund (the refund ID)". The code gives **no URL or date** for it. This audit did not re-verify it, because no external calls were allowed.
- **Draft wording.** The merchant-response paragraphs are reason-specific only for not received, not as described and the two refund reasons (`buildDraft`, `:204–235`). Everything else gets "[NEEDS MERCHANT INPUT: state your position …]".

### 1.3 Availability and conflicts

- **Statuses.** `EvidenceStatus` is `available | missing | unverified` (`types.ts:47`). `assess()` (`evidence.ts:75`) maps the flags:
  - `true` → available;
  - `false` → missing, always followed by "Missing from the supplied records does not show that it did not happen." (`NOT_PROOF`, `:52`);
  - absent → unverified.

  Tracking has extra logic tied to the tracking number. A contested `available` is downgraded to `unverified` (`:116`).
- **Contradictions.** `findContradictions()` (`:134`) has 4 fixed rules, all about tracking, delivery and shipping status. No contradiction rule exists for the other reasons.
- **Provenance.** `provenance.ts` derives an `EvidenceRef` per field, with `VerificationState` `verified | unverified | missing | conflicting` (`types.ts:74`).
  - `conflicting` is set when a contradiction names the finding's own flag (`findingState`, `:65`).
  - `SourceType` already reserves `"refund_record"` and `"document"` (`types.ts:78–86`) and never produces them. Stage 2 can fill both.
  - Provenance is computed on every request and never stored (`provenance.ts:5`).
- **Readiness counts.** `shared/readiness.ts` counts key items on record, missing, unverified, conflicts and markers. These are counts only, not a score.

### 1.4 Storage

- **Tables.** SQLite migrations v1–v3 (`db.ts:55–158`). Demo disputes are stored in `disputes` plus `dispute_evidence`, one row per supplied flag; no row means "not supplied" (`db.ts:86`).
- **PayPal sandbox disputes are never stored** (`db.ts:70`, CLAUDE.md).
- **The demo files are the source of truth.** `seedDemo` mirrors them on start (`store.ts:127`).
- **No document, file, upload or blob table exists.** No multipart parser is installed (no `multer` or `busboy` in either `package.json`). JSON bodies are capped at 4 kB, or 64 kB for the edit check (`app.ts:439, :500`).

### 1.5 Merchant and buyer separation

- **Merchant access.** `findDispute` with `canAccess` returns 404 for another account's dispute (`app.ts`, `auth.ts`).
- **Buyer data.** Buyers get `toBuyerRecord()` (`buyer.ts:30`): only `source, dispute_id, reason, status, amount, create_time` plus rule guidance. Buyers can't reach `/api/analysis*` (403).
- **Admin.** Admin can read analysis but can't use the AI draft or the edit check (`app.ts:450, :500`).
- **Tests.** `app.test.ts:929, :950, :1238, :1660, :1675, :1713` cover these rules.

### 1.6 Can the current logic support reason-specific checklists?

**Partly.**

- **What already works by reason:** the evidence engine is deterministic and reason-aware (`KEY_EVIDENCE`), provenance and verification states already exist, and every consumer reads `analysis.evidence`. That covers readiness, the draft, Insights (`intelligence.ts:80, :123, :260–263`) and provenance.
- **What blocks a real checklist:**
  1. Only four evidence kinds exist, and they are hard-wired in three places (the type, the engine and the DB `CHECK`). Unauthorised, duplicate and refund disputes need records such as a refund ID, a transaction ID match and seller-protection or login-related records. None of these is a kind today.
  2. There is no `not_applicable` or `needs_confirmation` status. Today an item outside the key set is "supporting", even when it does not apply (proof of delivery for a duplicate charge).
  3. There is no "where to get it" or "check before adding" guidance per item.
  4. There is no tier saying whether a requirement is official, a general suggestion or DisputeDesk guidance.

## 2. Reusable components

| Component | Where | Reuse in Stage 2 |
|-----------|-------|------------------|
| Evidence engine and `KEY_EVIDENCE` | `server/src/evidence.ts` | The checklist is a new pure function over `analyzeDispute()` output. The engine stays the source of truth for statuses and contradictions. |
| `NOT_PROOF` wording | `evidence.ts:52` | Appended to every "Missing from records" item, unchanged. |
| `REFUND_REASONS`, `REFUND_STEP`, `REFUND_ID_REASONS` | `evidence.ts:44–50`, `shared/disputes.ts:5` | Become checklist items with status `needs_confirmation` (refund ID). The draft marker stays. |
| Provenance (`EvidenceRef`, `VerificationState`, reserved `document` and `refund_record`) | `provenance.ts`, `types.ts:74–117` | Checklist items cite existing refs. Later document facts become refs with `source_type: "document"`. |
| `REASON_LABELS`, `labelFor` | `shared/disputes.ts` | Reason display. Unknown reasons fall back to a generic checklist. |
| `readiness()` | `shared/readiness.ts` | Unchanged. Optionally add checklist counts later. |
| Route guard, `findDispute`, `canAccess`, 404-for-others | `app.ts`, `auth.ts` | The checklist route reuses `requireRole("merchant","admin")` and `findDispute` exactly as `/api/analysis` does. |
| Role-table test | `app.test.ts` | Forces any new route into the role table. |
| Claim checks | `assist.ts` (`mapClaims`, `ATTACHMENT`, `NO_RECORD`) | Today attachments are always unsupported. Stage 2.4 can back an attachment claim only from a confirmed document fact. |
| Migrations framework | `db.ts` `MIGRATIONS`, forward-only | Only Stage 2.3 (documents) needs a new migration v4. Stage 2.1 and 2.2 need none. |
| `DetailSection` UI pattern, `RefList`, tags | `client/src/AnalysisPanel.tsx:56, :266` | A checklist section fits next to "Evidence analysis". |

## 3. Gaps

1. **G1: requirement tier.** Nothing separates an official PayPal requirement from a suggestion or internal guidance. The one official claim (`evidence.ts:42`) has no citation.
2. **G2: evidence kinds.** There are only four flags. No kind exists for a refund record, a transaction match, a listing or description record, return shipment tracking or authorization signals.
3. **G3: statuses.** There is no `not_applicable` or `needs_confirmation`.
4. **G4: guidance per gap.** There is nothing on where to obtain an item, what to check first, or limitations.
5. **G5: contradiction rules.** All four rules concern delivery. None exists for refund reasons, duplicates or not as described.
6. **G6: reason coverage.** Draft and key logic cover 5 of 9 labelled reasons. `INCORRECT_AMOUNT`, `PAYMENT_BY_OTHER_MEANS`, `CANCELED_RECURRING_BILLING` and `PROBLEM_WITH_REMITTANCE` get the generic path with no key evidence, and have no demo or test records.
7. **G7: documents.** There is no upload, storage, extraction or document provenance. `SourceType "document"` is reserved but unused.
8. **G8: PayPal evidence types.** `paypal.ts` reads only `PROOF_OF_DELIVERY*` and tracking from submitted evidence (`:110, :135–141`). Other submitted types (refund proof, for example) are ignored, so a sandbox checklist would undercount what PayPal holds.

## 4. Proposed design

### 4.1 Checklist model (shared/types.ts, additive)

```ts
export type RequirementTier = "official" | "general" | "disputedesk";
export type ChecklistStatus =
  | "available"          // in records (evidence engine: available, not contested)
  | "missing"            // missing from records; never proof the event did not happen
  | "conflicting"        // a contradiction names this item's record
  | "needs_confirmation" // no record field can show it; the merchant must confirm from their own records
  | "not_applicable";    // does not apply to this reason (shown collapsed, never counted as a gap)

export interface ChecklistItem {
  id: string;                   // "proof_of_delivery", "refund_id", "transaction_match", ...
  label: string;
  tier: RequirementTier;
  citation: { url: string; checked_on: string } | null; // required when tier === "official", else null
  status: ChecklistStatus;
  evidence_key: EvidenceKey | null; // the engine finding it mirrors, if any
  refs: string[];               // provenance refs behind the status (same "<source>:<id>:<field>" form)
  why: string;                  // why it may matter for this reason
  where: string[];              // places the merchant may look, phrased as suggestions
  check_before_adding: string[];
  limits: string;               // what DisputeDesk cannot see or confirm
}

export interface EvidenceChecklist {
  source: Source;
  dispute_id: string;
  reason: string;
  reason_known: boolean;        // false: generic checklist for an unmapped reason
  items: ChecklistItem[];
  notes: string[];              // e.g. NOT_PROOF, "DisputeDesk does not open documents"
}
```

**Rules:**
- **Status comes from the engine.** `status` is derived from `analyzeDispute()` and `buildProvenance()`, never decided separately:
  - an available finding whose flag is not contested → `available`;
  - provenance `conflicting` → `conflicting`;
  - finding `missing` → `missing`;
  - finding `unverified` → `needs_confirmation` (the engine's "not supplied" case);
  - an item with no record field (refund ID, listing record) → always `needs_confirmation`.
- **An item outside the reason's list is `not_applicable`.**
- **"Official" items must carry a citation.** A `tier: "official"` item without a `citation` fails a test.
  - **Initial state: no item is `official`.** The existing refund-ID statement stays `general`, with its current wording ("PayPal's dispute reasons reference lists…"), until the user supplies a verified PayPal URL and date.
  - This audit invents no official requirement.

### 4.2 Reason map (data, not code)

A new `server/src/checklist.ts` holds a table keyed by reason code, plus a `DEFAULT` entry. Proposed initial contents:
- Every item below is tier `general` or `disputedesk`.
- None is marked official.
- Wording is phrased as suggestions.

| Reason | Items (tier) | Notes |
|--------|--------------|-------|
| Item not received | shipping tracking (general, key), proof of delivery (general, key), order confirmation (general), customer communication (general) | Matches today's `KEY_EVIDENCE`. |
| Not as described | order confirmation (general, key), customer communication (general, key), listing or description at time of sale (disputedesk, needs_confirmation), return tracking if returned (general, needs_confirmation) | Tracking and proof of delivery: supporting, not N/A. They show the item arrived, which is not in dispute here. |
| Unauthorized | order confirmation (general, key), customer communication (general, key), shipping address match or delivery to the account address (disputedesk, needs_confirmation) | Proof of delivery and tracking: supporting. No authentication signals are on record. Say so in `limits`. |
| Duplicate charge | refund ID if refunded (general, needs_confirmation), the other transaction's ID (disputedesk, needs_confirmation), order confirmation (general) | Tracking and proof of delivery: not_applicable. |
| Credit not processed | refund ID (general, needs_confirmation), return receipt or return tracking (general, needs_confirmation), customer communication (general) | Tracking and proof of delivery of the original order: not_applicable. |
| DEFAULT (other or unknown reasons) | all four current kinds (general, supporting) plus "your position and supporting records" (disputedesk, needs_confirmation) | `reason_known: false`; the UI says the checklist is generic. |

### 4.3 Gap resolution text (per item, static and reviewed)

Example for proof of delivery on item-not-received:
- **What is missing.** "No proof of delivery is marked available in the supplied records."
- **Why it may matter.** "A carrier delivery confirmation can show where and when the order arrived."
- **Where to look.** "Your carrier account or the carrier's tracking page for this tracking number; your shipping software; delivery confirmation you already submitted in PayPal."
- **Check before adding.**
  - The tracking number matches this order.
  - The delivery address matches the order.
  - The delivery date is after the ship date.
  - The record is the carrier's, not a screenshot you edited.
- **Limits.**
  - DisputeDesk cannot open carrier systems or documents.
  - It shows only what the records mark.
  - Missing from the records does not show it was not delivered.

Wording rules:
- **Never "we found" or "DisputeDesk will fetch".** `where` is always phrased as places the merchant may look.
- **No item promises an outcome.**
- **The texts are constants**, checked by a test against a banned-phrase list. The list reuses `buyer.ts` and `intelligence.ts` style checks (promise, predict, guarantee).

### 4.4 API

- **New route `POST /api/analysis/checklist`.**
  - Access: `requireRole("merchant", "admin")`, using `findDispute` and its 4 kB body exactly as `/api/analysis` does. Buyers get 403, and another account's dispute gets 404.
  - Response: `EvidenceChecklist`.
  - Audit: one event `checklist_viewed`. This needs audit-event migration v4, which rebuilds the `CHECK` list the way v2 and v3 did. Alternatively, record nothing to avoid the migration in 2.1; recommended: **no audit event in 2.1**.
- **No change to `/api/analysis`.** Its response shape stays identical, which protects Stage 1 tests and the client.
- **Alternative considered: add `checklist` as an extra key on `/api/analysis`**, the way provenance was added.
  - It is cheaper for the client, but it grows a response that the "every existing field unchanged" test pins.
  - Either option works. A separate route keeps Stage 1 untouched; a key saves a request.
  - **Recommendation: separate route.**
- **Buyers: no checklist.** The buyer view keeps its "Not on record" list, built from buyer-visible fields only.

### 4.5 Document intelligence (later stages; design only, not for 2.1)

| Concern | Proposal |
|---------|----------|
| File types | PDF, PNG and JPEG only, checked by magic bytes, not by extension or MIME header. No Office files, archives, SVG or HTML. |
| Size | 5 MB per file, 10 files per dispute, and a total per account. Reject with 413 before buffering beyond the limit (stream with a byte counter). |
| Parsing | Needs a multipart parser, which is a new dependency, so ask first. Alternative: base64 in JSON with a raised limit on one route (simpler, about 33% larger, and no new dependency). |
| Validation and security | Re-encode images by decoding and re-encoding with the format's own encoder, which strips metadata and payloads. For PDFs, extract text only and never render scripts or forms. Run extraction in a worker with time and memory limits. Never serve the original file back inline. Downloads use `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, behind the same CSP. |
| Storage | Outside the web root, named by random ID and never by the uploaded filename. For a hackathon this can be local disk under `server/data/` (already gitignored). The database stores metadata only: `documents(id, dispute_id, account_id, sha256, mime, size, uploaded_at, deleted_at)`, added as forward-only migration v4. |
| Access control | Every document route goes through `findDispute` and `canAccess`. Another account's document returns 404. Admin can read metadata only. Buyers have no access. |
| Text extraction | PDF text layer first. OCR (for example, Tesseract) only for image files, and only if the user approves the dependency and its size. |
| Facts | Extracted candidates (tracking number, carrier, date, amount, refund ID) come from fixed patterns, never from an AI model on its own. Each fact is a provenance ref `document:<doc_id>:<field>` with `source_type: "document"` and the page or offset. |
| Human confirmation | Each candidate fact is `unconfirmed` until the merchant confirms it. Only confirmed facts can change a checklist status to `available` or back a Check my edits claim. Unconfirmed facts are shown as "found in your document, not yet confirmed". |
| Contradictions | New rules compare confirmed document facts with record fields: tracking number mismatch, amount mismatch, a delivery date before the ship date. They go through the same `Contradiction` type, so the draft's `[CONFLICT]` handling works unchanged. |
| Prompt injection | Document text is untrusted data. If Gemini is ever used to summarize it, the text goes inside the existing `<data>` wrapper, the existing `looksLikeInstructions` and fact checks apply, and the model never decides a status. Gemini never sees file IDs, account IDs or dispute IDs. |
| Retention and deletion | The merchant can delete a document. Deletion removes the file and soft-deletes the metadata row, and its facts stop counting. A fixed retention period (for example, 30 days after a dispute is resolved) is purged on start. The audit log records upload and delete events with IDs only, never content or filenames. |
| PayPal | Uploading to DisputeDesk never sends anything to PayPal. Submitting evidence to PayPal stays out of scope unless the user explicitly approves it. |

## 5. UI/UX proposal

- **Placement.** A new section, **"Evidence checklist for this reason"**, between "Claim and records" and "Evidence analysis" in `AnalysisPanel.tsx`. It gets an entry in the section tabs.
- **Rows.** Each row shows the label, a status tag (Available in records / Missing from records / Conflicting records / Confirm from your records / Not applicable) and a small tier tag (PayPal-documented / General guidance / DisputeDesk guidance).
  - The tags use the existing tag styles. Text carries the meaning, not colour alone.
- **Expanding a gap.** Expanding a non-available row shows "Why it may matter", "Where you might find it", "Check before adding" and "What DisputeDesk can't see". "Based on" lists the refs, using the existing `RefList`.
- **Not-applicable items.** They sit in a collapsed "Not applicable to this reason (n)" group and are never counted as gaps.
- **Unknown reasons.** A note says "No reason-specific checklist for this reason; showing general evidence."
- **Fixed note.** "Missing from the records does not show that it did not happen. DisputeDesk does not open your documents or other systems."
- **Behaviour.** No new buttons call AI. The section is read-only.
- **Phones.** The same 44px touch rules apply, and it fits a single column at 320px.

## 6. Security and privacy

- **No new data in 2.1.** Stage 2.1 adds a read-only derivation over existing records. The attack surface is one new authenticated route with the same guard.
- **Buyers.** Buyers never receive checklist items, guidance or refs. The test for buyer responses having no provenance or claims extends to the checklist.
- **Gemini.** The checklist is never sent to Gemini.
- **Provenance refs.** They keep the existing format and never include account IDs.
- **PayPal.** It stays read-only. Reading more evidence types from PayPal's record (G8) uses the existing GET only.
- **Documents (later stages).** See section 4.5. The top risks are malicious files, cross-account access to stored files, prompt injection through document text, and the retention of personal data in uploads.

## 7. Testing strategy

**Server, `checklist.test.ts`, synthetic data only:**
1. **Every reason.** For each mapped reason and for the DEFAULT entry, check the item IDs, tiers and which items are `not_applicable`. An unknown reason gives `reason_known: false`.
2. **Each status, per evidence kind:**
   - `available`: flag true, not contested;
   - `missing`: flag false; the notes include `NOT_PROOF`;
   - `conflicting`: DEMO-1002 proof of delivery;
   - `needs_confirmation`: flag absent, or no record field such as the refund ID;
   - `not_applicable`: proof of delivery for a duplicate charge.
3. **Statuses agree with the engine.** For all 16 demo records, every item that mirrors an engine finding has a status matching `analyzeDispute()` and `buildProvenance()`.
4. **Wrong reason mapping.** A record whose reason is changed (for example, not received to duplicate) changes the checklist, but not the engine findings, the draft or the readiness counts.
5. **Tier rule.** Any `official` item without a `citation` fails, and no item is `official` at first.
6. **Wording rule.** No `why`, `where`, `check` or `limits` text promises, predicts, says "we found" or "DisputeDesk will"; tested with the banned-phrase list.
7. **Missing is never proof.** No item text says "did not happen", "was not delivered" or "never".

**Server, `app.test.ts`:**
8. **Access.** Merchants get 200 for their own dispute and 404 for another account's or an unknown one. Admin gets 200 and read-only. Buyers get 403. Signed out gets 401. Cross-site writes are refused.
9. **Role table.** The role-table test includes the new route.
10. **Stage 1 shape.** The `/api/analysis` response is byte-identical to before on all 16 demo records, reusing the provenance "unchanged" test.

**Client, `ui.test.ts`:**
11. **Rendering.** The section renders each status label and tier tag. Not-applicable items are collapsed. The unknown-reason note appears. There is no AI button.

**Regression:**
12. **The Stage 1 suites pass unchanged** (225 server and 91 client tests at baseline). Nothing may be weakened: no assertion relaxed, no test removed.

**Later stages, documents:**
- File-type spoofing, oversize files, zero-byte files and polyglot files.
- Cross-account document IDs return 404.
- Buyers get 403.
- Deletion removes facts.
- Unconfirmed facts never back a claim.
- Injection text in a document never changes a status.

## 8. Phased implementation plan

| Stage | Scope | Schema change | New dependency |
|-------|-------|---------------|----------------|
| **2.1a** | `checklist.ts` (reason map, statuses from the engine), shared types, `POST /api/analysis/checklist`, server tests | None | None |
| **2.1b** | Checklist UI section, client tests | None | None |
| **2.2** | Gap guidance text reviewed by the user. Optional: read more submitted PayPal evidence types (G8). Optional: more demo records for the 4 uncovered reasons. Optional: new contradiction rules for refund and duplicate. | None (demo JSON only) | None |
| **2.3** | Document upload, storage, validation, metadata migration v4, delete and retention | Yes (v4) | Multipart parser, if chosen (ask first) |
| **2.4** | Extraction (PDF text; OCR only if approved), candidate facts, human confirmation, document provenance refs, document contradiction rules, Check my edits backing from confirmed facts | Possibly v5 | OCR library only if approved |

Stage 2.1 (2.1a and 2.1b) changes no existing behaviour and needs no migration.

## 9. Risks and trade-offs

- **Unofficial guidance mistaken for PayPal policy.** Mitigation: tier tags on every item, no `official` tier without a citation, and the wording rule.
- **Duplicate logic.** If the checklist computes statuses on its own, it can drift from the engine. Mitigation: derive only from `analyzeDispute` and `buildProvenance`, plus an agreement test over all demo records.
- **Too many "Confirm from your records" items.** This can feel like noise. Mitigation: collapse not-applicable items, and show key items first.
- **Separate route versus extra key.** A route means one more request per dispute, while a key grows a pinned response. Chosen: a route.
- **Hard-wired evidence kinds.** Adding new kinds to `EvidenceKey` would touch the engine, Insights and the DB `CHECK` (a migration). Mitigation: in 2.1, new items (refund ID, transaction match, listing record) are checklist-only with `evidence_key: null`, so the engine and DB stay as they are.
- **Documents are the largest risk and effort.** They bring storage, parsing and personal data. Mitigation: a separate stage, explicit approval for dependencies, human confirmation before any fact counts, and a retention policy.
- **Gaps in reason coverage.** Four labelled reasons have no demo or test data, so their checklists are untested against realistic records until Stage 2.2 adds fixtures.

## 10. Acceptance criteria for Stage 2.1

1. `POST /api/analysis/checklist` returns an `EvidenceChecklist` for every demo dispute. Merchants get 200 for their own and 404 for others'. Admin gets 200. Buyers get 403, and signed-out requests get 401.
2. Each of the 5 named reasons (not received, unauthorized, duplicate, not as described, credit not processed) has a distinct item list. Any other reason gets the generic list with `reason_known: false`.
3. Every item has one of the 5 statuses. Statuses that mirror an engine finding match `analyzeDispute()` and `buildProvenance()` on all 16 demo records.
4. Every `missing` item says that missing from the records does not show the event did not happen. No item text claims an event did not happen.
5. No item is tier `official` unless it has a `citation` with a URL and a checked date. At release, the list of official items is empty unless the user supplies verified PayPal documentation.
6. Every non-available item has `why`, `where`, `check_before_adding` and `limits`. No text says DisputeDesk can access carrier, bank, PayPal or document systems, and none promises an outcome.
7. Buyer responses, Gemini requests and Insights responses contain no checklist data.
8. `/api/analysis`, `/api/analysis/ai`, `/api/analysis/check` and every buyer and Insights response are unchanged. All Stage 1 tests pass without edits to existing assertions.
9. There is no schema migration, no new dependency and no PayPal write call.
10. The UI section renders every status and tier with text labels, keeps not-applicable items collapsed, fits 320px without sideways scroll, and has 44px touch targets.

---

Stopping here for review. No implementation was started.
