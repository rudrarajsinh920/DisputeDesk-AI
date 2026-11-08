# DisputeDesk AI — Phase 8.2: Readiness Fixes

Date: 2026-11-08
Baseline: `4dc39f4` (clean) plus the untracked Phase 8.1 audit report.
State: fixes applied and verified. **Not committed, not pushed, not deployed.**

## 1. Summary

The Phase 8.1 conditions are met. The two P1 claim-checking defects (F-01 and F-02) are fixed and covered by tests,
as are the P2 detection gaps (F-03 and F-04). The submission copy is updated (F-05), and the P3 interface items are
fixed (F-06 to F-09). The signed-in pass at 768px and 320px that 8.1 could not run is done. F-10 (bundle split) is
left as optional.

## 2. Fixes

| ID | Fix | Where |
|----|-----|-------|
| F-01 (P1) | "Reached", "got to", "made it to", "landed with/at" + buyer/customer/recipient, and "in the buyer's hands", are delivery claims. "Tracking shows/confirms … delivered/arrived/receipt/reached" is implied proof of delivery. Both need proof of delivery, on the merchant check and the AI path. | `server/src/assist.ts`: `DELIVERY_CLAIM`, `IMPLIED_PROOF` |
| F-02 (P1) | A contact claim is backed by the communication record only for the fact of contact. When the sentence names what was said (tracking, refund, "about …", "that …", and similar), it is unsupported: "the communication record shows that messages exist, not what they said". `TRACKING_STATEMENT` now also covers "emailed/messaged/texted/forwarded/told the buyer (with/about) the tracking", so the tracking content is checked against its own record. | `assist.ts`: `MESSAGE_CONTENT`, `TRACKING_STATEMENT`, `mapClaims` |
| F-03 (P2) | "The buyer agreed / promised / asked / requested / refused / declined" is a buyer message (flagged). "Agreed to pay" is excluded, because that is what an order confirmation shows. "We offered / promised / proposed" is unsupported: "DisputeDesk holds no record of what was offered or promised". | `assist.ts`: `BUYER_MESSAGE`, `OFFER_CLAIM` |
| F-04 (P2) | "Attached", "enclosed", "attachment", "see the invoice/receipt/photo/…" are unsupported: "DisputeDesk holds no documents, so it can't back an attachment". | `assist.ts`: `ATTACHMENT` |
| F-05 (P2) | README: provenance and Check my edits bullets, the DEMO-1002 Check my edits demo step, and the advisory limit. Devpost: a provenance and claim-checking paragraph, one accomplishment line, and the test count changed from 259 to 316. Video script: a 17-second DEMO-1002 conflict and Check my edits beat, retimed, and trimmed to 394 spoken words (about 2:52, still under 3:00). | `README.md`, `reports/devpost-description.md`, `reports/demo-video-script.md` |
| F-06 (P3) | When the server can't be reached, the sign-in page shows the message as `role="alert"` instead of `role="status"`. Sign-out and session-ended notices stay as status. | `client/src/Login.tsx` (`noticeIsError`), `App.tsx` |
| F-07 (P3) | Sign-in inputs are added to the `(pointer: coarse)` 44px rule. They measure 44px on emulated touch (was 40px). | `client/src/styles.css` |
| F-08 (P3) | The cause was `.close::before` (`position: absolute; inset: -1px`) while `.close` was `position: static`. The gradient border wrapped the full-width section and spilled 1px past the viewport. `.close` is now `position: relative`. | `client/src/index.css` |
| F-09 (P3) | Below 360px the "DisputeDesk" wordmark is screen-reader-only (the link keeps its name), and the header gap is 16px below `sm`. The header stays on one row at 320px. | `client/src/Landing.tsx` |
| F-10 (P3) | Not done (optional). The single 543 kB chunk remains. | — |

### Behaviour change to note

"We told the buyer about the delay." was **supported** in Phase 7.3. It is now **unsupported**, because "about the
delay" is message content that the communication flag can't show. The test was updated on purpose. "We contacted the
buyer." and "We wrote to the buyer." are still supported where communication is on record.

