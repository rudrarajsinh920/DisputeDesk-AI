# DisputeDesk AI: demo video script (about 2:55)

Rules for the recording: under 3 minutes, no music, no third-party logos or trademarks on screen besides the app
itself. Record the browser window only (no bookmarks bar, no other tabs). Never show `.env` or a terminal with keys.

Before you record:
- Both servers running; the server log says `AI drafting: on (...)`.
- Sandbox has dispute PP-R-JFO-10196577 (ceramic mug). Do not open PP-R-MQW-10196592 on camera.
- Sign out first, so the video starts on the landing page.
- Browser zoom 110–125% so text is readable on a phone.

Spoken words are about 395, which is about 2:52 at a calm pace.

---

## 0:00–0:15 Hook (landing page)

**Screen:** landing page, scroll slowly once.

**Say:** "When a buyer opens a PayPal dispute, the merchant has days to answer with the right evidence. Most AI tools
would happily write a confident reply, and invent a tracking number to do it. DisputeDesk AI is built so the AI can't
do that."

## 0:15–0:50 Evidence analysis (Merchant A, DEMO-1001)

**Screen:** sign in as Demo Merchant A. Point at the yellow demo banner. Open DEMO-1001.

**Say:** "These are labelled demo records. Evidence readiness at the top: zero of two key items on record. Counts only,
never a score. Claim and records puts the buyer's words beside what the records show and what they leave out, and it
doesn't decide who is right. Tracking and proof of delivery are missing, and marked key for this reason. Note the
line: missing from the records does not show it didn't happen. Every status shows the record field it's based on."

**Screen:** scroll to the draft. Show the review header and a gap marker.

**Say:** "The draft starts with 'requires merchant review' and marks every gap to fill. Nothing is ever sent to PayPal."

## 0:50–1:25 Gemini, checked (same dispute)

**Screen:** click Generate AI draft. Show "Checked, no issues found" and citations R1, R2.

**Say:** "Gemini rewords the findings, but it only sees the listed record values, and every line has to cite one."

**Screen:** open "How the AI checks work", then "Show a validation example".

**Say:** "Here is a planted bad answer, clearly labelled not written by Gemini. An invented carrier, a tracking number, a
date, a signature story, proof of delivery claimed as available. The server flags every one, keeps the rules'
statuses, and none of it reaches the draft."

## 1:25–1:42 Conflict and Check my edits (DEMO-1002)

**Screen:** open DEMO-1002. Point at the Conflicting tag under "Based on". In the draft, add the paragraph "Tracking
confirms the parcel reached the buyer." and press Check my edits.

**Say:** "Every finding shows the record it rests on. Here the records disagree, so it says conflicting. And the
merchant's own words are checked too: tracking is not proof of delivery, so this sentence is flagged."

## 1:42–2:05 Real PayPal sandbox dispute

**Screen:** switch the source to PayPal sandbox (blue banner). Open PP-R-JFO-10196577.

**Say:** "This one is a real dispute from PayPal's sandbox, read live through PayPal's dispute APIs. The buyer's
message, the transaction, the item and PayPal's respond-by date come from PayPal's own record. No tracking is on
record, so it shows as unverified, not missing. Read-only: it never changes a dispute."

## 2:05–2:20 Buyer view (Demo Buyer B)

**Screen:** sign out, sign in as Demo Buyer B, open DEMO-1002.

**Say:** "Buyers get their own view: what the status means, the usual stages, next steps, and what isn't on record. No
merchant evidence or drafts. 'Explain in plain language' is checked too: no promises, predictions or blame."

## 2:20–2:42 Insights (Demo Merchant C)

**Screen:** sign out, sign in as Demo Merchant C, open Insights. Point at one suggestion and its dispute IDs.

**Say:** "Insights turns a merchant's disputes into counts and patterns. For example, proof of delivery is missing or
unverified in six of seven item-not-received disputes. Each suggestion lists the disputes behind it. With small data
it says six of seven, never a percentage, and it never predicts outcomes."

## 2:42–2:55 Close

**Screen:** back to the landing page, or the footnote "DisputeDesk never submits responses to PayPal automatically."

**Say:** "Rules decide, AI only words, and the merchant always reviews. DisputeDesk AI. The code is open source on
GitHub."

---

## If you run long

Cut in this order: the buyer view (saves about 15 seconds), then the draft marker part of 0:15–0:50.
