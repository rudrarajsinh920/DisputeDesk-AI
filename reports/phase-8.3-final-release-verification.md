# DisputeDesk AI: Phase 8.3 Final Release Verification and Demo Sign-off

Date: 2026-11-08
Mode: verification only. No source, configuration or submission document was changed. Nothing was committed, pushed or
deployed. No live PayPal or Gemini call was made. This report is the only file written to the project.

## 1. Git baseline and history

| Item | Result |
|------|--------|
| Branch | `master` |
| HEAD | `8b39f27` "Tighten claim checks and fix readiness audit findings" |
| Working tree | Clean. No tracked changes and no untracked files. |
| Ignored files | `.env`, `server/data/` (real database), `client/dist/`, `.impeccable/` cache, `client/.impeccable/`. All expected. `.env` was not opened. |
| `origin/master` (local ref, not fetched) | `f08ba14`. Local `master` is **8 commits ahead and 0 behind**. Nothing since `f08ba14` has been pushed. |

The commits since `origin/master`, newest first:

| Commit | What it holds |
|--------|---------------|
| `8b39f27` | Phase 8.2 changes (`assist.ts`, `assist.test.ts`, `claims.test.ts`, `App.tsx`, `Login.tsx`, `Landing.tsx`, `index.css`, `styles.css`, `ui.test.ts`, README, Devpost text, video script), the Phase 8.1 audit report and the Phase 8.2 report. |
| `4dc39f4` | Phase 7 reports (7.1–7.5). Also earlier reports (0.2, 6.1–6.5), `disputedesk-audit.pdf`, 22 visual-QA screenshots, `devpost-description.md` and `demo-video-script.md`. These last items are launch material outside Phase 7 itself. |
| `0fbea14` | Phase 7 code: provenance (`provenance.ts`, `shared/types.ts`), claim mapping in `assist.ts`, the merchant provenance UI and its tests. |
| `44dcf68`, `c4d24b8`, `8efebc0`, `a34db75`, `4346fd0` | Earlier hardening and UI work (Phase 6.x). |

Claims checked against Git:

- **"Phase 7 was committed in `0fbea14` and `4dc39f4`" (Phase 8.1): correct.** Code is in `0fbea14` and reports are in `4dc39f4`.
- **"Baseline `4dc39f4` (clean)" (Phase 8.2): correct.** `8b39f27` is its only child.
- **The Phase 8.2 file list matches `git show --stat 8b39f27` exactly.** It has 14 files. No change was found outside the reported phases.

## 2. Phase 8.2 fix verification

A read-only probe ran 29 sentences through `checkMerchantDraft`. It used DEMO-1002, DEMO-2013, DEMO-1003, DEMO-1001 and a
synthetic sandbox record with `customer_communication: true` (`probe-8.3.mts` in the session scratchpad). It made no
network calls and opened no database.

### F-01: delivery claims. PASS

`DELIVERY_CLAIM` now includes reached, got to, made it to, landed with/at, and "in the buyer's / their hands".
`IMPLIED_PROOF` now includes "tracking shows/confirms/indicates … delivered/arrived/receipt/reached". Both are in
`server/src/assist.ts`.

| Sentence | DEMO-1002 / DEMO-2013 (no proof of delivery) | DEMO-1003 (proof of delivery) |
|---|---|---|
| Tracking confirms the parcel reached the buyer. | flagged | supported (`evidence.proof_of_delivery`, tracking) |
| The parcel got to the customer on time. | flagged | supported |
| It made it to the recipient. | flagged | supported |
| The package landed with the buyer. | flagged | supported |
| The item is in the buyer's hands. | flagged | supported |
| Tracking shows it arrived. / Tracking indicates … delivered | flagged | supported |
| We reached out to the buyer. | not a claim (not read as delivery) | not a claim |

On DEMO-1001 every delivery sentence is flagged. Sentences that also rely on tracking add "tracking is not available".

### F-02: message content. PASS