`DELIVERY_CLAIM` and `IMPLIED_PROOF` are also used by the buyer and Insights AI wording checks (`buyer.ts`,
`intelligence.ts`). Those checks are now slightly stricter in the same direction, and their tests still pass.

## 3. Claims probe (22 sentences × 4 records, re-run)

| Sentence | DEMO-1002 / DEMO-2013 before → after | DEMO-1001 before → after |
|---|---|---|
| Tracking confirms the parcel reached the buyer. | supported → **flagged** | flagged → flagged |
| We emailed the buyer the tracking number. | supported → **unsupported** | supported → **unsupported** (tracking marked not available; message content) |
| The buyer agreed to keep the item. | not a claim → **flagged** | not a claim → **flagged** |
| We offered the buyer a refund. | not a claim → **unsupported** | not a claim → **unsupported** |
| Please review the attached invoice. | not a claim → **unsupported** | not a claim → **unsupported** |

Every other result is unchanged. On DEMO-1003 (proof of delivery on record), the delivery sentences are still backed,
by `evidence.proof_of_delivery`. "We have not refunded the order." and "Thank you for reviewing this case." are still
not claims, and "We reached out to the buyer." is not read as delivery.

## 4. Tests, typechecks, build

| Check | Result |
|-------|--------|
| Server tests | **225/225 pass** (222 + 3 new: tracking and message content, agreements/offers/attachments, AI tracking-as-delivery) |
| Client tests | **91/91 pass** (the sign-in test also asserts the alert role) |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build | Pass (the existing over-500 kB chunk warning only) |

All tests use synthetic data and mocked PayPal and Gemini.

## 5. Browser verification

Setup:
- The client dev server ran on `localhost:5173`.
- An isolated server ran from the session scratchpad: real `createApp` on `127.0.0.1:3001`, a scratch SQLite file, no
  PayPal or Gemini client, outbound requests refused, and the demo accounts with probe-only passwords.
- Nothing from `.env` was read.
- The scratch database was deleted afterwards, and the real `server/data/disputedesk.sqlite` was not opened.
- No AI button, validation example or sandbox tab was used.

| Check | Result |
|-------|--------|
| Landing `scrollWidth` vs `clientWidth` at 1440, 1024, 768, 375, 320 | Equal at every width (was +1–2px) |
| Landing header at 320px | One row: logo and Sign in share the same top |
| Sign-in inputs, 375px emulated touch | 44px and 44px |
| Signed in as Merchant A, DEMO-1002 at 375, 320 and 768 | No sideways overflow; "Based on" lists and "Verified against record" / Conflicting tags render; no touch target under 44px at 375/320 |
| Check my edits on DEMO-1002 (no Gemini call) | "Tracking confirms the parcel reached the buyer." is "Check against your records" with "Claims delivery, but proof of delivery is not available". "We emailed the buyer the tracking number." is "Not in DisputeDesk's records" with the new message-content reason |

## 6. Hygiene

| Item | Result |
|------|--------|
| Secret scan of added lines | No key, token or password pattern |
| `.env` | Not read, not edited |
| PayPal sandbox scripts and `sample-dispute.json` | Unchanged |
| Migrations, dependencies, `.claude/launch.json` | Unchanged |

Changed files: `server/src/assist.ts`, `assist.test.ts`, `claims.test.ts`; `client/src/App.tsx`, `Login.tsx`,
`Landing.tsx`, `index.css`, `styles.css`, `ui.test.ts`; `README.md`, `reports/devpost-description.md`,
`reports/demo-video-script.md`; this report. The Phase 8.1 audit report is still untracked.

## 7. Not tested and limits

- No live Gemini draft and no live PayPal sandbox call (no approval for live calls). The AI path is covered by mocked
  tests.
- Browsers other than Chromium, and screen-reader walkthroughs.
- Claim matching is still heuristic. New wording outside the patterns can still read as "No factual claim found". The
  check stays advisory, and merchant review stays mandatory.
- F-10 (bundle split) is not done.

## 8. Verdict

**READY.** The 8.1 conditions (F-01, F-02, F-05 and the 768/320 signed-in pass) are met, along with the P2 and P3
items except optional F-10. Ready to commit when you approve.
