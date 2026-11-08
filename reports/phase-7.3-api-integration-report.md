# DisputeDesk AI — Phase 7.3: API Integration and Claim Mapping

Date: 2026-11-07
Baseline: Phase 7.2 (provenance model, not wired), built on the approved Phase 7.1 architecture.
State: changes are in the working tree, **not committed, not pushed, not deployed**. No UI changed (Phase 7.4 not started).

## 1. Git baseline and preserved changes

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD | `44dcf68` (unchanged; 5 commits ahead of origin, nothing pushed) |
| Uncommitted before this phase | `client/src/Landing.tsx`, `client/src/styles.css` (earlier UI fixes), `shared/types.ts` (7.2 types), untracked `server/src/provenance.ts`, `server/src/provenance.test.ts`, and the reports in `reports/` |

All of these were preserved. `Landing.tsx` and `styles.css` were not touched (their diffs are the same size as before:
6 and 8 lines). Nothing was reset, stashed, cleaned or overwritten; no report was edited.

**7.2 code compared with the 7.2 report:** they match. The verification rules, source-type table, ref format, `null`
`recorded_at` and the sandbox derivations are implemented exactly as reported. No discrepancy.

## 2. Files modified

| File | Change |
|------|--------|
| `shared/types.ts` | Additive only: optional `DraftLine.refs`, `Analysis.provenance`, `AiFact.ref`, `AiExplanation.refs`; `DraftCheck.claims`; new `ClaimSupport` and `ParagraphClaim`. |
| `server/src/provenance.ts` | New `withProvenance(dispute, analysis)` and `assistWithRefs(dispute, assist)`. They only add keys. |
| `server/src/app.ts` | `POST /api/analysis` returns `withProvenance(...)`; `/api/analysis/ai` and `/ai/example` wrap their result in `assistWithRefs(...)` **after** Gemini answers. Nothing else changed. |
| `server/src/assist.ts` | Widened claim patterns (shared by the AI and merchant checks); new `mapClaims`; `checkMerchantDraft` returns `claims`. |
| `server/src/claims.test.ts` | New, 7 tests. |
| `server/src/app.test.ts` | 7 new route tests appended; one import added. |

No migration, no new route, no new dependency, no configuration change, no PayPal or Gemini call.

## 3. API response changes (all additive)

| Route | Added | Unchanged |
|-------|-------|-----------|
| `POST /api/analysis` (merchant, admin) | `provenance: { refs, findings }` (from `buildProvenance`); `refs` on every `draft.lines[]`, mapped from its `records` | `evidence`, statuses, `contradictions`, `next_steps`, `draft.text` (byte-identical), readiness |
| `POST /api/analysis/ai` (merchant) | `ref` on each fact; `refs` on each explanation (from its R cites) and each draft line (from `records`) | `cites` stay `R…`; all text, flags, status; the Gemini request |
| `POST /api/analysis/ai/example` (merchant, admin) | Same as above | Same as above |
| `POST /api/analysis/check` (merchant) | `claims: ParagraphClaim[]`, one per checked paragraph | `checked`, `flagged` (shape), `markers_left`; still advisory, not stored, not audited, no Gemini |
| Buyer routes, `/api/intelligence`, `/api/disputes`, auth, admin | Nothing | Everything |

```ts
type ClaimSupport = "supported" | "unsupported" | "flagged" | "not_a_claim";
interface ParagraphClaim { paragraph: number; excerpt: string; support: ClaimSupport; refs: string[]; reasons: string[] }
```

Refs are added on the server **after** `buildAiRequest` built the Gemini request, so the prompt is byte-identical to
Phase 7.2 (verified against the baseline for all 16 records).

## 4. Claim-mapping logic

For each merchant-written paragraph, numbered exactly as `flagged` numbers it (DisputeDesk's own lines, quoted buyer
lines `>` and marker lines are skipped, as before):

1. **Flagged** if the existing checks (`problems()`) find anything. Reasons are the existing wording, unchanged. The
   `flagged` list and the flagged claims are the same paragraphs with the same reasons (tested).
