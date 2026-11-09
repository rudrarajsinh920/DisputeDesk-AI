# DisputeDesk AI: Devpost submission draft

Paste each section into the matching Devpost field. Replace the two links at the bottom once the video is up.

---

## Tagline (short description)

The evidence intelligence layer for payment disputes: AI that helps answer PayPal disputes, with every line checked against the records.

---

## Inspiration

When a buyer opens a PayPal dispute, the merchant has a deadline and has to answer with the right evidence. A general
AI assistant will happily write a confident reply, and to sound convincing it may invent a tracking number, a carrier
or a delivery date. In a dispute that is the worst possible mistake. We wanted to see what an AI dispute assistant
looks like when it is built so that it cannot add facts that are not on record.

## What it does

DisputeDesk AI has three parts.

**Merchant Evidence Intelligence.** For each dispute, fixed rules check four kinds of evidence (order confirmation,
shipping tracking, proof of delivery, customer communication) and mark each one Available, Missing or Unverified,
weighted for the dispute's reason. They also flag records that contradict each other, such as an order marked
delivered with no proof of delivery. Each dispute opens with an evidence readiness summary (key evidence on record,
missing or unverified items, conflicts, gaps left to fill: counts only, never a score) and a "Claim and records" view
that puts the buyer's claim beside what the records show and what they leave out, without deciding who is right.
Evidence statuses come from the evidence flags on each record; DisputeDesk does not open the documents themselves.
DisputeDesk then writes a response draft that starts with "requires merchant
review" and marks every gap the merchant still has to fill. Missing evidence is never treated as proof that something
did not happen.

**Gemini, checked.** Gemini can reword the findings into a clearer explanation and draft. It sees only the listed
record values, and every line must cite them. The server checks every line and drops anything that adds a fact not on
record (carriers, tracking numbers, dates, names, delivery claims) or changes a status, and shows the merchant what it
dropped. A built-in validation example runs a planted bad answer through the same checks so anyone can see them work.

**Evidence provenance and claim checking.** Every evidence status shows the record fields it is based on, who supplied
them, and whether the records back it ("Verified against record"), leave it unverified or missing, or contradict it
("Conflicting"). "Verified against record" means the supplied record backs it and nothing in the records contradicts
it; DisputeDesk checks records, it does not inspect the documents themselves. The draft lists the records each line
rests on. "Check my edits" then checks the merchant's own wording paragraph by paragraph, with no AI call: each
paragraph is backed by DisputeDesk's records, not in them, or needs checking against the merchant's own records. Each
kind of claim needs its own record, so tracking never counts as proof of delivery, a message record never proves what
a message said, and refunds, offers and attachments are never backed because DisputeDesk holds no records of them.
The check is advisory and never edits or blocks the merchant's text.

**Evidence checklist per reason.** Each dispute gets a checklist for its reason (item not received, not as described,
unauthorized, duplicate, credit not processed; other reasons get a general list). Statuses come from the same rules:
available, missing, conflicting, or not shown by the records. Each gap says why it may matter, where the merchant might
look (labelled by kind, such as carrier or order system), what to check before adding it, and what DisputeDesk can't
see. Every item is labelled general or DisputeDesk guidance; none is presented as an official PayPal requirement.

**Real PayPal sandbox disputes.** DisputeDesk reads disputes live from the PayPal sandbox and analyses each one from
its own PayPal record: the buyer's messages, the disputed transaction and item, any submitted tracking or delivery
evidence, and PayPal's respond-by date. When the record has no tracking, it shows as Unverified, never Missing, and
nothing is filled in.

**Buyer Dispute Clarity.** Buyers see only their own disputes, without the merchant's evidence or drafts: what the
status means, the usual stages, next steps, and what the record does not contain. An optional plain-language AI
explanation is checked for promises, predictions, blame and invented details.

**Insights.** Rule-based counts across a merchant's disputes: status, reason, evidence gaps, conflicting records,
disputes waiting on the seller, and a monthly view. Each suggestion lists the disputes behind it, why it matters, a
practical action and its limits. Small numbers stay as counts ("6 of 7"), never percentages, and nothing predicts
outcomes.

DisputeDesk never submits anything to PayPal. Every draft needs a human.

## How we built it

- **PayPal REST APIs (sandbox):** OAuth 2.0 client credentials for an access token, `GET /v1/customer/disputes` for
  the merchant's dispute list, and `GET /v1/customer/disputes/{id}` for each dispute's full record. All calls run on
  the server; the token never reaches the browser. The integration is read-only on purpose.
- **Google Gemini API:** words explanations, drafts, buyer explanations and Insights summaries. The server builds a
  numbered list of record facts for each prompt and validates every returned line against it.
- **Server:** Node.js 24 and Express in TypeScript, with SQLite built into Node (`node:sqlite`) for accounts, demo
  disputes, sessions and an append-only audit log.
- **Client:** React 19, Vite and TypeScript, with Tailwind CSS, Radix UI and GSAP on the landing page.
- **Security:** role-based access (merchant, buyer, read-only admin), server-side sessions, sign-in limits,
  same-site write checks, a strict Content Security Policy, and a rule that another account's dispute answers 404,
  exactly like a missing one.
- **Tests:** 316 automated tests with synthetic data and mocked PayPal and Gemini, so they make no network calls.

## Challenges we ran into

- **Making "missing" honest.** A record that doesn't mention tracking is not the same as a merchant with no tracking.
  We kept three states (Available, Missing, Unverified) all the way from the PayPal record to the screen, so the app
  never turns silence into a claim.
- **Checking AI output, not just prompting it.** Telling a model "don't invent facts" is not enough. We built checks
  that compare each line with the record values and drop what doesn't match, then made those checks visible. The
  checks are rules and patterns, so they catch the kinds of invented detail we listed, not every possible wording.
  That is why a person reviews every draft.
- **Mapping PayPal's dispute record.** Messages, transactions and evidence live in different parts of the record. We
  map only fields that are present and leave the rest unset.
- **Keeping demo and real data apart.** Synthetic demo disputes and PayPal sandbox disputes are always labelled, never
  mixed, and sandbox disputes are never stored.

## Accomplishments that we're proud of

- An AI feature you can audit: every AI line shows what it is based on, and every dropped line shows why.
- Provenance for every finding, and a claim check that holds the merchant's own wording to the same records.
- Real PayPal sandbox disputes analysed end to end, read-only.
- Separate merchant, buyer and admin views with strict access control, covered by tests.

## What we learned

The model is the easy part. The value is in what surrounds it: deciding facts with rules, giving the model only those
facts, and checking what comes back. Being clear about what the data does not say turned out to matter as much as what
it does say.

## What's next for DisputeDesk AI

- Sort sandbox disputes by PayPal's respond-by date, most urgent first.
- Let buyers see their own sandbox disputes.
- Read more of PayPal's dispute record, such as adjudication history, with the same "only what's on record" rule.
- With explicit merchant approval, help prepare the evidence package for PayPal's provide-evidence step, still with a
  human pressing submit.

---

## Built with (tags)

paypal, paypal-rest-api, gemini, node.js, express, typescript, react, vite, sqlite, tailwindcss, radix-ui, gsap

## Links

- Code: https://github.com/rudrarajsinh920/DisputeDesk-AI
- Demo video: (YouTube link here)
- Try it: setup instructions are in the README (Setup, Run, Demo accounts).
