# DisputeDesk

DisputeDesk helps a merchant prepare a response to a PayPal dispute. Rules check the evidence first. Gemini can then
word those findings, and the server checks every line it writes. The merchant reviews the result. DisputeDesk never
submits anything to PayPal.

- **Rules decide.** Evidence statuses (Available, Missing, Unverified) and contradictions come from fixed rules in
  `server/src/evidence.ts`. Missing evidence is never treated as proof that something did not happen.
- **AI only words.** Gemini sees only the listed record values. The server drops any line that adds a fact not on record
  (carriers, tracking numbers, dates, people, delivery claims) or changes a status, and shows what it dropped.
- **The merchant reviews.** Every draft starts with "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL." and
  marks every gap to fill.

## Data sources

| Source | What it is |
|---|---|
| **Demo data** | Synthetic records in `sample-dispute.json` and `demo-disputes.json`. Labeled "DEMO DATA — NOT A REAL PAYPAL DISPUTE". Never sent to PayPal. |
| **PayPal sandbox** | Read-only list of disputes from PayPal's test environment. Shows an empty state when the sandbox has none. Demo records never fill it. |

## Setup

Requirements: Node.js 24 or later.

```bash
cd server && npm install
```

```bash
cd client && npm install
```

Create `.env` in the project root with these keys. Never commit it; it is in `.gitignore`.

```
PAYPAL_CLIENT_ID=...        # PayPal sandbox app (optional: without it, the sandbox view says it is not configured)
PAYPAL_CLIENT_SECRET=...
GEMINI_API_KEY=...          # optional: without it, AI drafting is off and the rest works
GEMINI_MODEL=gemini-3.5-flash-lite   # optional; this is the default. Must be a model code, not a placeholder.
```

An invalid `GEMINI_MODEL` turns AI drafting off; it never stops the server or picks another model.

## Run

Two terminals:

```bash
cd server && npm start
```

```bash
cd client && npm run dev
```

Open http://localhost:5173. The server log line says whether PayPal and AI drafting are on, and why not.

## Test

```bash
cd server && npm test && npm run typecheck
```

```bash
cd client && npm test && npm run typecheck && npm run build
```

All tests use synthetic data and mocked PayPal and Gemini. They make no network calls.

## Demo script (about 5 minutes)

Before you start: both terminals running, and the server log says `AI drafting: on (...)`.

1. **Dashboard.** Point at the yellow banner: these are synthetic demo records, not PayPal data. Three disputes.
2. **DEMO-1001 (item not received, gaps).** Evidence analysis: tracking and proof of delivery are Missing and marked
   "Key for this reason". Read the line "Missing from the supplied records does not show that it did not happen."
   Show "Based on" under each finding: every status traces to a record field.
3. **Response draft.** The rule draft starts with the review header and has 5 markers to resolve. Type in it: the marker
   count updates. Reset restores it.
4. **Generate AI draft.** The section names the model before you click. Result: "Checked, no issues found", the AI wording
   for each finding with its citations (R1, R2…), and the statuses still match the rules.
5. **How the AI checks work → Show a validation example.** A fixed answer with planted mistakes, labeled "NOT WRITTEN BY
   GEMINI", goes through the same checks: an invented carrier and tracking number, a date, a person, a signature story,
   proof of delivery claimed as Available, and an instruction. All are flagged, the rules' statuses stay, and none of
   it reaches a draft.
6. **DEMO-1002 (contradiction).** The order says "Delivered" but proof of delivery is marked not available. The
   contradiction is listed with both records, and the draft carries a `[CONFLICT: …]` marker instead of choosing a side.
7. **DEMO-1003 (complete evidence).** Everything Available, no contradictions: the rules don't invent problems either.
8. **PayPal sandbox.** Switch sources: blue banner, test environment only. With no sandbox disputes, it says so; demo
   records never appear here.
9. Close on the footnote: DisputeDesk never submits responses to PayPal.

The demo can be repeated as often as needed: nothing is saved, and reloading the page resets every draft.

## If something goes wrong during the demo

| You see | Do this |
|---|---|
| "Couldn't analyze this dispute" on every dispute | The server isn't running. Start it (`cd server && npm start`), then press Try again. |
| "AI drafting is off on this server" | Check the server log for the reason (missing key or invalid `GEMINI_MODEL`). Fix `.env`, restart the server. Everything else still works; use step 5 to show the checks. |
| AI error: rate limit or "did not answer in time" | Wait a few seconds and press Try again. Otherwise show step 5 instead; it never calls Gemini. |
| "Couldn't load PayPal sandbox disputes" | PayPal's sandbox is unreachable or slow. Press Try again, or skip step 8. Demo data is unaffected. |
| No network at the venue | Steps 1–3 and 5–7 work offline. Only steps 4 and 8 need the internet. |

Keep screenshots or a screen recording of a successful run as a backup.

## Limits

- Evidence statuses come from flags in the records. DisputeDesk does not open or inspect the documents themselves.
- The AI checks are rules and patterns. They catch the listed kinds of invented detail, not every possible one, which is
  why merchant review stays mandatory.
- The PayPal integration only reads (an access token and the dispute list). It never creates, changes or answers a
  dispute.
- Drafts are not saved. There are no accounts. The server answers only on this machine (127.0.0.1).
