# DisputeDesk AI: Stage 2.2 Release Polish Report

**Date:** 2026-11-09
**Base:** `master` at `4582ef9` (Stage 2.2 release audit). The changes below are uncommitted.
**Source:** `reports/phase-2.2-release-audit.md`, findings M1 and L1, plus the documentation gap it listed.

## 1. Summary

- **M1 fixed.** A merchant-confirmed gap stays in "Needs attention". The overview now reads, for example, "Needs attention: 2 (1 merchant-confirmed) · Record available: 2 · Conflicting: 0. Counts only: review each item before you respond." Confirming can no longer lower that number.
- **L1 fixed.** In the merchant view, a confirmed row shows "DisputeDesk has not seen the record. Your confirmation does not change its evidence status." directly under the tag, outside the folded guidance.
- **Docs.** The README (overview, demo script, limits) and the Devpost copy now describe confirmation as a merchant statement, not verification, for demo disputes only.

Client display and documentation only. There are no server, API, database, evidence-engine or dependency changes.

## 2. Changed files

| File | Change |
|------|--------|
| `client/src/AnalysisPanel.tsx` | New overview count; new `CONFIRMED_NOTE` constant and inline note in the merchant view. |
| `client/src/styles.css` | `.confirm-note`: full text colour, 6px top margin, `overflow-wrap: anywhere`. |
| `client/src/ui.test.ts` | Three tests updated for the new count format; two new tests. |
| `README.md` | Overview bullet, demo-script step 2, a re-run note, a limits bullet, and an account-count correction. |
| `reports/devpost-description.md` | New paragraph after the evidence checklist paragraph. |
| `reports/phase-2.2-release-polish-report.md` | This report (new). |

No existing report was changed apart from the Devpost copy, which the task asked for.

## 3. Implementation details

### 3.1 Needs attention (M1)

In `ChecklistItems`:
- `Needs attention` = every applicable item whose status is `missing` or `needs_confirmation`, confirmed or not.
- The bracket counts the gaps with a current confirmation, i.e. the same `isConfirmed` rule as before, so stale confirmations still don't count.
- `Record available` and `Conflicting` still count only engine statuses. A confirmation never adds to `Record available`.
- The separate "Merchant-confirmed: n" segment is replaced by the bracket. The bracket is always shown, including "(0 merchant-confirmed)", so the format doesn't shift when a confirmation is added.

### 3.2 Inline disclaimer (L1)

- New export `CONFIRMED_NOTE` = "DisputeDesk has not seen the record. Your confirmation does not change its evidence status."
- It renders as `<p class="confirm-note">` right after the row header (label, key tag, tier tag, status badge, "Merchant-confirmed" tag) and before "Why it may matter". It is not inside a `<details>` element, so no click is needed.
- Reading order: status badge, then tag, then note. Screen readers meet them in that order.
- Shown only in the merchant view, and only when the item has a current confirmation. Admin keeps its own inline line ("Merchant-confirmed by {name}, {date}. DisputeDesk has not seen the record.").
- The status badge, the dashed outline tag, the button and the longer `CONFIRM_LIMIT` sentence next to the button are unchanged.
- The note wraps on narrow screens (`overflow-wrap: anywhere`). No inline styles, so the CSP is unchanged.

### 3.3 Documentation

README:
- **Overview:** a bullet saying confirmation is the merchant's statement. It covers that DisputeDesk has not inspected the record, that the status and Needs attention are kept, that statuses, readiness, draft and AI input don't change, and that it is demo-only with sandbox disputes never stored or changed.
- **Demo script, step 2:** confirm Shipping tracking on DEMO-1001, show the kept badge, the tag, the note and the "1 merchant-confirmed" count, then withdraw it.
- **Corrections:**
  - "nothing is saved" was no longer true. It now says drafts aren't saved, but confirmations are saved until withdrawn.
  - "six synthetic demo accounts" is corrected to seven (admin, Merchants A to D, Buyers A and B); Merchant D was added in 2.2a.