2. Otherwise the paragraph's claims are found by kind. Each kind needs **its own** record:

| Claim kind | Example | Backed by |
|------------|---------|-----------|
| Delivery or possession | "The buyer received the item", "the buyer has it now" | Proof of delivery, verified |
| Shipping | "We shipped the order", "The order was shipped" | An uncontested shipped/delivered status (`order.shipping_status`) |
| Tracking | "Our tracking number is …", "We provided the tracking" | Shipping tracking, verified |
| Order | "The buyer placed the order", "The order was confirmed" | Order confirmation, verified |
| Contact | "We told the buyer about the delay" | Customer communication, verified. **Sandbox records: never**, because PayPal's flag is set by a message from either party |
| Refund | "We refunded the payment" | **Never**: DisputeDesk has no refund record |

3. Repeated identifiers (dispute ID, order ID, tracking number, amount): a **contested** one always flags the paragraph
   (with the rules' contradiction message). An uncontested one backs the paragraph **only when it makes no other
   claim** ("This response concerns order ORDER-1001"). A value repeated next to another claim never backs that claim:
   "The buyer placed the order ORDER-T2" is unsupported when order confirmation is not on record.
4. Result: any contradiction → `flagged`; any claim without a verified record → `unsupported` ("No supporting record in
   DisputeDesk: …"); every claim backed → `supported` with the refs; no claim → `not_a_claim`.
5. Only refs whose verification is `verified` are ever returned as support. A claim kind left with no verified ref is
   reported as unsupported, never supported (defensive; the tests never reach it).

Contested values are never supported: contradiction rules demote contested evidence in the engine, `problems()` treats a
contested shipping status as not on record, and the identifier rule flags contested values. This is tested across all
16 demo records: every supported claim rests only on `verified` refs.

## 5. New and changed advisory flags

The widened patterns live in `assist.ts` and feed `problems()`, so they apply to **both** the merchant edit check and
the AI output checks.

| Pattern | Catches | Deliberately not caught |
|---------|---------|-------------------------|
| `SHIPPED_ACTIVE` | "we shipped", "we dispatched it", "the order shipped" | "we will ship a replacement" |
| `sentGoods` (per record) | "we sent/mailed/posted the keyboard / the order / their package" (goods words plus the recorded item's words) | "we sent the buyer an email", "we posted a reply" |
| `possession` (per record) | "the buyer has it now", "they had the keyboard", "in their possession" | "the buyer has the right to …" |
| `REFUND_CLAIM` | "we refunded", "issued a refund", "the refund was processed" | "we have not refunded" |
| `CONTACT_CLAIM` | "we told / emailed / contacted / let the buyer …" | — |
| `TRACKING_STATEMENT` | "tracking number is …", "we provided the tracking" | — |
| `ORDER_CLAIM` | "the buyer placed the order", "the order was confirmed" | — |

Only the first three affect `problems()` (and so `flagged` and AI checks); the last four are used only for claim
mapping and never flag anything by themselves.

**Behaviour changes against the 7.2 baseline** (only the edit check of the known example sentences changed; nothing else):

| Sentence | 7.2 | 7.3 | Records affected |
|----------|-----|-----|------------------|
| "We shipped the order." | Passed everywhere | Flagged "claims the order was shipped, which the records do not show" where the shipping status is missing or contested | DEMO-1002, 2005, 2009 (DELIVERED status contradicted by missing proof of delivery); DEMO-2008, 2010, 2014 (no shipping status) |
| "We sent the keyboard and the buyer has it now." | Passed everywhere | Flagged "claims delivery, but proof of delivery is not available" (plus the shipping flag where that applies) | Every record without proof of delivery: 11 of 16 |

No AI-check outcome changed in the baseline: the validation example and the AI request are identical for all 16 records,
and every existing AI test passes. A Gemini paragraph using active voice ("We shipped the order") without a shipped status
on record will now be removed as unsupported, which is the intended G6 fix.

## 6. Privacy tests

| Test | Result |
|------|--------|
| Buyer list, buyer explanation, insights and the dispute list contain no `provenance`, `refs`, `ref` or `claims` key and no ref string | Pass |
| The Gemini request body contains no `demo:`/`paypal_sandbox:` ref, no `DEMO-1001`, no `ORDER-1001`, no `provenance`/`ref`/`refs` | Pass (route test with mocked Gemini) |
| The Gemini request is byte-identical to Phase 7.2 for all 16 records | Pass (baseline comparison) |
| Another account's dispute answers 404 with the exact body of a missing dispute on `/api/analysis`, `/ai/example` and `/check` | Pass |
| Admin reads analysis provenance; `/api/analysis/ai` and `/api/analysis/check` answer 403 for admin | Pass |
| Buyers get 403 on `/api/analysis`, `/ai/example` and `/check` | Pass |
| The edit check writes no audit row and stores no text | Pass |
| Existing PayPal read-only, AI fallback, AI rate-limit, audit and role-table tests | Pass (unchanged) |

## 7. Backward-compatibility results

A scratch script (outside the project, synthetic data, no network) dumped, for all 16 demo records, the analysis,
readiness, buyer record, guidance and rules explanation, Gemini request, validation example and edit-check results, plus
insights for every demo account, **before** any change. It was re-run after the change and compared with the new keys
(`provenance`, `refs`, `ref`, `claims`) removed:

| Output | Result |
|--------|--------|
| Analysis (statuses, contradictions, `next_steps`, draft lines, `draft.text`) | Identical, 16/16 |
| Readiness | Identical, 16/16 |
| Buyer record, guidance and explanation | Identical, 16/16 |
| Gemini request | Identical, 16/16 |
| AI validation example | Identical, 16/16 |
| Edit check of the unedited rule draft | Identical, 16/16 (0 claims: every line is DisputeDesk's own) |
| Insights, every account | Identical |
| Edit check of the example sentences | Changed only as listed in §5 |

The route test also checks, through HTTP, that the analysis with the new keys removed deep-equals `analyzeDispute` for
all 16 records, `draft.text` is identical, readiness is identical, and `provenance` equals `buildProvenance`.

## 8. Test, typecheck and build results

| Check | Result |
|-------|--------|
| Server tests | **222/222 pass** (208 before; 7 claim tests, 7 route tests) |
| Client tests | **86/86 pass** |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build (`client`, `npm run build`) | Pass (the existing over-500 kB chunk warning only) |

## 9. Known limitations

- **Heuristic detection.** Claims are found with fixed patterns. They can miss a claim worded another way (for example
  "we sent the buyer an email" is not counted as contact), and the check stays advisory for that reason (decision D3).
- **"Supported" means backed by DisputeDesk's records**, which are yes/no flags and a few values. A communication flag
  shows that communication exists, not what it said; "we told the buyer about the delay" is supported by the flag, not
  by the content of a message. No document is inspected.
- **Refund claims are never supported** because no refund record exists (G9). They are `unsupported` in the merchant
  check; the AI checks do not yet remove a refund claim from Gemini text (Gemini is instructed not to invent facts, and
  the merchant check reports it).
- **Sandbox contact claims are never supported**, even when the seller did write, because the normalised record does
  not keep who wrote each message.
- **Paragraph-level result.** A paragraph with one backed and one unbacked claim is `unsupported`, and its `refs` list
  the records that back the backed part.
- **The edit check's `flagged` list grows** for active-voice and possession wording (§5). This is the intended fix,
  and the client already shows those flags as advisory.
- **Not shown in the UI yet.** `provenance`, `refs` and `claims` are in the API only. The client ignores the new keys
  until Phase 7.4.

## 10. Verdict

**PASS.** All required API changes are in place and additive; every existing output matches the Phase 7.2 baseline,
except the intended new advisory flags listed in §5. The privacy tests pass: no refs or IDs reach Gemini, and none reach
buyers. The full suites, typechecks and build pass. Nothing is committed. Phase 7.4 has not been started.
