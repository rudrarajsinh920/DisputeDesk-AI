# DisputeDesk AI — Phase 8.1: Product Readiness Audit

Date: 2026-11-08
Mode: read-only audit. No source, configuration, database or credential was changed; nothing was committed or pushed.
This report is the only file added to the project. `npm run build` regenerated the gitignored `client/dist/`.

## 1. Executive verdict

**READY WITH CONDITIONS.**

The product is complete and its safety model holds up:
- Every suite, typecheck and the build pass.
- The 7.5 live probe of roles, privacy and guards still describes HEAD.
- Missing evidence is never treated as proof, contested values never back a claim, and refund claims are never backed.
- Gemini never sees refs or IDs.

Two claim-mapping defects contradict the product's own stated boundaries:

- **F-01 (P1):** "Tracking confirms the parcel reached the buyer." is reported as *Backed by DisputeDesk's records* in
  Check my edits. The AI checks keep the same paragraph. This happens on DEMO-1002, the headline conflict demo, which
  has no proof of delivery. Tracking alone is treated as delivery.
- **F-02 (P1):** "We emailed the buyer the tracking number." is reported as *Backed* by the communication flag. On
  DEMO-1001 this happens even though tracking is marked not available. A communication flag is treated as proof of
  what a message said.

Both are pattern-level fixes. The submission copy (README, Devpost text, video script) also doesn't mention any Phase 7
feature (F-05). Fix F-01, F-02 and F-05 and do the signed-in visual pass at 768/320 (§13), and the verdict becomes READY.

## 2. Git baseline and preserved changes

| Item | Value |
|------|-------|
| Branch / HEAD | `master` / `4dc39f4` |
| Status | Clean working tree; 7 commits ahead of `origin/master`, nothing pushed |
| Ignored (untouched) | `.env`, `server/data/`, `client/dist/`, `.impeccable/` caches |
| Phase 7 changes | **Already committed**, not pending as the brief assumed: `0fbea14` (provenance, claims, UI, tests; 11 files), `4dc39f4` (all `reports/`, 56 files) |
| Earlier user changes | `client/src/Landing.tsx` (intro once per load) and the Cookie overflow fix in `client/src/styles.css` are inside `0fbea14`; `reports/` is inside `4dc39f4` |

**Reports compared with the tree:**
- The 7.3, 7.4 and 7.5 reports say "not committed". That was true when they were written and is now out of date.
- Everything else they claim matches the tree: test counts (222 server, 91 client), the provenance API shape, the UI
  labels, the absence of migrations and new dependencies, and the probe results.
- None of them claims anything this audit contradicts, except that 7.3 §4 is incomplete. It says delivery claims need
  proof of delivery, but F-01 shows wording that slips past the delivery pattern.

## 3. Product functionality audit

Checked with the test suites, static reading and the 7.5 live probe (same server code as HEAD).

| Journey | State | Notes |
|---------|-------|-------|
| Sign-in, sessions, roles | Works | DB sessions storing token hashes; 30 min idle, 8 h absolute; lockout per account, email and address |
| Merchant list and detail | Works | Readiness gives counts, never a score; demo banner on every demo record |
| Evidence analysis | Works | Available / Missing / Unverified from the rules; contradictions listed |
| Verification and conflict states | Works | "Verified against record" and "Conflicting" tags; DEMO-1002 shows Conflicting on proof of delivery |
| Source provenance | Works | Field, value, source type, record ID, "No time on record", sandbox derivation line |
| Generated draft | Works | Header "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL."; gap markers; Sources list |
| AI-assisted draft | Works, **F-01** | Facts allowlisted, paragraphs checked; rule gaps always carried over; one delivery wording slips through |
| Check my edits | Works, **F-01–F-04** | Advisory, not stored, not audited |
| Insights | Works | Counts and dispute IDs only; percentages only for 10 or more |
| Buyer experience | Works | Buyer projection limited to `source, dispute_id, reason, status, amount, create_time, guidance` |
| Admin | Works, read-only | 403 on `/ai`, `/check`, `/intelligence/explain` |
| Server down | Works | The sign-in page says "The DisputeDesk server is not responding. Start it with npm --prefix server start" (seen live) |

## 4. Evidence correctness audit

I ran 22 edge-case sentences through `checkMerchantDraft` on DEMO-2013, DEMO-1002, DEMO-1003 and DEMO-1001, using a
read-only scratch script outside the project.

