# DisputeDesk AI — Phase 7.4: Merchant Provenance Interface

Date: 2026-11-07
Baseline: Phase 7.3 (provenance, refs and claims in the API).
State: changes are in the working tree, **not committed, not pushed, not deployed**.

## 1. What was built

The merchant (and read-only admin) workspace now shows the provenance the API returns. UI only: no server, API, type,
schema or dependency change in this phase.

| Where | What the merchant sees |
|-------|------------------------|
| Evidence analysis | A **"Verified against record"** or **"Conflicting"** tag beside each item's rule status. Each item's sources, one per line: field and value, source type, demo or PayPal sandbox record and its ID, **"No time on record"**, and the source's own state. For sandbox values, the line saying how DisputeDesk derived the flag. |
| Evidence note | Keeps "DisputeDesk does not inspect the documents themselves" and adds: "Verified against record" means the supplied record backs it and nothing in the records contradicts it. |
| Response draft | A collapsed **"Sources for the generated draft"** list: each generated line and the record fields it rests on, noting that edits are covered by Check my edits. |
| AI-assisted draft | The same Sources list. AI cites name their field: "R5 Order confirmation = marked available (evidence.order_confirmation)". |
| Check my edits | Every paragraph, numbered as before, with one of: **Backed by DisputeDesk's records** (plus the record fields), **Not in DisputeDesk's records** (with the reason), **Check against your records** (the existing flag reasons) or **No factual claim found**. |

Missing and unverified items get no extra tag, because the status badge already says the same thing. The first browser
pass showed "Missing Missing", so the tag was limited to the two states that add information.

## 2. Wording rules kept

- "Verified" appears only as "Verified against record", always next to the note that no documents are inspected.
- Claim results never say true, false, wrong, removed or verified: they ask for a check against the merchant's own
  records (tested).
- The edit-check summary no longer says "Nothing … goes beyond the records" when a paragraph makes a claim with no
  record behind it. It says how many paragraphs make a claim DisputeDesk has no record for.
- Refund records and documents never appear as sources (tested): DisputeDesk has neither.
- Raw ref IDs (`demo:DEMO-1001:…`) are never shown; the merchant sees field names.
- An analysis without `provenance` (an older server) renders exactly as before (tested).

## 3. Files modified

| File | Change |
|------|--------|
| `client/src/AnalysisPanel.tsx` | `VERIFICATION`, `CLAIM_LABELS`, `fieldOf`, `RefList`, `DraftSources`, `ClaimList`; evidence rows, `DraftEditor` (`sources` prop), `CheckResult` and AI cites use them. |
| `client/src/styles.css` | One "Provenance (Phase 7.4)" block after `.tag-standard`, using existing colour tokens only (light and dark); the Sources toggle joins the 44px coarse-pointer target rule. |
| `client/src/ui.test.ts` | 5 new tests; 2 imports. |

No inline styles (strict CSP), no new dependency, no change to the landing page, buyer views or admin pages.

## 4. Tests and checks

| Check | Result |
|-------|--------|
| Client tests | **91/91 pass** (86 before, 5 new) |
| Server tests | **222/222 pass** (unchanged) |
| Client typecheck | Pass |
| Server typecheck | Pass |
| Production build | Pass (the existing over-500 kB chunk warning only) |

New UI tests:
1. Verification tags and source lines for the sample record, the inspection note, and no refund or document source.
2. The DEMO-1002-style conflict reads "Conflicting"; sandbox sources show their derivation text.
3. The Sources list appears under the draft; an analysis without provenance renders as before.
4. Claim results for the four example sentences, in advisory words; an unsupported-only result does not say everything is on record.
5. AI cites show their field; the AI draft lists sources; no raw ref ID is rendered.

## 5. Browser check

Run against an **isolated server** on a scratch database in the session scratchpad (a temporary `server-isolated` entry
in `.claude/launch.json`, removed afterwards; `git diff` on it is empty). The real `server/data/disputedesk.sqlite` was
not opened (its files are unchanged). Signed in as Demo Merchant A with the README password, typed into the localhost
sign-in form; no credential file was written.

| Width | Theme | Checked | Result |
|-------|-------|---------|--------|
| 1440 | Dark | DEMO-1001 evidence and sources; Check my edits on the four example paragraphs | Correct states and labels; no element overflows; every new text and tag at least 4.5:1 contrast |
| 1024 | Light | Same, with the Sources list open | No overflow; contrast at least 4.5:1 |
| 375 | Dark, touch | DEMO-1002 (contradiction case) | "Conflicting" on proof of delivery; tags wrap instead of overflowing; no page-level horizontal scroll; Sources toggle 44px tall |

Network: only `/api/auth`, `/api/disputes`, `/api/analysis`, `/api/analysis/check` and `/api/health`. No AI draft,
validation example or PayPal sandbox request was made, so no Gemini or PayPal call happened. Console: one 401 from the
signed-out session check before sign-in, already known from earlier phases.

## 6. Known limitations

- The Sources list describes the **generated** draft. Once the merchant edits, only Check my edits describes the
  edited text (decision D7).
- Claim support is heuristic (see the 7.3 report). The labels say "backed by DisputeDesk's records", not proven.
- The AI result view was checked in unit tests only; the browser check didn't generate an AI draft, to avoid a live
  Gemini call.
- Admin sees provenance read-only. The Check my edits results are merchant-only, as before.

## 7. Verdict

**PASS.** The approved 7.4 items are in place: verification badges and sources in the evidence list, Sources under the
draft, claim support in the check result and AI cites as fields. All suites, typechecks and the build pass, and the
browser check passed at 1440, 1024 and 375. Nothing is committed. Phase 7.5 (regression, privacy and security
verification) has not been started.
