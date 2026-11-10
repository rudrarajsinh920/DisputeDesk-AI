# DisputeDesk

**The evidence intelligence layer for payment disputes.** It checks the evidence records behind a dispute, shows what
is on record, missing or in conflict, and explains the dispute to both sides without deciding who is right. Evidence
statuses come from the records only: files a merchant uploads are stored and, for PDFs, their text is read, but they are
never checked against the records and never change a status.

DisputeDesk helps a merchant prepare a response to a PayPal dispute. Rules check the evidence first. Gemini can then
word those findings, and the server checks every line it writes. The merchant reviews the result. DisputeDesk never
submits anything to PayPal.

It has three parts: **Merchant Evidence Intelligence** (evidence analysis and response drafts, for demo disputes and
real PayPal sandbox disputes), **Buyer Dispute Clarity** (a plain-language view of a buyer's own disputes) and
**Insights** (rule-based counts and patterns across a merchant's disputes, with practical suggestions).

- **Rules decide.** Evidence statuses (Available, Missing, Unverified) and contradictions come from fixed rules in
  `server/src/evidence.ts`. Missing evidence is never treated as proof that something did not happen.
- **AI only words.** Gemini sees only the listed record values. The server drops any line that adds a fact not on record
  (carriers, tracking numbers, dates, people, delivery claims) or changes a status, and shows what it dropped.
- **The merchant reviews.** Every draft starts with "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL." and
  marks every gap to fill.
- **Every finding shows where it comes from.** Each evidence status lists the record fields behind it ("Based on"),
  who supplied them (merchant, PayPal or the buyer) and whether the records back it: "Verified against record",
  Unverified, Missing or Conflicting. "Verified against record" means the supplied record backs it and nothing in the
  records contradicts it; DisputeDesk never checks uploaded documents against the records. The generated draft lists the records
  each line rests on ("Sources for the generated draft").
- **Check my edits.** The merchant's own wording is checked paragraph by paragraph against the same records, without
  calling Gemini. Each paragraph is marked "Backed by DisputeDesk's records", "Not in DisputeDesk's records", "Check
  against your records" or "No factual claim found". Each kind of claim needs its own record: tracking never backs a
  delivery claim, and a communication record shows that messages exist, not what they said. The check is advisory; it
  never edits or blocks the text.
- **Merchant confirmation is a statement, not verification.** On a checklist gap, a merchant can press "I have this in
  my records". DisputeDesk has not inspected that record: the item keeps its status (for example "Missing from
  records"), gains a separate "Merchant-confirmed" tag, and still counts under "Needs attention". Evidence statuses,
  readiness, the draft and AI input do not change. Confirmations work on demo disputes only; PayPal sandbox disputes
  are never stored or changed.
- **Merchant documents are stored, read and linked, never verified.** On a demo dispute, a merchant can upload a PDF,
  PNG or JPEG, read the text layer of a PDF, link a file to a checklist gap, download their own original and delete it.
  Every file is labelled "Not verified"; a linked gap keeps its status, gains "Document attached, not verified" and still
  counts under "Needs attention". No document, its text or a link ever changes an evidence status, readiness, the
  checklist status, the draft, Insights, the buyer view or anything sent to Gemini. See [Documents](#documents).

## Data sources

| Source | What it is |
|---|---|
| **Demo data** | Synthetic records in `sample-dispute.json` and `demo-disputes.json`, served by the server only to the accounts they belong to (`demo-accounts.json`). Labeled "DEMO DATA — NOT A REAL PAYPAL DISPUTE". Never sent to PayPal. |
| **PayPal sandbox** | Read-only disputes from PayPal's test environment. Each one is analysed from its own PayPal record (buyer messages, the disputed transaction and item, any submitted tracking or delivery evidence, the response deadline) with the same rules as demo data. Shows an empty state when the sandbox has none. Demo records never fill it, and sandbox disputes are never stored. |

## Tools used

| Tool | How DisputeDesk uses it |
|---|---|
| **PayPal REST APIs (sandbox)** | `POST /v1/oauth2/token` (client credentials) for an access token, `GET /v1/customer/disputes` for the merchant's dispute list, and `GET /v1/customer/disputes/{id}` for each dispute's full record. Calls run only on the server; the token never reaches the browser. No other PayPal call is made. |
| **Google Gemini API** | `generativelanguage.googleapis.com`, model set by `GEMINI_MODEL`. Words evidence explanations, response drafts, buyer explanations and Insights summaries from the listed record values only. The server checks every line and drops invented facts. |
| **Node.js 24 + Express** | The API server, run directly from TypeScript. Sessions, sign-in limits, access control and security headers. |
| **SQLite (`node:sqlite`)** | Built into Node: accounts, demo disputes, sessions, merchant documents and the append-only audit log. |
| **pdfjs-dist 6.4.299 (legacy build)** | Reads the text layer of uploaded PDFs on the server, in a separate child process. No OCR, no rendering. |
| **React 19, Vite, TypeScript** | The browser app: merchant workspace, buyer view and Insights. |
| **Tailwind CSS, Radix UI, lucide-react, GSAP** | The landing page's styling, accessible components, icons and motion (motion respects reduced-motion settings). |

**Making sandbox disputes to analyse:** on developer.paypal.com, under **Testing tools → Sandbox accounts**, use the
Business account your app belongs to and a **Personal** account with country **United States**. Log in to
`sandbox.paypal.com` as the Personal account, send the Business account a **goods and services** payment, then open
**Resolution Center → Report a problem** on it. A new dispute can take a few minutes to appear in the API.

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
| Demo Merchant C | merchant | `merchant-c@demo.disputedesk.test` | `demo-merchant-c-ot4_dVoM` | DEMO-2001 to DEMO-2014 (insights demo) |
| Demo Merchant D | merchant | `merchant-d@demo.disputedesk.test` | `demo-merchant-d-TQxRYYHE` | DEMO-3001 to DEMO-3004 (reasons without their own checklist) |
| Demo Buyer A | buyer | `buyer-a@demo.disputedesk.test` | `demo-buyer-a-wF8iuKjc` | DEMO-1001 |
| Demo Buyer B | buyer | `buyer-b@demo.disputedesk.test` | `demo-buyer-b-rrkFQMjo` | DEMO-1002, DEMO-1003 |

- **Merchants** see and analyse only the demo disputes on their own account. Merchant A also has the PayPal sandbox.
  Merchant C holds a larger synthetic set (DEMO-2001 to DEMO-2014) so the Insights view has enough records to show
  patterns; Merchants A and B show what Insights says when there is too little data.
  Merchant D holds DEMO-3001 to DEMO-3004, one for each labelled reason without a reason-specific evidence checklist
  (incorrect amount, paid by other means, canceled recurring billing, problem with remittance), so the general
  checklist can be seen on a real demo record.
- **Insights** (merchants and admin) turns the account's demo disputes into counts: status, reason, evidence
  completeness, missing and unverified evidence, conflicting records, disputes waiting for the seller or open more than
  30 days, and disputes by month opened. Fixed rules in `server/src/intelligence.ts` decide everything, on top of the
  evidence engine. A gap is a pattern only in at least 3 disputes; a share gets a percentage only with at least 10
  disputes behind it; the monthly view needs at least 6 dated disputes across 3 months. Each suggestion lists what was
  detected, the disputes and record fields behind it, why it matters, a practical action and its limits. Suggestions
  never claim to prevent disputes or change outcomes. "Summarize these insights" (merchants only) lets Gemini reword
  the findings; every paragraph is checked for invented numbers, percentages, causes, predictions, trends, dates and
  names, and the standard summary is shown, labelled, if any check fails. PayPal sandbox disputes are never included.
- **Buyers** see their own disputes only, without the merchant's order, evidence, messages or drafts. Each dispute shows
  what its status usually means, the usual stages (not a recorded history), next steps, information worth having,
  safe ways to talk to the seller, and what the record does not contain. Every block is labelled "From the record",
  "General guidance" or "Not on record". "Explain in plain language" asks the server for a rewording: Gemini may word it,
  every paragraph is checked (no promises, predictions, blame, legal claims, or dates, amounts, names or carriers that
  aren't on record), and the standard rule-based explanation is shown, labelled, whenever AI is off, fails or a check fails.
- **Admin** reads every demo dispute, the sandbox, the account list and Insights for all demo merchants, and changes
  nothing. Admin cannot generate AI drafts or AI summaries.

Sessions end after 30 minutes without activity, 8 hours after sign-in, or on sign-out. They are kept in the database,
so restarting the server keeps everyone signed in; signed-out and expired sessions are cleared at start. After
10 failed sign-ins for one email from one address, that address can't sign in to that email for 15 minutes; after 50
for one email from all addresses together, the email is locked for 15 minutes; after 100 failed sign-ins from one
address, all sign-in from it is locked for 15 minutes. Unknown emails are counted and answered the same way. Locally every request comes from 127.0.0.1, so the second limit is a cap on
all guessing. Behind a reverse proxy, set the `TRUST_PROXY` shell variable (or `.env` entry) to the number of proxies
in front of the server, so these limits apply per client instead of to everyone. Leave it unset (0) unless a proxy you
control adds `X-Forwarded-For`, or anyone could choose their own address with that header. Each account may also ask
Gemini 20 times per 15 minutes, across AI drafts and buyer and Insights explanations; past that, drafts are refused
for a while and explanations use the standard wording. The session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`; this needs a browser that accepts
`Secure` cookies on `http://localhost`, which Chrome, Edge and Firefox do.

Write requests from any other site are refused (Origin and `Sec-Fetch-Site` checks). The API sends
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy` (no camera, microphone, location, payment or USB) and a CSP
that allows nothing to run. Over HTTPS through a trusted proxy it also sends `Strict-Transport-Security`; on local
HTTP it doesn't. The page sends the same `Permissions-Policy`; set HSTS for the page on the HTTPS server in front of it. The production build (`cd client && npm run build && npm run preview`, then http://localhost:4173) has
a strict CSP: only the app's own scripts and styles. The dev server keeps a looser page CSP because Vite's live reload
needs inline code. Both refuse to start on another port, so the address never changes.

## Documents

Merchants only, on their own demo disputes only (PayPal sandbox disputes are never stored). Use synthetic test files.

| Step | What happens |
|---|---|
| **Upload** | PDF, PNG or JPEG, checked by its first bytes as well as its declared type. At most 5 MB per file, 10 per dispute and 50 MB per account; the same file twice on one dispute is refused. The name is cleaned (control and format characters, slashes) and capped at 120 characters. Files are stored in the database as they came. They are not scanned for viruses. |
| **Text** | For a PDF, the server reads the text layer with pdfjs-dist in a separate child process (128 MB JavaScript heap, 10 s limit, an empty environment, so no secrets; on Windows a few basic system variables are still passed). At most 20 pages, 200,000 characters per page and 1,000,000 per file. Encrypted, unreadable, oversized or timed-out files are marked "couldn't read text"; a file with no text layer (a scan, for example) says so. There is no OCR: images and scans have no text. "Show text" displays the text as plain text, labelled "Text as written in the file. DisputeDesk has not checked it against your records." |
| **Link** | "Link to checklist gaps" lets the merchant say a file is their record for a gap (missing, or not shown by the records). The gap keeps its status and gains "Document attached, not verified"; Needs attention is not lowered. A link on an item that is no longer a gap is not shown on the checklist but can still be removed. |
| **Download** | The merchant's own original, byte for byte, as an attachment with a fixed type, `nosniff`, a sandboxing CSP and `no-store`. The browser saves it; DisputeDesk never opens or shows it. One download at a time. |
| **Delete** | Removes the file, its text and its links. |

**Who sees what.** A merchant sees only their own files. Another account's file answers 404, exactly like a missing
one. Admin sees every merchant's files, text and links (with the owner's account) and can't upload, link, download or
delete. Buyers get no document information at all. Gemini never receives a document, its text or a link.

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
  adds each dispute's opened date and the buyer explanation audit event; migration 3 adds the insights audit events;
  migration 4 adds `gap_confirmations`; migration 5 adds `documents` and its related tables; migration 6 makes the
  database refuse a document whose owner is not a merchant with access to that dispute. An existing database is
  upgraded in place. Back up the database file before the first start of a newer server.
- **Audit log.** Sign-in (succeeded, failed, locked out), sign-out, a refused request for another account's dispute,
  analysis, AI drafts, the validation example, buyer explanations, insights views and insights summaries, gap
  confirmations and their withdrawal, and documents: upload, deletion, text read or failed (with a fixed failure code),
  link, unlink and download. Entries name the account and dispute, and for documents only the document and item IDs:
  never a file name, file text, password, token, hash or an unknown email. The log cannot be changed or deleted from the app, and it is
  never trimmed: the server prints its entry count at start. To archive it, stop the server and copy the database
  file; to start a fresh log, then delete `server/data/disputedesk.sqlite`.
- To start over, stop the server and delete `server/data/disputedesk.sqlite` only. Don't delete the whole folder:
  it also holds your database backups.

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
   Show "Based on" under each finding: every status traces to a record field. In the evidence checklist, open "How to
   fill this gap" under Shipping tracking and press **I have this in my records**. The row keeps "Missing from records",
   adds a "Merchant-confirmed" tag and the line "DisputeDesk has not seen the record. Your confirmation does not change
   its evidence status." The overview still counts it under "Needs attention" ("1 merchant-confirmed"). Press the
   button again to withdraw it.
   Optional: under **Your documents**, upload a synthetic PDF. It is listed as "Not verified"; press **Show text** to see
   the text read from it. Open **Link to checklist gaps** and tick Shipping tracking: the checklist row keeps "Missing
   from records" and adds "Document attached, not verified", Needs attention still counts it, and readiness does not
   change. **Download** saves the original. Delete it afterwards.
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
   Open "Based on" under Proof of delivery: it is tagged Conflicting. In the draft, add the paragraph "Tracking confirms
   the parcel reached the buyer." and press **Check my edits**: it is marked "Check against your records" because
   tracking is not proof of delivery. "We shipped it via UPS." is flagged too: no carrier is on record.
7. **PayPal sandbox.** Switch sources: blue banner, test environment only. Open a sandbox dispute: the buyer's message,
   the transaction and item, and PayPal's "Respond by" date come from PayPal's own record. Tracking and proof of delivery
   show as Unverified when the record has none, never as Missing. With no sandbox disputes, it says so; demo records
   never appear here.
8. **Sign out, sign in as Demo Merchant B.** Only DEMO-1003 (complete evidence): everything Available, no contradictions.
   The rules don't invent problems either, and Merchant B cannot see Merchant A's disputes or the sandbox.
9. **Sign in as Demo Buyer B.** The buyer sees DEMO-1002 and DEMO-1003, no merchant records. DEMO-1002 marks
   "Seller and buyer respond" as the current stage; the response deadline is listed as not on record. "Explain in plain
   language" shows checked AI wording, or the labelled standard explanation when AI is off.
10. **Sign in as Demo Merchant C, open Insights.** 14 synthetic disputes and six suggestions, each with the disputes behind
    it: for example, proof of delivery is missing or unverified in 6 of 7 item-not-received disputes. A share of 7 is shown
    as "6 of 7", never as a percentage. "Summarize these insights" gives checked AI wording or the labelled standard summary.
    Then sign in as Merchant B: one dispute, "Nothing to suggest yet", and no percentages.
11. **Sign in as Demo Admin.** Every dispute and Insights for all demo merchants, read-only: no AI draft or summary button.
12. Close on the footnote: DisputeDesk never submits responses to PayPal.

The demo can be repeated as often as needed: drafts are not saved, and reloading the page resets every draft. Gap
confirmations and uploaded documents are saved until withdrawn or deleted, so clear the ones from step 2 before the
next run.

## If something goes wrong during the demo

| You see | Do this |
|---|---|
| "Couldn't analyze this dispute" on every dispute | The server isn't running. Start it (`cd server && npm start`), then press Try again. |
| "AI drafting is off on this server" | Check the server log for the reason (missing key or invalid `GEMINI_MODEL`). Fix `.env`, restart the server. Everything else still works; use step 5 to show the checks. |
| AI error: rate limit or "did not answer in time" | Wait a few seconds and press Try again. Otherwise show step 5 instead; it never calls Gemini. |
| "Couldn't load PayPal sandbox disputes" | PayPal's sandbox is unreachable or slow. Press Try again, or skip step 7. Demo data is unaffected. |
| No network at the venue | Steps 1–3, 5, 6 and 8–12 work offline. Only steps 4 and 7 need the internet. |

Keep screenshots or a screen recording of a successful run as a backup.

## Limits

- Evidence statuses come from flags in the records. Uploaded documents are never checked against them: no document
  verification, no OCR, no comparison of a file's text with the records.
- Documents are demo-only and merchant-only, stored unencrypted in the SQLite file (no encryption at rest) and not
  scanned for viruses. Only synthetic files belong in this demo.
- PDF text is read in a child process with a 128 MB JavaScript heap and a 10 s limit. Memory pdfjs uses outside that
  heap has no operating-system cap, so a hostile file can use a lot of machine memory for up to 10 s before it is
  stopped; the main server keeps running. On Windows the child stops when the server does; this was not tested on
  Linux or macOS. pdfjs drops most standalone format characters (zero-width joiners, direction marks) and expands
  ligatures, so extracted text can differ slightly from what the file shows.
- A link is the merchant's statement that a file is their record for a gap, like a confirmation; it is not evidence.
- Download was checked in the desktop app's built-in browser (exact bytes) and by tests (headers, PDF, PNG, JPEG,
  5 MB, hostile names). The saved file name in Chrome, Edge and Firefox has not been checked.
- The AI checks are rules and patterns. They catch the listed kinds of invented detail, not every possible one, which is
  why merchant review stays mandatory. The same holds for Check my edits: its claim matching is advisory.
- The PayPal integration only reads (an access token, the dispute list and each dispute's record). It never creates,
  changes or answers a dispute, and never submits evidence. The list reads the first 50 disputes.
- A gap confirmation is the merchant's own statement. DisputeDesk never sees the record behind it, and it is kept for
  demo disputes only.
- Drafts are not saved. Accounts are seven synthetic demo accounts with no sign-up. The server answers only on this
  machine (127.0.0.1).
- One server process per database. The sign-in and AI limits are kept in memory (at most 10,000 keys), so a restart
  lifts a lockout.
- The audit log has no retention limit; it grows until it is archived and the database is deleted.
- Insights rest on a handful of synthetic records and four evidence flags per dispute. No outcome or resolved date is on
  record, so there are no outcome rates or time-to-resolution figures. The AI number check confirms that each number
  appears in the findings, not that it is paired with the right finding.
