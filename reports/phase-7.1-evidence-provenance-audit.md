# DisputeDesk AI — Phase 7.1: Evidence Provenance Foundation Audit

Date: 2026-11-07
Scope: architecture audit and implementation plan for Evidence Provenance. **Nothing was implemented.** No code, schema,
database contents, configuration or dependency was changed. Nothing was committed, pushed or deployed. No live PayPal or
Gemini call was made, and `.env` was not read.

## 0. Git baseline

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD | `44dcf68` "Harden sign-in lockout, headers, session cleanup and limiter memory" (the stated baseline) |
| Ahead of origin | 5 commits, not pushed |
| Stashes | None |
| Tracked changes (uncommitted, preserved) | `client/src/Landing.tsx` (intro plays once per page load), `client/src/styles.css` (Admin settings value wrap). Both are UI fixes made after Phase 6.5 and are unrelated to provenance. |
| Untracked (preserved) | `reports/` files (Phases 0.2–6.5, demo script, Devpost text, audit PDF, `visual-qa/`, `intro-reel/`) |

Method: the code was read directly. One read-only local script (scratchpad, no network, no database) ran the existing
`checkMerchantDraft` on three sentences to confirm a gap (§3, G6).

---

## 1. Existing architecture and file paths

| Area | File | What it does today |
|------|------|--------------------|
| Dispute and evidence types | `shared/types.ts` | `Dispute` (dispute fields, optional `order`, optional `evidence` flags); `EvidenceStatus = "available" \| "missing" \| "unverified"`; `RecordRef { path, value }`; `EvidenceFinding { id, label, status, priority, relevance, explanation, records: RecordRef[] }`; `Contradiction { message, records }`; `DraftLine { kind, text, records: string[] }`; `AiFact { id: "R1"…, path, label, value, contested }`; `DraftCheck` |
| Readiness | `shared/readiness.ts` | Counts from the analysis: key on record, missing, unverified, conflicts, markers. `countMarkers` ignores `>` buyer lines. |
| Labels, refund reasons | `shared/disputes.ts` | `REFUND_ID_REASONS`, reason and status labels |
| Evidence engine (source of truth) | `server/src/evidence.ts` | `assess()` per evidence key; `findContradictions()` (4 rules); contested-path demotion (available → unverified); `buildDraft()` produces typed `DraftLine`s with record paths; `analyzeDispute()` |
| AI wording and checks | `server/src/assist.ts` | Allowlisted `FACT_FIELDS` sent to Gemini as `R1…Rn`; schema-constrained answer; `problems()` checks (cited ids, digits/emails/links must be whole supplied tokens, dates, buyer messages, unknown names, carriers, handoff stories, delivery/shipping/tracking claims vs the rules' statuses, meta/submission); failed text is removed and listed in `flags`; the rules' gaps are always appended to the AI draft. `checkMerchantDraft()` runs merchant edits through the same `problems()`. |
| Validation | `server/src/validate.ts` | `validateDispute` copies only known fields (unknown fields dropped); `validateLookup` |
| PayPal (read-only) | `server/src/paypal.ts` | Token POST + GETs only. `normalizeDispute` (list) and `normalizeDetails` (detail) map PayPal JSON into the same `Dispute` shape, setting evidence flags from the presence of PayPal fields. |
| API | `server/src/app.ts` | `findDispute()` loads the record server-side, applies `canAccess`, answers 404 for another account's dispute and audits the attempt. Routes below. |
| Database | `server/src/db.ts`, `server/src/store.ts` | Migrations v1–v3: `accounts`, `disputes` (demo only, `source = 'demo'`), `dispute_evidence` (one row per supplied flag; no row = not supplied), `dispute_access`, `sessions`, append-only `audit_log` (CHECK-listed events, update/delete triggers). `seedDemo` mirrors the fixture files on every start. |
| Buyer | `server/src/buyer.ts` | `toBuyerRecord` keeps only `source, dispute_id, reason, status, amount, create_time`. |
| Insights | `server/src/intelligence.ts` | Counts built on `analyzeDispute` statuses. |
| Client analysis UI | `client/src/AnalysisPanel.tsx`, `DisputeDetail.tsx`, `analysis.ts` | Readiness summary; "Claim and records"; evidence list showing `Based on: path = value`; contradictions with records; `DraftEditor` (plain textarea, Copy, Reset, "Check my edits"); AI panel showing flags, removed text and `Cites:` per explanation. |
| Demo data | `sample-dispute.json` (one object), `demo-disputes.json` (15 more), `demo-accounts.json` | Synthetic, labelled `demo` by the server |

**Analysis-related routes**

| Route | Roles | Provenance-relevant output |
|-------|-------|----------------------------|
| `POST /api/analysis` | merchant, admin | `Analysis` (findings with `records`, contradictions, draft lines with record paths). Audited `analysis_viewed`. |
| `POST /api/analysis/ai` | merchant | `AiAssist` (facts R1…, explanations with `cites`, flags, draft lines with record paths from cites). Audited. |
| `POST /api/analysis/ai/example` | merchant, admin | Fixed wrong answer through the same checks. Audited. |
| `POST /api/analysis/check` | merchant | `DraftCheck` (flagged paragraphs, markers left). Advisory, not stored, not audited, no Gemini. |
| `GET /api/disputes` | merchant, admin | Disputes plus `readiness` per dispute |
| `GET /api/buyer/disputes`, `POST /api/buyer/explain` | buyer | Buyer view only (no order, evidence, message or drafts) |
| `GET /api/intelligence` | merchant, admin | Counts from evidence statuses |

## 2. Existing capabilities that can be reused

Provenance already exists in a basic form. It is just not named or exposed as such.

1. **Field-level references.** Every `EvidenceFinding` and `Contradiction` carries `RecordRef[]` (`path` + `value`, with
   `null` meaning "not on record"). This is a reference to a specific record field.
2. **Line-level claim mapping in rule-based drafts.** Every `DraftLine` has a `kind` (`fact`, `missing`, `unverified`,
   `unsupported`, `input`, `conflict`, `notice`, `ai`) and `records: string[]`. Every `fact` line names the fields it
   comes from. This is claim-to-evidence mapping for server-written text.
3. **Citation discipline for AI text.** Gemini must cite `R1…Rn`; unknown or missing citations, and claims beyond the
   rules' statuses, are removed. AI `draft` lines carry the cited paths in `records`.
4. **Conflict detection.** `findContradictions` plus contested-path demotion already produces the "conflicting" signal.
   Contested fields are never cited as facts.
5. **Unsupported-claim handling.** Rule drafts write `[UNSUPPORTED: …]` instead of a claim; AI paragraphs that fail
   become `[UNSUPPORTED: AI paragraph n was removed …]`; merchant edits are flagged, never changed.
6. **Not-on-record semantics.** Missing input is `undefined` → `unverified` ("not supplied"), explicit `false` →
   `missing`, and every missing finding says it does not prove absence. Storage keeps this distinction (`dispute_evidence`
   has no row for unsupplied flags).
7. **Source separation.** `Source = "demo" | "paypal_sandbox"`; the DB accepts only demo; sandbox data is read live
   and never stored.
8. **Authorization boundary.** `findDispute` + `canAccess` + 404-for-others + buyer projection (`toBuyerRecord`) +
   route role table test.
9. **Honest UI wording.** The evidence list already says "DisputeDesk does not inspect the documents themselves".

## 3. Gaps confirmed by code inspection

| # | Gap | Evidence in code |
|---|-----|------------------|
| G1 | **No source type.** A `RecordRef` path says *which field*, not *what kind of record* (order, transaction, delivery, merchant statement, dispute record). | `RecordRef` is `{ path, value }` only (`shared/types.ts:50`). |
| G2 | **No stable reference ID.** References are bare paths, which are not unique across disputes and are not IDs a draft can cite. AI facts get `R1…` numbers that depend on which fields happen to be present, so they shift between disputes and are only valid inside one response. | `buildAiFacts` numbers facts in order of presence (`assist.ts:49`). |
| G3 | **No source record identifier on references.** The order ID (`order.order_id`) or PayPal `seller_transaction_id` is a field of its own, but references to tracking or evidence flags don't point back to the record they belong to. | `assess()` builds refs from paths only. |
| G4 | **No recorded timestamp.** No evidence field has a time. The only real times are `create_time` and `seller_response_due_date` (dispute-level). `disputes.updated_at` is the seed time, not a record time, and must not be shown as one. `normalizeDetails` drops PayPal evidence dates. | `db.ts` v1 schema; `store.ts` `writeDispute(…, now)`; `paypal.ts:110`. |
| G5 | **Four verification states don't exist as such.** Statuses are `available / missing / unverified`; "conflicting" exists only as a contradiction list plus a demotion to `unverified`, so a finding's own status can't say it is conflicting. | `evidence.ts:116`. |
| G6 | **Merchant edits have no positive claim mapping, and some factual claims slip through.** `checkMerchantDraft` only looks for known bad patterns. It never says which record supports a paragraph. Confirmed locally (sample record with shipping status set to `PENDING`): "The order was shipped." is flagged, but **"We shipped the order."** and **"We sent the keyboard and the buyer has it now."** pass. `SHIPPING_CLAIM` needs a passive verb and `RECEIPT_CLAIM` doesn't cover "has it". | `assist.ts:152, 165, 295`. |
| G7 | **The client ignores line-level provenance.** `draft.lines[].records` reaches the browser but no component reads it; the draft is shown as one plain textarea (`draft.text`). Only AI explanations show `Cites:`. | No use of `.lines` in `client/src/*.tsx`. |
| G8 | **PayPal evidence flags are inferred and the derivation is invisible.** `order_confirmation = true` is set because a `seller_transaction_id` exists (that is a transaction record, not an order confirmation). `customer_communication = true` is set if *any* message has text, including the seller's own. `proof_of_delivery` comes from a submitted evidence type. The UI shows these as plain "marked available". | `paypal.ts:121–142`. |
| G9 | **No refund records.** No refund field exists anywhere. Credit and duplicate disputes get a `[NEEDS MERCHANT INPUT: … refund ID …]` marker. | `evidence.ts:44`, `shared/disputes.ts:5`. |
| G10 | **No documents.** No upload route, no storage, no inspection. "Available" means a flag says so. | No such route in `app.ts`; schema v1–v3. |
| G11 | **Merchant-provided information is not distinguished from system records.** In demo data every flag is a merchant-style assertion. In sandbox data flags are inferred from PayPal. Both look the same downstream. | `Source` is per dispute, not per field. |

Not gaps (checked): contradictions already reference both records; contested facts are never cited; buyer responses
contain no merchant fields; AI never receives `dispute_id`, `order_id`, dates or the buyer's message.

## 4. Recommended provenance data model

### 4.1 Principle: derive, don't store

All provenance in Phases 7.2–7.4 is **derived on every request by deterministic rules from the existing record and the
existing `analyzeDispute` output**. Reasons:
- The evidence engine stays the single source of truth; a stored status could drift from it.
- Demo fixture files are the source of truth for demo data; sandbox data is never stored. Derivation works the same for both.
- No migration is needed (§5).

The provenance layer is a new pure module, `server/src/provenance.ts`, that **reads** `Dispute` + `Analysis` and
**never changes** `evidence[].status`, readiness, contradictions or draft text.

### 4.2 Verification state (derived)

```ts
export type VerificationState = "verified" | "unverified" | "missing" | "conflicting";
```

Derived per evidence finding, first match wins:

| Rule | State | Why |
|------|-------|-----|
| Any of the finding's record paths is named in a contradiction | `conflicting` | Same `contestedPaths` set the engine uses |
| `status === "missing"` | `missing` | The record explicitly marks it not available |
| `status === "unverified"` | `unverified` | Not supplied, or incomplete (flag without number, number without flag) |
| `status === "available"` | `verified` | The rules accept it and nothing contradicts it |

This is a pure mapping over the engine's output, so it can never disagree with the evidence statuses or the readiness
counts. Readiness itself is unchanged.

**Important definition (needs approval, §11 D1).** "Verified" here means *consistent with the supplied record and not
contradicted by it*. DisputeDesk does not inspect documents or contact carriers. The UI label should therefore read
**"Verified against record"**, with the existing sentence "DisputeDesk does not inspect the documents themselves" kept
next to it.

### 4.3 Evidence reference (derived, stable)

```ts
export type SourceType =
  | "dispute_record"       // dispute_id, reason, status, amount, create_time, seller_response_due_date
  | "buyer_statement"      // customer_message (the buyer's claim; never support for a merchant claim)
  | "order_record"         // order.order_id, order.item, order.shipping_status (demo)
  | "transaction_record"   // PayPal seller_transaction_id and item (sandbox)
  | "delivery_record"      // order.tracking_number, evidence.shipping_tracking, evidence.proof_of_delivery
  | "merchant_provided"    // evidence.order_confirmation, evidence.customer_communication flags in demo data
  | "refund_record"        // reserved: no field exists (G9); never emitted until one does
  | "document";            // reserved: no upload exists (G10); never emitted until one does

export interface EvidenceRef {
  // Stable and deterministic: "<source>:<dispute_id>:<path>", e.g. "demo:DEMO-1001:order.tracking_number".
  ref: string;
  source_type: SourceType;
  // Where the record came from: the synthetic fixture or the read-only PayPal sandbox record.
  origin: "demo_fixture" | "paypal_sandbox";
  // The record this field belongs to, when one exists: order ID (demo) or seller transaction ID (sandbox); else null.
  record_id: string | null;
  field: string;                       // record path, e.g. "order.tracking_number"
  value: string | boolean | null;      // null = not on record
  // Only a real time from the record. Null for every evidence field today (G4). Never the seed time.
  recorded_at: string | null;
  // How DisputeDesk got this value, e.g. "Set because the PayPal record has a seller transaction ID" (G8).
  derivation: string | null;
  verification: VerificationState;     // of the finding this ref supports; for plain fields, "verified" if present and uncontested, "missing" if null
}

export interface FindingProvenance {
  evidence_id: EvidenceKey;
  verification: VerificationState;
  refs: string[];                      // EvidenceRef.ref values
  supports: string;                    // from the engine's relevance text: how this evidence supports a claim
}
```

`source_type` is decided by a fixed table keyed by `(origin, path)`, so the same field always gets the same type.
Refund and document types are declared but **never produced** until those capabilities exist. The UI and copy must not
mention them as available.

### 4.4 Claim mapping

```ts
// Added to DraftLine (optional, additive). records: string[] stays as it is.
refs?: string[];

export type ClaimSupport = "supported" | "unsupported" | "flagged" | "not_a_claim";

export interface ParagraphClaim {
  paragraph: number;          // numbered like DraftCheck: merchant-written paragraphs only
  excerpt: string;
  support: ClaimSupport;
  refs: string[];             // records whose values the paragraph repeats (deterministic match)
  reasons: string[];          // same wording as DraftCheck flags
}
```

- **Server-written lines** (rule draft and AI draft): `refs` is filled from the existing `records` paths. No new logic, just ID mapping.
- **AI lines**: `cites` (R1…) already map to paths and then to refs. Gemini keeps seeing only `R` ids, never refs (§8).
- **Merchant-edited paragraphs**: a paragraph is `supported` only when it repeats a supplied value (tracking number,
  order ID, item, amount, a shipped status on record) **and** passes `problems()`. It is `flagged` when `problems()`
  finds an issue, as today. It is `unsupported` when it contains a factual-claim pattern (shipping, delivery, receipt,
  refund, communication, tracking, a number) but repeats no supplied value. It is `not_a_claim` otherwise. The check stays
  advisory: nothing is removed or blocked, because the merchant may hold records DisputeDesk does not.

### 4.5 Unsupported claims

- Widen the claim patterns so active-voice and possession claims are caught (G6): "we shipped/sent/dispatched", "the
  buyer has/had it", "we refunded", "we told the buyer". These feed both the AI checks and the merchant check.
- An `unsupported` claim is shown as "No supporting record in DisputeDesk", never as false and never as verified.
- The system never fills the gap. The existing `[UNSUPPORTED: …]` and `[NEEDS MERCHANT INPUT: …]` markers stay the only
  draft-side response.

## 5. Database migration implications

**No migration is needed for Phases 7.2–7.5.**
- Verification states, refs, source types and claim mapping are derived per request (§4.1).
- No new audit event is needed: provenance travels in responses that are already audited (`analysis_viewed`,
  `ai_draft_generated`), and the edit check stays unaudited by design.
- If a later decision adds an event (for example `provenance_viewed`), it needs migration v4 with `rebuildAuditLog(V4_AUDIT_EVENTS)`,
  the same pattern as v3. Released migrations v1–v3 stay untouched, and the append-only triggers are recreated.

Future, outside 7.2–7.5, each needing approval:

| Capability | Likely change |
|------------|---------------|
| Refund records (G9) | New optional fixture field (for example `order.refund_id`). `order_json` already stores the order object as JSON, so no column is needed. `validateDispute` would copy the new field. Sandbox: map PayPal refund data, if the read-only detail record has it. Possibly no migration. |
| Per-field recorded times | Optional fixture fields, plus keeping PayPal evidence dates in `normalizeDetails`. Possibly no migration. |
| Uploaded documents (G10) | New tables (for example `evidence_documents`: id, dispute_id, account_id, sha256, media type, size, stored path, uploaded_at), file storage outside the web root, size and type limits, malware scanning, an access-checked download route, and new audit events. Migration v4 or later. Inspection would be separate again, and nothing may claim inspection before it exists. |

`sample-dispute.json` must stay one object and keep its current flags, so `draft-response.js` and
`evidence-checklist.js` keep working. Any new optional fields must not change the `evidence` flag object's shape.

## 6. API changes required

All changes are **additive**: no field is removed or renamed, no status changes, and no new route.

| Route | Change |
|-------|--------|
| `POST /api/analysis` | Add `provenance: { refs: EvidenceRef[]; findings: FindingProvenance[] }`. Add optional `refs` to each `draft.lines[]`. `evidence[].status`, `contradictions`, `next_steps` and `draft.text` stay byte-identical. |
| `POST /api/analysis/ai` and `/ai/example` | Add `ref` to each `AiFact`; add `refs` to draft lines and explanations (mapped from `cites`). `cites` stay `R…`. |
| `POST /api/analysis/check` | Add `claims: ParagraphClaim[]`. `checked`, `flagged` and `markers_left` stay as they are. Still advisory, not stored, not audited, no Gemini. |
| `GET /api/disputes` | No change (`readiness.conflicts` already counts contradictions). Optionally add `verification` counts later. |
| Buyer routes | **No change.** A test must assert that no `provenance`, `refs` or `ref` key appears in buyer responses. |
| `GET /api/intelligence` | No change in 7.2–7.5. |

No new route means the route role-table test needs no new entry. If one is added later (for example a provenance-only
GET), it must enter the role table and use `findDispute`.

## 7. Frontend changes required

| Where | Change |
|-------|--------|
| `AnalysisPanel.tsx` evidence list | Show the verification state ("Verified against record", "Unverified", "Missing", "Conflicting") beside or in place of the status badge, plus each ref: source type, record ID, field, value, "No time on record" when `recorded_at` is null, and the derivation line for sandbox flags (G8). Keep the "does not inspect documents" note. |
| Draft section | Keep the textarea as it is. Add a "Sources" list under the draft built from `draft.lines` (claim text → refs), so the generated draft's claims are traceable without changing the editable text. |
| "Check my edits" result | Show per paragraph: supported (with refs), unsupported ("No supporting record in DisputeDesk"), flagged (reasons, as today), or not a claim. Wording stays advisory. |
| AI panel | Show `Cites:` as refs with source types. |
| Shared UI | Verification badges reuse the existing badge/tone styles. No inline `style=` (CSP). Text labels, not colour alone. |
| Buyer screens, Landing, Devpost text | No provenance UI for buyers. Copy must not claim document inspection, refund records or uploads. |
| Admin | Sees the same read-only provenance through `/api/analysis`; no draft or check actions (unchanged). |

## 8. Authorization and privacy implications

- **Merchant-only content.** Refs carry order IDs, tracking numbers and evidence flags, all merchant-only. They appear
  only in merchant/admin routes, behind `findDispute` and `canAccess`. Another account's dispute still answers 404.
- **Buyers.** `toBuyerRecord` is unchanged and provenance is never attached to buyer responses. Buyer guidance and
  buyer AI never see refs.
- **Gemini.** Refs contain `dispute_id` and sometimes `order_id`, which Gemini is deliberately never sent. Refs are
  mapped server-side after the answer; the prompt keeps using `R1…` ids with the same allowlist.
- **Audit log.** No provenance content is written to `audit_log.detail`; existing events are reused.
- **PayPal.** Still token + GET only. Provenance only labels what `normalizeDetails` already maps. Sandbox data stays unstored.
- **Demo labelling.** `origin: "demo_fixture"` on every demo ref, alongside the existing `DEMO DATA` draft label.
- **Admin read-only.** Unchanged; the check route stays merchant-only.

## 9. Testing strategy (including backward compatibility)

All tests use synthetic data, in-memory databases and mocked PayPal and Gemini.

**Unit (`provenance.test.ts`)**
- The verification table: every combination of status × contested, for all four evidence keys, including
  tracking-flag-without-number and number-without-flag.
- Ref determinism: same input gives the same refs; refs are unique within a dispute; demo vs sandbox origin.
- Source-type table: every path maps to exactly one type; `refund_record` and `document` are never produced.
- `recorded_at` is null for every evidence field and never equals the seed time.
- Sandbox derivation lines from `normalizeDetails` fixtures (G8).

**Claim mapping**
- Supported, unsupported, flagged and not-a-claim cases, including the three G6 sentences ("We shipped the order." must
  no longer pass when shipping is not on record).
- A paragraph that repeats a contested value is never `supported`.
- Quoted buyer lines (`>`) and server lines are still skipped.

**Backward compatibility (regression gates)**
- For all 16 demo fixtures: `analyzeDispute` output with the new fields removed is deep-equal to today's, and
  `draft.text` is byte-identical.
- `readiness()` counts unchanged for every fixture.
- `buildIntelligence` output unchanged.
- `DraftCheck.flagged` unchanged for the existing assist tests (new claim patterns may add flags; each one is reviewed
  and listed in the 7.3 report).
- `evidence-checklist.js` and `draft-response.js` still run on `sample-dispute.json`.
- The existing 202 server and 86 client tests pass.

**Authorization and privacy**
- Buyer responses contain no `provenance`, `refs` or `ref` key.
- Another account's dispute: still 404, identical body, audited.
- The AI request (`buildAiRequest`) contains no ref string, `dispute_id` or `order_id`.
- Admin gets provenance on `/api/analysis` but still 403 on `/ai` and `/check`.

**UI (`ui.test.ts`)**
- Badges render all four states as text; refs show "No time on record"; the check result shows each support state;
  buyer screens render no provenance; no inline `style=`.

## 10. Incremental implementation phases

| Phase | Work | Output | Gate |
|-------|------|--------|------|
| **7.2** Provenance data model and deterministic rules | `shared/types.ts` types (§4); `server/src/provenance.ts` (verification table, source-type table, stable refs, sandbox derivation text); unit tests. Not wired to routes yet. | Pure module and tests | All existing tests pass; analysis output unchanged |
| **7.3** API integration and claim mapping | Attach `provenance` to `/api/analysis`; `refs` on draft lines and AI facts; `claims` on `/api/analysis/check`; widen claim patterns (G6) in `assist.ts`, shared by the AI and merchant checks. | Additive API fields | Compatibility gates (§9), buyer and Gemini privacy tests |
| **7.4** Merchant provenance interface | Verification badges and refs in the evidence list; "Sources" under the draft; claim support in the check result; AI cites as refs. | UI | UI tests; browser check at 1440/1024/375 with an isolated database |
| **7.5** Regression, privacy and security verification | Full suites, typechecks, build; live probe on an isolated server (roles, 404s, buyer projection, Origin guard); network log shows no PayPal or Gemini calls; a copy and claims review for wording that implies document inspection. | Verification report | PASS before any commit is suggested |

Later, each separately approved: refund records, per-field times, document upload, document inspection.

## 11. Risks and unresolved design decisions

| # | Decision or risk | Recommendation |
|---|------------------|----------------|
| D1 | **What "Verified" means.** No independent verification exists; "available" means a record field says so. | Use the four states, define verified as "consistent with the supplied record and not contradicted", and label it **"Verified against record"** in the UI. Alternative: rename it "On record" and avoid the word "verified" entirely. |
| D2 | **PayPal inferred flags (G8).** `order_confirmation` comes from a transaction ID, and `customer_communication` from any message, the seller's included. | 7.2–7.4: keep the engine unchanged and show the derivation line. Fixing the mapping itself (for example counting only buyer and seller exchanges) would change sandbox statuses; decide separately. |
| D3 | **Claim matching for merchant edits is heuristic.** Patterns can miss claims and can over-flag. | Keep it advisory, never blocking; label results "based on DisputeDesk's records only". Optional later step: explicit citation markers the merchant inserts (for example `[REF: order.tracking_number]`), validated server-side. |
| D4 | **Widening the claim patterns (G6)** will add flags to some drafts that pass today. | Accept it; list every new flag in the 7.3 report. |
| D5 | **Ref format** exposes `dispute_id` and `order_id` inside the ref string. | Acceptable: merchant and admin only, never sent to buyers or Gemini. Alternative: opaque hashes, which are harder to read and debug. |
| D6 | **Recorded timestamps** are absent for evidence fields. | Show "No time on record"; never use `updated_at`. Adding real times is a fixture change for later. |
| D7 | **Draft text and lines drift once edited.** Line refs describe the generated draft, not the edited text. | The "Sources" list says "for the generated draft"; edited text is covered by `claims` from "Check my edits". |
| D8 | **Refund and document source types** are declared but unused. | Keep them reserved and untested in the UI; add them only with the capability. |
| D9 | Uncommitted UI fixes (`Landing.tsx`, `styles.css`) sit on top of the baseline. | Commit or set them aside before 7.2 so provenance work starts from a clean tree. |

**Risk summary:** provenance can overstate certainty if "verified" is read as independent proof (D1, D2). That is the
main risk, handled with wording, derivation lines and the existing "does not inspect documents" note. All other
changes are additive and derived, so existing disputes, drafts, readiness, insights and buyer views stay unchanged and are guarded by
the compatibility tests.

## 12. Approval needed before Phase 7.2

1. The data model in §4: derived verification states, the `EvidenceRef` and `SourceType` tables, and `ParagraphClaim`.
2. The meaning and label of "Verified" (D1).
3. The API changes in §6: additive fields only, no new route, no migration.
4. Widening the claim patterns (D4), accepting new advisory flags.
5. Keeping the PayPal mapping unchanged in this phase (D2).