| Sentence | Demo records (communication on record) | DEMO-1001 (no tracking) | Sandbox (communication flag set) |
|---|---|---|---|
| We emailed the buyer the tracking number. | unsupported: messages exist, not what they said | unsupported: tracking not available, plus message content | unsupported: tracking not on record, plus PayPal can't show who wrote |
| We contacted the buyer. | **supported** (`evidence.customer_communication`) | supported | unsupported: PayPal can't show who wrote the messages |
| We told the buyer about the delay. | unsupported (message content) | unsupported | unsupported |
| We wrote to the buyer. | supported | supported | unsupported |
| We messaged the customer with tracking. | unsupported | unsupported | unsupported |

A communication record backs only the fact of contact. Sandbox records never back a merchant-contact claim.

### F-03: agreements and offers. PASS

- **Buyer messages are flagged** ("Describes buyer messages, which are not in DisputeDesk's records") on every record. This covers agreed to keep, refused, requested, promised, declined and asked.
- **"The buyer agreed to pay for the order." is not a claim**, as intended: an order confirmation shows exactly that.
- **Merchant offers are unsupported** ("DisputeDesk holds no record of what was offered or promised"). This covers offered, promised and proposed. None of them is ever shown as supported.

### F-04: attachments. PASS

"Please review the attached invoice.", "The receipt is enclosed.", "See the attached photo." and "See the invoice for
details." are all unsupported on every record: "DisputeDesk holds no documents, so it can't back an attachment." No result
implies DisputeDesk holds or inspects a document.

### F-05: submission copy. PASS, with the findings in section 8

- **Test count.** The Devpost text says 316 tests, which matches this run (225 + 91).
- **Video script length.** The script has **394 spoken words**, matching its own header (about 395 words, about 2:52).
- **Provenance and Check my edits.** README, Devpost and the script all explain both. The README lists the limits.
- **Gaps.** One README demo step points at the wrong place (P2-1), and the Devpost text has no limits statement (P2-3).

### F-06 to F-09: UX fixes. PASS (code, test and browser re-checked)

| Fix | Code | Evidence in this phase |
|-----|------|------------------------|
| F-06 sign-in error alert | `Login.tsx:58` `role={noticeIsError ? "alert" : "status"}`; `App.tsx:123,182` | `ui.test.ts:153` passes |
| F-07 44px touch | `styles.css` `@media (pointer: coarse)` includes `.login-form input` | 320px emulated touch: email 44, password 44, button 44 |
| F-08 overflow | `index.css:750` `.close { position: relative }` | Landing `scrollWidth` = `clientWidth` at 320 and 768, scrolled to the foot |
| F-09 320px header | `Landing.tsx:223,229` (`gap-x-4`, `max-[359px]:sr-only` wordmark) | 320px: logo, Sign in and menu all at top 25px, one row, 44px tall |

### F-10: bundle size. Deferred, as instructed

The bundle is still one 543.15 kB chunk (171.83 kB gzip), with the existing warning. No loading or runtime problem was
seen locally, so no change is recommended for submission.

## 3. Full test results

| Check | Result | Phase 8.2 |
|-------|--------|-----------|
| Server tests (`npm test`) | **225 / 225 pass**, 0 fail, 0 skipped | 225 |
| Client tests (`npm test`) | **91 / 91 pass**, 0 fail, 0 skipped | 91 |
| Server typecheck (`tsc`) | Pass | Pass |
| Client typecheck (`tsc`) | Pass | Pass |
| Production build (`vite build`) | Pass, with the existing over-500 kB chunk warning only | Same |

The counts match Phase 8.2 exactly, and no documentation change is needed.

## 4. Journey results

**Setup:**
- The app ran from `createApp` on `127.0.0.1:3001` with a scratch SQLite file in the session scratchpad and no PayPal or Gemini client.
- Every outbound request other than to 127.0.0.1 was refused.
- The demo accounts used probe-only passwords. Nothing was read from `.env`.
- The client was the Vite dev server on `localhost:5173`.