- **Limits:** a bullet saying a confirmation is the merchant's own statement, for demo disputes only.

Devpost copy: one paragraph with the same points. No new capability, outcome or performance claim.

## 4. Unchanged, as required

- Evidence engine (`server/src/evidence.ts`), checklist statuses (`server/src/checklist.ts`), provenance, readiness (`shared/readiness.ts`), drafts, claim checks, Insights and Gemini inputs: not touched.
- Server routes, access controls, `listConfirmations` filtering, stale-confirmation handling, schema and migrations: not touched. `git diff` shows no file under `server/` or `shared/`.
- No dependency was added. No migration was run. No PayPal or Gemini request was made.

## 5. Tests

**New client tests** (`client/src/ui.test.ts`):
1. *"confirming every gap on every demo record never lowers Needs attention or adds to Record available"*. For every demo record:
   - before any confirmation, the line reads `Needs attention: g (0 merchant-confirmed) · Record available: a · Conflicting: c.`;
   - after confirming every gap, it reads `Needs attention: g (g merchant-confirmed) · Record available: a · Conflicting: c.`;
   - the inline note appears once per confirmed gap;
   - "Available in records" appears exactly as often as before.
2. *"the merchant's caveat sits in the row under the tag, outside the folded guidance; admin keeps its own line"*. It checks the order status badge → tag → note → first `<details>`, and that admin gets the "Merchant-confirmed by … DisputeDesk has not seen the record." line and not the merchant note.

**Updated client tests:**
- The overview test expects `(0 merchant-confirmed)`.
- The merchant-confirm test expects `Needs attention: {all gaps} (1 merchant-confirmed)`. Before, it expected one fewer.
- The stale-confirmation test also checks that the merchant note is absent for a confirmation that is not shown.

**Privacy, access and stale behaviour:** the server tests for these are unchanged and still pass. They cover merchant-only writes, admin read-only, buyer 403, the identical 404 for another account, hidden stale confirmations, and Gemini, Insights and buyer isolation.

**Results** (all run on the working tree described in section 7):

| Check | Result |
|-------|--------|
| Server tests (`npm test`) | 247 tests, 247 passed, 0 failed |
| Server typecheck | Exit 0 |
| Client tests (`npm test`) | 103 tests, 103 passed, 0 failed (101 before, plus 2 new) |
| Client typecheck | Exit 0 |
| Client production build | Built. Existing warning only: main chunk over 500 kB. |

## 6. Remaining limitations

- **No browser check this round.** Running the app needs a database, and starting the server runs the v4 migration even on a scratch copy. This task forbids migration runs, so the layout was verified by server-rendered tests only (element order, the note outside `<details>`). The 320px wrap and 44px targets were last checked in the 2.2b browser pass, before this change.
- The audit's low findings L2 to L6 are not addressed:
  - L2: no rate limit on confirm or withdraw;
  - L3: clicks are ignored silently while another save is pending;
  - L4: a hidden stale confirmation can't be withdrawn from the UI and comes back if the item becomes a gap again;
  - L5: the confirm request has no abort signal;
  - L6: a formatting nit in `store.ts`.
- The real database is still at schema v3. Back it up before the first start of this code (audit condition M2).
- A confirmation remains the merchant's statement; DisputeDesk never sees the record.

## 7. Git state

| Item | Value |
|------|-------|
| Branch | `master` |
| HEAD | `4582ef9` |
| Unpushed commits | 4: `c841345`, `c6ae9c2`, `771c99e`, `4582ef9` |
| Modified (uncommitted) | `README.md`, `client/src/AnalysisPanel.tsx`, `client/src/styles.css`, `client/src/ui.test.ts`, `reports/devpost-description.md` |
| Untracked | `reports/phase-2.2-release-polish-report.md` |
| Stash | Empty; nothing reset, cleaned or stashed |

Nothing is committed or pushed. Waiting for approval.
