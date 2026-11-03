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
| **Demo data** | Synthetic records in `sample-dispute.json` and `demo-disputes.json`, served by the server only to the accounts they belong to (`demo-accounts.json`). Labeled "DEMO DATA — NOT A REAL PAYPAL DISPUTE". Never sent to PayPal. |
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

Open http://localhost:5173 (always this address, not 127.0.0.1, so the sign-in cookie stays on one host). The server
log line says whether PayPal and AI drafting are on, and why not.

## Demo accounts

Sign in with one of these **synthetic demo accounts**. They are not real people, the passwords are not real secrets,
and they work only on this local demo server. `demo-accounts.json` stores only their scrypt hashes. Never reuse a real
password here.

| Account | Role | Email | Password | Can see |
|---|---|---|---|---|
| Demo Admin | admin | `admin@demo.disputedesk.test` | `demo-admin-89HLaG83` | all (read-only) |
| Demo Merchant A | merchant | `merchant-a@demo.disputedesk.test` | `demo-merchant-a-C9Y-jSMY` | DEMO-1001, DEMO-1002, PayPal sandbox |
| Demo Merchant B | merchant | `merchant-b@demo.disputedesk.test` | `demo-merchant-b-rHa959Nf` | DEMO-1003 |
| Demo Buyer A | buyer | `buyer-a@demo.disputedesk.test` | `demo-buyer-a-wF8iuKjc` | DEMO-1001 |
| Demo Buyer B | buyer | `buyer-b@demo.disputedesk.test` | `demo-buyer-b-rrkFQMjo` | DEMO-1002, DEMO-1003 |

- **Merchants** see and analyse only the demo disputes on their own account. Merchant A also has the PayPal sandbox.
- **Buyers** see their own disputes only, without the merchant's order, evidence, messages or drafts. Each dispute shows
  what its status usually means, the usual stages (not a recorded history), next steps, information worth having,
  safe ways to talk to the seller, and what the record does not contain. Every block is labelled "From the record",
  "General guidance" or "Not on record". "Explain in plain language" asks the server for a rewording: Gemini may word it,
  every paragraph is checked (no promises, predictions, blame, legal claims, or dates, amounts, names or carriers that
  aren't on record), and the standard rule-based explanation is shown, labelled, whenever AI is off, fails or a check fails.
- **Admin** reads every demo dispute, the sandbox and the account list, and changes nothing. Admin cannot generate AI drafts.

Sessions end after 30 minutes without activity, 8 hours after sign-in, or on sign-out. They are kept in the database,
so restarting the server keeps everyone signed in. After
10 failed sign-ins for one email, that email is locked for 15 minutes; after 100 failed sign-ins from one address, all
sign-in from it is locked for 15 minutes. Locally every request comes from 127.0.0.1, so the second limit is a cap on
all guessing. The session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`; this needs a browser that accepts
`Secure` cookies on `http://localhost`, which Chrome, Edge and Firefox do.

Write requests from any other site are refused (Origin and `Sec-Fetch-Site` checks). The API sends
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy` and a CSP that allows
nothing to run. The production build (`cd client && npm run build && npm run preview`, then http://localhost:4173) has
a strict CSP: only the app's own scripts and styles. The dev server keeps a looser page CSP because Vite's live reload
needs inline code. Both refuse to start on another port, so the address never changes.

## Database

The server keeps its data in SQLite through Node's built-in `node:sqlite` (no extra package), in
`server/data/disputedesk.sqlite`. Set the `DATABASE_PATH` shell variable to use another file. The folder is
gitignored: it holds password hashes and session hashes, never passwords or session tokens.

- **Created and upgraded on start.** Numbered migrations in `server/src/db.ts` run in order, each in one transaction.
  A failed migration, or a database written by a newer server, stops the server before it serves anything.
- **Demo data is mirrored from the files.** On every start the demo accounts, demo disputes, their evidence and who can
  see them are copied from `demo-accounts.json`, `sample-dispute.json` and `demo-disputes.json`, in one
  transaction. The files stay the source of truth; edit them, not the database. Changing an account's password hash ends
  that account's sessions. PayPal sandbox disputes are never stored: they are read live, so the two never mix.
- **Tables.** `accounts`, `disputes` (demo only), `dispute_evidence` (one row per supplied flag; no row means "not
  supplied", never "false"), `dispute_access`, `sessions` (keyed by a hash of the token) and `audit_log`. Migration 2
  adds each dispute's opened date and the buyer explanation audit event; an existing database is upgraded in place.
- **Audit log.** Sign-in (succeeded, failed, locked out), sign-out, a refused request for another account's dispute,
  analysis, AI drafts, the validation example and buyer explanations. Entries name the account and dispute, never a password, token, hash or
  an unknown email. The log cannot be changed or deleted from the app.
- To start over, stop the server and delete the `server/data` folder.

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

1. **Sign in as Demo Merchant A.** Point at the yellow banner: these are synthetic demo records, not PayPal data. Merchant
   A sees two disputes (DEMO-1001 and DEMO-1002), only the ones on this account.
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
7. **PayPal sandbox.** Switch sources: blue banner, test environment only. With no sandbox disputes, it says so; demo
   records never appear here.
8. **Sign out, sign in as Demo Merchant B.** Only DEMO-1003 (complete evidence): everything Available, no contradictions.
   The rules don't invent problems either, and Merchant B cannot see Merchant A's disputes or the sandbox.
9. **Sign in as Demo Buyer B.** The buyer sees DEMO-1002 and DEMO-1003, no merchant records. DEMO-1002 marks
   "Seller and buyer respond" as the current stage; the response deadline is listed as not on record. "Explain in plain
   language" shows checked AI wording, or the labelled standard explanation when AI is off.
10. **Sign in as Demo Admin.** Every dispute, read-only: no AI draft button.
11. Close on the footnote: DisputeDesk never submits responses to PayPal.

The demo can be repeated as often as needed: nothing is saved, and reloading the page resets every draft.

## If something goes wrong during the demo

| You see | Do this |
|---|---|
| "Couldn't analyze this dispute" on every dispute | The server isn't running. Start it (`cd server && npm start`), then press Try again. |
| "AI drafting is off on this server" | Check the server log for the reason (missing key or invalid `GEMINI_MODEL`). Fix `.env`, restart the server. Everything else still works; use step 5 to show the checks. |
| AI error: rate limit or "did not answer in time" | Wait a few seconds and press Try again. Otherwise show step 5 instead; it never calls Gemini. |
| "Couldn't load PayPal sandbox disputes" | PayPal's sandbox is unreachable or slow. Press Try again, or skip step 7. Demo data is unaffected. |
| No network at the venue | Steps 1–3, 5, 6 and 8–11 work offline. Only steps 4 and 7 need the internet. |

Keep screenshots or a screen recording of a successful run as a backup.

## Limits

- Evidence statuses come from flags in the records. DisputeDesk does not open or inspect the documents themselves.
- The AI checks are rules and patterns. They catch the listed kinds of invented detail, not every possible one, which is
  why merchant review stays mandatory.
- The PayPal integration only reads (an access token and the dispute list). It never creates, changes or answers a
  dispute.
- Drafts are not saved. Accounts are five synthetic demo accounts with no sign-up. The server answers only on this
  machine (127.0.0.1).
- One server process per database. The sign-in limit is still kept in memory, so a restart lifts a lockout.
- The audit log has no retention limit yet; it grows until the database is deleted.