| Requirement | Result |
|-------------|--------|
| Missing evidence is not proof it did not happen | **Pass**. "Not delivered" and "not shipped" wording is flagged (`NOT_DELIVERED`, `NOT_SHIPPED`); drafts say "does not show it was not delivered" |
| Unverified is never shown as verified | **Pass**. A finding is verified only when its record is available and uncontested (`provenance.ts`) |
| Conflicts are distinct | **Pass**. Separate state and tag; DEMO-1002 "The order shipped." is flagged because its status is contested |
| Contested values never support a claim | **Pass**. Checked across all 16 demos (7.3) and again here |
| Every supported claim has refs | **Pass**. All `supported` results carried refs |
| Tracking alone does not establish delivery | **FAIL (F-01)**. "Tracking confirms the parcel reached the buyer." is supported by tracking refs on DEMO-2013 and DEMO-1002 |
| Communication flags don't establish message contents | **FAIL (F-02)**. "We emailed the buyer the tracking number." is supported by `evidence.customer_communication`, including on DEMO-1001 where tracking is marked not available |
| Refund claims are never supported | **Pass**. "We issued a full refund." and "A refund was issued." are unsupported: "DisputeDesk holds no refund records" |
| Generated sources are kept apart from edited text | **Pass**. Sources list says edits are covered by Check my edits; DisputeDesk's own lines are skipped in the check |
| No document inspection is implied | **Pass** in the UI copy (7.5 §5). Check my edits doesn't recognise "attached invoice" (F-04) |