**Cleanup and evidence:**
- The real database's SHA-256 matched before and after the run for `.sqlite`, `-shm` and `-wal`.
- The scratch database was deleted, both servers were stopped, and the viewport was reset.

### Merchant (Merchant A, then Merchant C). PASS

| Step | Result |
|------|--------|
| Sign in, list | 200. The list holds DEMO-1001 and DEMO-1002 only. |
| DEMO-1001 missing evidence | Tracking and proof of delivery are Missing and marked Key, so readiness is "0 of 2". |
| Provenance | Each finding has "Based on" with its field, supplier, record and verification state. |
| Generated draft | Starts "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL." and "DEMO DATA — NOT A REAL PAYPAL DISPUTE." It has 5 markers, matching the README. |
| Draft sources | The "Sources for the generated draft" control is present. |
| DEMO-1002 conflict | Provenance verifications: order confirmation, tracking and communication are verified; **proof of delivery is conflicting**. The contradiction lists `order.shipping_status = DELIVERED` and `evidence.proof_of_delivery = false`. The draft carries `[CONFLICT: …]` and 4 markers. |
| Check my edits (UI) | The paragraph "Tracking confirms the parcel reached the buyer." shows **Check against your records** with "Claims delivery, but proof of delivery is not available." The paragraph "We emailed the buyer the tracking number." shows **Not in DisputeDesk's records** with the message-content reason. |
| Check my edits (API, 5 paragraphs) | flagged, unsupported, supported, flagged, unsupported, as expected |
| Another account's dispute (DEMO-2013) | 404 |
| Insights (Merchant C) | 14 disputes and 6 suggestions. The first is "Proof of delivery is missing or unverified in 6 of 7 item-not-received disputes", matching the README and script. The response contains no percentage. |

### Buyer (Buyer B). PASS

| Step | Result |
|------|--------|
| List | DEMO-1002 and DEMO-1003. Each record has only `source, dispute_id, reason, status, amount, create_time, guidance`. |
| Same dispute (DEMO-1002) | The plain-language view is labelled "From the record", "General guidance" and "Not on record". |
| Privacy | Page text has no order ID, tracking number, "Proof of delivery", "Based on", "Verified against record", "Conflicting", `evidence.` field, draft or Check my edits. The API response has no provenance, refs, claims or evidence. |
| Explain (AI off) | 200, `origin: "rules"`, the labelled standard explanation, with no merchant data in it. |
| Merchant routes | `/api/analysis`, `/api/analysis/check` and `/api/intelligence` return 403. Explaining DEMO-1001, which is not the buyer's dispute, returns 404. |

### Admin. PASS

| Step | Result |
|------|--------|
| Accounts | 200. No password hash in the response. |
| Audit log | 200, 13 entries on the scratch database. No password, hash, token or key-like text. |
| Analysis (read) | 200 |
| AI draft, Check my edits, Insights summary, buyer explain | **403** for each |
| Signed out | `/api/auth/me` returns 401 |

## 5. Security and privacy results

| Requirement | Evidence | Result |
|-------------|----------|--------|
| Merchant and buyer separation | Journeys in section 4; tests `app.test.ts:929`, `:1238`, `:1660` | PASS |
| Cross-account access gives 404 | DEMO-2013 as Merchant A and DEMO-1001 as Buyer B both return 404; tests `app.test.ts:950`, `:1675`, `:1301` | PASS |
| Admin read-only, no AI and no edit check | 403s in section 4; test `app.test.ts:1713` | PASS |
| Provenance never reaches buyers | API and page text checks; test `app.test.ts:1660` | PASS |
| Gemini receives no refs or identifiers | The `buildAiRequest` output for DEMO-1001 and DEMO-1002 has no `source:id:field` ref and no dispute ID. Its only facts are reason, amount, item, shipping status, tracking number and the four evidence flags. Tests `app.test.ts:1687`, `assist.test.ts:35`. | PASS |
| No secrets in responses or reports | Audit and accounts responses are clean. The commit scan for Phase 8.2 was clean. This report contains no secret. The README holds the synthetic demo passwords by design, and they are not repeated here. | PASS |
| PayPal read-only | The only PayPal POST is `/v1/oauth2/token` (`paypal.ts:45`). No `provide-evidence`, `accept-claim`, offer or escalate call exists. Tests `app.test.ts:403`, `:571`. | PASS |
| No automatic submissions | No route sends a draft anywhere. Every draft and the UI footnote say so. | PASS |
| Demo data labelled | Yellow banner, "DEMO DISPUTE" tag, demo line in the draft, Insights note "synthetic demo disputes" | PASS |
| Routes need a session | Every route except login and logout uses `requireRole` (`app.ts:303–500`), and a test enforces the role table | PASS |

