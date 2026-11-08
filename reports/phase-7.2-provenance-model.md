# DisputeDesk AI — Phase 7.2: Provenance Data Model and Deterministic Rules

Date: 2026-11-07
Approval: the Phase 7.1 data model and API plan were approved as proposed, including the "Verified against record" meaning.
State: changes are in the working tree, **not committed, not pushed, not deployed**.

## 1. What was built

A pure provenance layer that reads a dispute record and the evidence engine's analysis and returns references and
verification states. It is **not connected to any API route yet** (that is Phase 7.3), so no response, screen or
stored data changes.

| File | Change |
|------|--------|
| `shared/types.ts` | New types only: `VerificationState`, `SourceType`, `EvidenceRef`, `FindingProvenance`, `Provenance`. No existing type changed. |
| `server/src/provenance.ts` | New. `buildProvenance(dispute, analysis)` and `refId(dispute, path)`. |
| `server/src/provenance.test.ts` | New. 6 tests. |

No schema, migration, database contents, dependency, configuration or route changed. No PayPal or Gemini call is made
by the new code or its tests.

## 2. Rules

**Verification state of an evidence finding** (first match wins):

| Condition | State |
|-----------|-------|
| A contradiction names this finding's own evidence flag (`evidence.<id>`) | `conflicting` |
| The rules' status is `missing` | `missing` |
| The rules' status is `unverified` | `unverified` |
| The rules' status is `available` | `verified` (verified against record) |

**Plain fields** (not evidence flags): contested → `conflicting`; not on record → `missing`; on record → `verified`,
except the buyer's message, which is always `unverified` (§4).

**References:** `"<source>:<dispute_id>:<path>"`, in a fixed field order. A field is listed when it has a value or when
the analysis cites it (so every gap has a ref to show). Fields that are neither are left out.

**Source types:**

| Field | Demo | PayPal sandbox |
|-------|------|----------------|
| `dispute_id`, `reason`, `status`, `amount`, `create_time`, `seller_response_due_date` | dispute_record | dispute_record |
| `customer_message` | buyer_statement | buyer_statement |
| `order.order_id`, `order.item` | order_record | transaction_record |
| `order.shipping_status` | order_record | order_record (PayPal never sets it) |
| `order.tracking_number`, `evidence.shipping_tracking`, `evidence.proof_of_delivery` | delivery_record | delivery_record |
| `evidence.order_confirmation` | merchant_provided | transaction_record |
| `evidence.customer_communication` | merchant_provided | dispute_record |

`refund_record` and `document` are declared but never produced: DisputeDesk has no refund field and no document upload.

**Other fields:** `record_id` is the order ID (or seller transaction ID) for order and evidence fields, and the dispute ID
for dispute-level fields. `recorded_at` is always `null`, because no evidence field carries a time, and the database's
import time is never used. `derivation` is set only for values inferred from a PayPal record, for example: "Set because
the PayPal record has a seller transaction ID. That is a transaction record, not an order confirmation document."

## 3. Guarantees kept

- The evidence engine stays the source of truth. `buildProvenance` never changes the analysis (tested with a deep
  copy on all 16 demo records), and its states can't disagree with the engine: `verified` only when the status is
  `available`, and the reverse; `missing` and `unverified` only when the status says so.
- Nothing is stored; demo and sandbox records go through the same rules.
- No invented facts: values are copied as supplied, and empty strings count as not on record.
- Nothing claims refunds, documents or recorded times that DisputeDesk doesn't have.

## 4. Changes from the Phase 7.1 proposal

| Point | 7.1 proposal | Built | Why |
|-------|--------------|-------|-----|
| When a finding is `conflicting` | Any of the finding's record paths is contested | A contradiction names the finding's **own evidence flag** | The tracking finding also cites the shipping status. A delivery conflict on the shipping status would otherwise wrongly mark tracking as conflicting. Every contradiction rule names the flag it concerns, which is also the rule the engine uses to downgrade contested evidence. Tested. |
| Buyer's message | Verified when present | Always `unverified` when present | It is the buyer's claim. Having it on record must never make it look verified. |

## 5. Tests and results

| Check | Result |
|-------|--------|
| Server tests | **208/208 pass** (202 before, 6 new) |
| Client tests | **86/86 pass** |
| Server typecheck | Pass |
| Client typecheck | Pass (shared types) |

New tests:
1. Available → verified, false → missing, not supplied → unverified.
2. Each of the four contradiction rules marks its own evidence as conflicting; a delivery conflict does not spill onto tracking.
3. For all 16 demo records: states match the engine's statuses, and the analysis is unchanged.
4. Refs are deterministic and unique, labelled `demo_fixture`, have no time and no derivation, never use the reserved
   types, and cover every path cited by findings, contradictions and draft lines.
5. Source types, record IDs and values for the sample record; the buyer's message is unverified; uncited empty fields are left out.
6. A synthetic PayPal record (run through `normalizeDispute` and `normalizeDetails`, no network): `paypal_sandbox` refs,
   transaction source types, the seller transaction ID as record ID, and derivation lines, including "from either
   party" when only the seller wrote.

## 6. Next: Phase 7.3

Attach `provenance` to `POST /api/analysis`; add `refs` to draft lines and AI facts; add per-paragraph `claims` to
`POST /api/analysis/check`; widen the claim patterns ("We shipped the order." and "the buyer has it" currently pass the
edit check). The 7.1 compatibility gates apply: unchanged statuses, readiness, draft text, insights and buyer responses,
and no refs sent to Gemini or buyers.

Uncommitted in the tree besides this phase: `client/src/Landing.tsx` and `client/src/styles.css` (earlier UI fixes).