**False positives** (flagged when they shouldn't be): none found. Dates, carriers, handoff stories and buyer-message
claims are flagged on purpose, because no record holds them.

**False negatives** (missed or wrongly backed):

| Sentence | Result | Expected |
|----------|--------|----------|
| "Tracking confirms the parcel reached the buyer." | supported (tracking) | flagged: delivery needs proof of delivery (F-01) |
| "We emailed the buyer the tracking number." | supported (communication) | unsupported: the flag shows a message exists, not its content (F-02) |
| "The buyer agreed to keep the item." | not a claim | flagged: describes buyer message content (F-03) |
| "We offered the buyer a refund." | not a claim | unsupported: no refund or message record (F-03) |
| "Please review the attached invoice." | not a claim | unsupported: DisputeDesk holds no documents (F-04) |

## 5. AI reliability audit

| Area | Finding |
|------|---------|
| Request | `buildAiRequest` sends only R-numbered allowlisted facts. Record text that reads like instructions is withheld. Route test: no ref, dispute ID or order ID in the Gemini body |
| Citations | `cites` are R ids, mapped to refs after the answer (`assistWithRefs`) |
| Shape | A malformed answer is rejected whole (`readShape`, `ai_bad_response`) |
| Unsupported text | A failing paragraph is removed and replaced by an `[UNSUPPORTED: …]` marker, and the removed text is listed in flags. The rules' gaps are always appended. **Gap: F-01**. Tested offline with the fixed validation answer: "Tracking confirms the parcel reached the buyer." is **kept** as an AI line for DEMO-1002 and DEMO-2013. The gap lines appended below it (DEMO-2013: "do not state that the order was delivered") then contradict it |
| AI off | `/ai` answers 503 `ai_not_configured`; the rule-based draft still works; buyers get the standard explanation |
| Limits | `AI_MAX_CALLS` per account per 15 min (429 with `Retry-After`); one request per dispute at a time (409) |
| Errors | Timeout, rate limit, auth, 404 model, 5xx and bad response each map to a code and message; the key is never echoed |
| Human control | Drafts are never sent anywhere; the header and footer require merchant review; no PayPal write route exists |
| Live calls in this audit | **None.** No Gemini or PayPal request was made |

## 6. Security and privacy audit

No new findings. The server code is unchanged since the 7.5 probe (HEAD only added reports), so those results still hold.

| Control | Evidence |
|---------|----------|
| Authentication | scrypt hashes; constant-time-like dummy hash for unknown emails; `__Host-` cookie, `HttpOnly; Secure; SameSite=Strict` |
| Authorization | `requireRole` on every route; the role-table test fails on an unlisted route; 7.5 probe matched all 15 routes × 4 roles |
| Cross-account | 404 body identical to a missing ID; attempts audited as `dispute_access_denied` |
| Buyer projection | Allowlisted fields only; no provenance, refs or merchant data (probe and UI test) |
| Merchant-only provenance | Not in buyer, insights or list responses (route tests) |
| Admin | Read-only; 403 on writing AI, check and summary routes |
| CSRF / Origin / Host | Foreign Origin, `null` Origin, `Sec-Fetch-Site: cross-site` and `same-site` all get 403; foreign Host 403 |
| Headers | API: `default-src 'none'`, nosniff, frame protection, CORP; page: strict CSP on the build |
| Rate limits | Sign-in and AI limiters with bounded memory |
| Audit log | Append-only triggers; no text, password or token stored |
| Secrets | `.env` ignored and untracked; tokens never returned; secret scan of the committed diff and reports was clean (Phase 7 commit) |

Not inspected: `.env` contents, as instructed.

## 7. UX and responsive audit

| Surface | 1440 | 1024 | 768 | 375 | 320 |
|---------|------|------|-----|-----|-----|
| Landing (signed out, live, this audit) | Tested | Tested | Tested | Tested | Tested |
| Sign-in with server down (live, this audit) | Tested | — | Tested | — | Tested |
| Merchant workspace with provenance | 7.4 (pass) | 7.4 (pass) | **NOT TESTED** | 7.4 (pass) | **NOT TESTED** |
| Buyer, admin, insights | Earlier phases (`reports/visual-qa/`) | Earlier | Earlier | Earlier | Earlier |

Signed-in screens could not be re-tested here: that needs an isolated API server, which would mean a temporary
`.claude/launch.json` entry or a shell-started server, both outside this audit's rules.

Live observations:
- **Landing:**
  - No element overflows `body` at any width.
  - The document is 1–2px wider than the viewport at every width (F-08).
  - At 320px the header wraps "Sign in" onto a second row (F-09).
  - The demo labels are visible ("Synthetic demo data", "Read-only with PayPal", "A person reviews every draft").
  - The intro plays once per load and is skipped for reduced motion.
- **Sign-in:** the inputs have labels, but are 40px tall on a touch screen (F-07). The server-down message is not
  announced to screen readers (F-06).

## 8. Demo readiness

Judges can follow the story quickly: the landing headline "Every dispute, checked against the record.", banners on
every demo record, and the README's account table.

**Clearest end-to-end sequence (about 3 minutes, no live external calls):**
1. Landing page, then "Sign in to the demo".
2. **Demo Merchant A**, DEMO-1001. Show:
   - Tracking and proof of delivery are Missing, with "missing is not proof it didn't happen".
   - The generated draft with its gap markers.
   - "Sources for the generated draft".
3. DEMO-1002. Show:
   - The **Conflicting** tag on proof of delivery: the status says DELIVERED but proof of delivery is missing.
   - The source lines.
   - Check my edits with "We shipped the order." (flagged), "We refunded the payment." (Not in DisputeDesk's records)
     and "The buyer placed the order." (Backed).
4. "Show what the checks catch" (validation example; never calls Gemini) shows invented facts being removed.
5. **Demo Buyer B**, DEMO-1002: the same facts in plain language, with no merchant data.
6. **Demo Merchant C**, Insights: counts with the dispute IDs behind each.
7. Optionally **Admin**: read-only audit log.

Until F-01 and F-02 are fixed, don't type delivery or "emailed … tracking" sentences live in Check my edits.

**Blockers to the story:** F-05. The written submission doesn't mention the provenance features that set this release
apart.

## 9. Performance and reliability

| Area | Finding |
|------|---------|
| Startup | A database that won't open prints one line and exits; migrations are forward-only; demo files are mirrored on start; old sessions are pruned |
| API errors | One error handler maps JSON, size, AI and PayPal errors; anything unexpected gets a generic 500 with no stack |
| Database | `node:sqlite` file under `server/data/`; the audit log grows without limit (by design; the size is printed on start) |
| Build | Passes; one JS chunk of 543 kB (172 kB gzip) triggers Vite's warning (F-10) |
| Production assumptions | Server binds `127.0.0.1` only and does not serve `client/dist`; the README documents `npm run preview`. There is no hosted deployment, so judges need the video or a local setup. A local build passing is not production readiness |
| Browser support | Session cookie is `Secure` over `http://localhost`; verified in Chromium (7.4); other browsers untested |

## 10. Positioning and differentiation

The story is clear and defensible, and every point below is visible in the product:

- **Evidence provenance:** each status traces to a record field, a source type, and a stated lack of time.
- **Contradiction detection:** contested values are shown as Conflicting and never back a claim.
- **Transparent unsupported claims:** AI paragraphs are removed with the reason shown, and merchant edits are labelled
  paragraph by paragraph.
- **Merchant control:** nothing is submitted, and every draft needs review.
- **Buyer privacy:** an allowlisted projection, and the same facts on both sides.
- **Prevention intelligence:** rule-based counts with dispute IDs, no predictions.

No comparison with PayPal's own tools, Chargeflow or Justt was checked. Make none in the submission. There are no
customer, market or performance metrics, so claim none. The Devpost text's "259 automated tests" is out of date; it is
now 313 (222 + 91).

## 11. Test, typecheck and build results (run in this audit)

| Check | Result |
|-------|--------|
| Server tests | **222/222 pass**, 0 fail |
| Client tests | **91/91 pass**, 0 fail |
| Server typecheck | Pass |
| Client typecheck | Pass |
| Production build | Pass; chunk-size warning only (`index-*.js` 542.97 kB, gzip 171.78 kB; CSS 96.08 kB) |

## 12. Findings

### Confirmed defects

**F-01 — P1 — Tracking wording is accepted as proof of delivery** (`server/src/assist.ts`: `DELIVERY_CLAIM`,
`RECEIPT_CLAIM`, `TRACKING_CLAIM`, `mapClaims`, `problems`)
- **Reproduction:**
  1. Sign in as Merchant A and open DEMO-1002.
  2. In Check my edits, enter "Tracking confirms the parcel reached the buyer."
  3. The result is **Backed by DisputeDesk's records** (`evidence.shipping_tracking`, `order.tracking_number`).
  4. The same happens on DEMO-2013.
  5. The AI path keeps the same paragraph as an `ai` line (offline `composeAiAssist` run).
- **Evidence:**
  - "reached", "got to", "made it to" and similar aren't in `DELIVERY_CLAIM`.
  - `TRACKING_CLAIM` ("tracking confirms") is mapped only to the tracking finding.
  - Both records have proof of delivery missing, and DEMO-1002's delivery is contradicted.
- **Impact:** directly contradicts "tracking alone does not establish delivery", on the headline demo record. A judge
  testing that sentence sees DisputeDesk back a delivery claim it has no record for.
- **Fix:**
  - Treat "tracking shows / confirms … + delivery or arrival wording" as a delivery claim.
  - Add reached, got to, made it to, landed and "in the buyer's hands" to the delivery patterns.
  - Add claims and AI tests for DEMO-1002 and DEMO-2013.
- **Blocks submission:** yes, as a condition (small fix).

**F-02 — P1 — The communication flag backs message content** (`assist.ts`: `CONTACT_CLAIM`, `TRACKING_STATEMENT`,
`mapClaims`)
- **Reproduction:** DEMO-1001 (tracking marked not available), Check my edits: "We emailed the buyer the tracking
  number." The result is **Backed** by `evidence.customer_communication`.
- **Evidence:**
  - `CONTACT_CLAIM` matches "emailed the buyer" and backs it with the communication finding.
  - `TRACKING_STATEMENT` doesn't match "emailed … the tracking number", so the tracking content goes unchecked.
- **Impact:** a message's claimed content gets "Backed" status. It also implies a tracking number DisputeDesk marks as
  not available.
- **Fix:**
  - Back a contact claim only for the fact of contact.
  - When the sentence names content (tracking, refund, replacement, "that …", "about …"), check that content's own
    record or mark it unsupported: "a communication record shows messages exist, not what they said".
  - Widen `TRACKING_STATEMENT` to sent/emailed/messaged … tracking.
- **Blocks submission:** yes, as a condition (small fix).

**F-03 — P2 — Agreements and offers read as "No factual claim found"** (`assist.ts`, claim patterns)
- **Reproduction:** "The buyer agreed to keep the item." and "We offered the buyer a refund." both return
  `not_a_claim`.
- **Impact:** the label is wrong; these are claims about messages or refunds that DisputeDesk has no record of. The
  check is advisory, so the harm is limited.
- **Fix:**
  - Add agreed, accepted, promised and offered patterns that map to buyer-message (flagged) and refund (unsupported).
  - Or rename the label to "No claim DisputeDesk recognises".
- **Blocks submission:** no.

**F-04 — P2 — "Attached" documents aren't caught** (`assist.ts`)
- **Reproduction:** "Please review the attached invoice." returns `not_a_claim`.
- **Impact:** the text implies a document DisputeDesk doesn't hold or inspect.
- **Fix:** an attachment pattern ("attached", "enclosed", "see the invoice/receipt/photo") that maps to unsupported:
  "DisputeDesk holds no documents".
- **Blocks submission:** no.

**F-05 — P2 — The submission copy predates Phase 7** (`README.md`, `reports/devpost-description.md`,
`reports/demo-video-script.md`)
- **Evidence:**
  - None of the three files mentions "Verified against record", provenance, the Sources list or Check my edits.
  - The Devpost text says 259 tests.
- **Impact:** judges reading the submission miss the main differentiator (evidence provenance and claim mapping), and
  the test count is wrong.
- **Fix:**
  - Add a provenance and claim-checking section to all three, with the product boundaries from the brief.
  - Correct the test count.
  - Add the DEMO-1002 conflict and Check my edits beat to the video script.
- **Blocks submission:** yes, as a condition (docs only).

**F-06 — P3 — The sign-in error isn't announced** (`client/src/App.tsx` sign-in form)
- **Reproduction:** start the client with no server; the page has no `role="alert"` or `aria-live` region.
- **Impact:** screen-reader users aren't told the server is down.
- **Fix:** put the message in a `role="alert"` element.
- **Blocks submission:** no.

**F-07 — P3 — Sign-in inputs are 40px on touch screens** (`styles.css`)
- **Reproduction:** 320px emulated touch; the email and password inputs measure 40px tall.
- **Fix:** add the inputs to the `(pointer: coarse)` 44px rule.
- **Blocks submission:** no.

**F-08 — P3 — The landing page scrolls 1–2px sideways** (`Landing.tsx` / `styles.css`)
- **Evidence:**
  - `documentElement.scrollWidth` exceeds `clientWidth` by 1px at 1440, 1024 and 768, and by 2px at 375 and 320.
  - `body` fits at every width.
  - The cause wasn't isolated; the ticker and table are clipped by their parents.
- **Fix:** find the overflowing element (likely a full-bleed element using `100vw`) and clip or resize it.
- **Blocks submission:** no.

**F-09 — P3 — The header wraps at 320px** (`Landing.tsx` header)
- "Sign in" drops to a second row under the logo.
- **Fix:** shrink the gap or hide the wordmark below 340px.
- **Blocks submission:** no.

**F-10 — P3 — One 543 kB bundle** (`client/vite.config.ts`)
- The landing page's GSAP, Radix and icons load for every screen.
- **Fix:** lazy-load `Landing`.
- **Blocks submission:** no.

### Recommendations (not defects)

- R-1: Record the demo video locally rather than hosting it; the server is localhost-only by design.
- R-2: Add a one-line "how to read the states" legend near the evidence list (Available / Missing / Unverified, plus
  Verified against record and Conflicting).
- R-3: Keep the validation example in the demo. It shows the AI checks working without a Gemini call.

## 13. Untested areas and limitations

- **NOT TESTED:**
  - Signed-in merchant screens with provenance at **768px and 320px**.
  - The buyer, admin and insights screens after Phase 7 (unchanged code, earlier screenshots only).
- **NOT TESTED live:**
  - A real Gemini draft and the real PayPal sandbox list (no approval for live calls).
  - The AI path was checked offline with the fixed validation answer; sandbox with mocked tests.
- **NOT TESTED:**
  - Browsers other than Chromium (the `Secure` cookie on localhost).
  - Screen-reader walkthroughs.
  - Keyboard-only navigation of the signed-in workspace in this phase (covered by earlier phases' tests and sign-off).
- Claim mapping is heuristic. The 22-sentence probe is a sample, not a proof of coverage.
- `.env` contents were not inspected.

## 14. Recommended Phase 8.2 work

1. Fix F-01 and F-02 in `assist.ts`, with claims and AI tests on DEMO-1002, DEMO-2013 and DEMO-1001. Re-run the 7.3
   baseline comparison and list any new flags.
2. Fix F-03 and F-04 (same file, same tests).
3. Update the README, Devpost text and video script (F-05).
4. Fix F-06 and F-07, and investigate F-08 and F-09.
5. Do a signed-in browser pass at 768 and 320 on an isolated database (needs your OK for a temporary `.claude/launch.json`
   entry).
6. Optional: F-10.

## 15. Final verdict

**READY WITH CONDITIONS.** Fix F-01 and F-02, update the submission copy (F-05), and complete the 768/320 signed-in
visual pass, and DisputeDesk AI is ready for the hackathon demonstration and submission. No P0 was found.