Note: one call to `POST /api/analysis/ai/example` was made on the isolated server. It runs a fixed answer, written in
advance, through the checks. It makes no Gemini call and was refused nothing (200).

## 6. Demo rehearsal: the proposed three-minute sequence

Every step can be shown with synthetic data and no live Gemini or PayPal call, if the cautions below are followed.

| Time | Step | Feasible offline? | Caution |
|------|------|-------------------|---------|
| 0:00–0:20 | Landing and positioning | Yes | A 15-second intro reel plays on each fresh load before the hero. Press "Skip intro", or start recording after it ends (P3-4). The hero reads "Every dispute, checked against the record." with the pill "The evidence intelligence layer for payment disputes". |
| 0:20–0:55 | DEMO-1001 gaps and generated draft | Yes | Use the rule draft. **Do not press Generate AI draft**: it calls Gemini when the server has a key. |
| 0:55–1:35 | DEMO-1002 conflict | Yes | Point at **Proof of delivery → Based on → Conflicting**, not shipping status (P2-1). 40 seconds is generous; 30 is enough. |
| 1:35–2:05 | Check my edits | Yes, local and no AI | Typing on camera is slow. Paste three prepared paragraphs: "Tracking confirms the parcel reached the buyer." (flagged), "We emailed the buyer the tracking number." (unsupported) and "We contacted the buyer." (supported). |
| 2:05–2:30 | Buyer and privacy | Yes | Signing out and in takes about 8 seconds. Buyer B sees DEMO-1002, the same dispute. **Do not press "Explain in plain language"** on a server with a Gemini key (P3-5). |
| 2:30–2:50 | Insights | Yes | Needs **Merchant C**, a third sign-in. Merchant A has only 2 disputes, below the 3-dispute pattern threshold. Do not press "Summarize these insights" (Gemini). |
| 2:50–3:00 | Close | Yes | — |

**Risks:**
- **Unreliable actions:** any AI button on a server with a key, and the PayPal sandbox tab. None of them is needed for this sequence.
- **Confusing transitions:** three account switches. Prepare separate signed-in browser profiles, or cut between recordings.
- **Screens that need a lot of explanation:** the DEMO-1002 evidence list is long. Scroll straight to Proof of delivery.
- **Claims a judge could challenge:**
  - "Verified against record" could be read as verification with the carrier. The page caption explains it. Say "the records back it" aloud.
  - The tagline "not allowed to invent evidence" is absolute (P2-3).

**This sequence differs from the committed video script** (`reports/demo-video-script.md`). The script has a live
Gemini beat (0:50–1:25) and a live PayPal sandbox beat (1:42–2:05) (P2-2).

## 7. Submission copy review

1. **Can a judge understand the problem in 20 seconds? Yes.** The Devpost "Inspiration" and the script's hook both state it in two sentences: AI invents tracking numbers in disputes.
2. **Is the differentiation clear? Yes.** "Rules decide, AI only words, the merchant reviews", with provenance and claim checks.
3. **Does the demo show the differentiator? Yes**, as long as the DEMO-1002 conflict and Check my edits beat is kept. It is the clearest proof.
4. **Are the architecture and AI responsibilities clear? Yes.** README "Rules decide / AI only words" and the Devpost "How we built it" cover them.
5. **Are limitations stated honestly?**
   - **README: yes**, it has a Limits section.
   - **Devpost: partly.** It says the check is advisory and that DisputeDesk does not open documents. It never says that the AI checks are pattern-based and can miss new wording.
6. **Are there unsupported performance or impact claims? None found.** There are no accuracy, speed or win-rate numbers. The "6 of 7" figure matches the data.
7. **Is the copy consistent with the implementation?**
   - **Mostly yes.** Test counts, marker counts, Insights numbers and claim results all match.
   - **One exception:** README step 6 points to the wrong field (P2-1).

Recommended wording. The files are not edited.

- **README step 6:**
  - Current: "Open 'Based on' under shipping status: it is tagged Conflicting."
  - Replace with: "Open 'Based on' under Proof of delivery: it is tagged Conflicting."
- **Devpost tagline:**
  - Current: "AI that helps answer PayPal disputes and is not allowed to invent evidence."
  - Replace with: "AI that helps answer PayPal disputes, with every line checked against the records."
- **Devpost "Challenges", add:** "The checks are rules and patterns, so they catch the kinds of invented detail we listed, not every possible wording. That is why a person reviews every draft."
- **Video script, if recording without live services:** replace the 0:50–1:25 Gemini beat with the validation example (it needs no Gemini call). Drop the sandbox beat, or show a still and say "read-only, live from PayPal's sandbox".

## 8. Findings

No P0 findings.

### P1-1: Phase 7 and 8 work is not on GitHub. Blocks submission until pushed.
- **Where:** repository, `master` versus `origin/master`.
- **Evidence:** `git rev-list --left-right --count origin/master...HEAD` gives `0 8`. The local `origin/master` is `f08ba14`.
- **Reproduce:** run `git status -sb`, or `git log origin/master..HEAD`.
- **Impact:** the Devpost "Code" link points to `github.com/rudrarajsinh920/DisputeDesk-AI`. Judges would see code without provenance, Check my edits and the Phase 6.x hardening. The Devpost text, test count and README would not match the repository.
- **Action:** the user pushes `master` before submitting. Confirm first with `git fetch`, because the local ref may be stale. This report does not push.
- **Blocking:** yes, for submission. Not for the local demo.

### P2-1: README demo step 6 names the wrong field for the Conflicting tag
- **Where:** `README.md`, Demo step 6.
- **Evidence:** the UI shows Conflicting under **Proof of delivery → Based on** (`evidence.proof_of_delivery = false … Conflicting`). Shipping status has no "Based on" block, and Shipping tracking reads "Verified against record".
- **Reproduce:** sign in as Merchant A, open DEMO-1002, open Evidence.
- **Impact:** a presenter following the README looks in the wrong place on camera.
- **Action:** the one-line wording change in section 7.
- **Blocking:** no.

### P2-2: The committed video script needs live Gemini and PayPal calls
- **Where:** `reports/demo-video-script.md` beats 0:50–1:25 and 1:42–2:05; README demo steps 4 and 7.
- **Evidence:** "click Generate AI draft" and "switch the source to PayPal sandbox".
- **Impact:** recording needs network, a valid key and sandbox data. A rate limit or timeout mid-take costs the take. This conflicts with the no-live-call sequence proposed in this phase.
- **Action:** choose one. Record the committed script with approved live calls, keeping the README fallbacks. Or adopt the section 6 sequence and change the script.
- **Blocking:** no.

### P2-3: The Devpost text has no limitations statement, and its tagline is absolute
- **Where:** `reports/devpost-description.md`, the tagline (line 9) and "Inspiration" (line 18): "cannot add facts that are not on record".
- **Evidence:** the README Limits section says the checks are patterns that can miss wording. The Devpost text never says so.
- **Impact:** a judge who types unusual wording that slips through can call the claim false.
- **Action:** the wording in section 7.
- **Blocking:** no.

### P3-1: The reason for a shipping claim on a contested status is misleading
- **Where:** `server/src/assist.ts`, `problems()` (line 285) with `shippedOnRecord` (line 310).
- **Evidence:** on DEMO-1002 (status "Delivered", contested), "We shipped the order." is flagged with "Claims the order was shipped, which the records do not show." The records do show Delivered; the issue is that the status is in conflict.
- **Reproduce:** Check my edits on DEMO-1002 with "We shipped the order."
- **Impact:** the result itself is defensible, but the wording reads as a false negative. Only judges who type this would see it.
- **Action:** later, word the reason "…, but the shipping status is in conflict" when it is contested.
- **Blocking:** no.

### P3-2: An unsupported paragraph still lists records
- **Where:** `mapClaims`, `assist.ts`, around line 366.
- **Evidence:** "We emailed the buyer the tracking number." is unsupported, yet the UI shows "Records: evidence.shipping_tracking, order.tracking_number".
- **Impact:** this is a mixed signal. The tracking part is backed and the message content is not.
- **Action:** later, label the records as "Partly backed by" in that case.
- **Blocking:** no.

### P3-3: "Reached out" is not read as a contact claim
- **Where:** `CONTACT_CLAIM`, `assist.ts`.
- **Evidence:** "We reached out to the buyer." gives `not_a_claim` on every record.
- **Impact:** low. It reads as "No factual claim found" rather than being wrongly backed. On sandbox records it should be unsupported.
- **Action:** optional pattern addition later.
- **Blocking:** no.

### P3-4: The landing intro reel plays on every fresh load
- **Where:** `client/src/Landing.tsx`, the intro reel.
- **Evidence:** after a reload, a black screen with a line animation and a "Skip intro" button appeared before the hero.
- **Impact:** 15 seconds of the 3:00 limit if not skipped.
- **Action:** skip it, or start recording after it ends.
- **Blocking:** no.

### P3-5: Buyer explain and Insights summary call Gemini when a key is set
- **Where:** `/api/buyer/explain`, `/api/intelligence/explain`.
- **Impact:** one click makes a live call during a demo meant to be offline.
- **Action:** avoid those buttons, or run the demo server without a key.
- **Blocking:** no.

### P3-6: F-10 bundle size, deferred
- **Where:** `client/` build output, one 543 kB chunk.
- **Evidence:** the existing build warning. No loading problem was seen locally.
- **Action:** none for submission.
- **Blocking:** no.

## 9. Not tested

- **Live services:** a live Gemini draft, buyer explanation or Insights summary, and the live PayPal sandbox list or detail. No approval was given for live calls. These paths are covered by mocked tests.
- **Other browsers:** anything other than Chromium in the app's browser pane, and real touch devices (touch was emulated).
- **Accessibility:** a screen-reader walkthrough.
- **Admin pages in the UI:** checked at the API only.
- **Signed-in widths:** the signed-in UI at 320 and 768 was not re-run in this phase. Phase 8.2 covered it, and no client code has changed since `8b39f27`. The landing and sign-in pages were re-checked at 320 and 768.
- **The real demo database and the real server:** not used, by design.
- **GitHub:** the remote's current state was not fetched.

## 10. Final verdict

**READY WITH CONDITIONS.**

- **Product readiness:**
  - Every Phase 8.2 fix is in the code, tested and behaves as reported.
  - The full suite passes: 225 + 91 tests, both typechecks and the build.
  - The merchant, buyer and admin journeys and the privacy rules hold on an isolated server.
  - There are no P0 findings and no code defects that block release.
- **Condition for submission:** push `master` (P1-1), so the linked repository matches the submission.
- **Strongly recommended before recording:**
  - Fix README step 6 (P2-1).
  - Pick which demo script to record (P2-2).
  - Soften the Devpost tagline and add one limits sentence (P2-3).

Stopping here for approval. No further changes were made.
