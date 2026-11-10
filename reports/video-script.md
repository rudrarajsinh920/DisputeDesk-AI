# DisputeDesk AI: demo video script (about 2.5 minutes)

Record the live site, https://disputedesk-ai-app.vercel.app, in Chrome at full screen.

Before you record:
- Open the site and wait about a minute so the free server wakes up.
- Sign out if you are signed in.
- Close other tabs and turn off notifications.

The demo passwords are in README.md, section "Demo accounts".

Each scene has two parts:
- **Do:** what to click.
- **Say:** what to say, or what to paste into Clipchamp's text to speech.

Leave a short pause after each click.

---

## 1. Landing page (about 20 seconds)

**Do:** Show the landing page. Scroll slowly once, then go back to the top.

**Say:** "When a buyer opens a PayPal dispute, the merchant has a deadline and needs the right evidence. A general AI
assistant can write a confident reply, and to sound convincing it may invent a tracking number or a delivery date. In
a dispute, that is the worst mistake. DisputeDesk AI is built so the AI cannot add facts that are not on record."

## 2. Sign in as a merchant (about 10 seconds)

**Do:** Click sign in. Type `merchant-a@demo.disputedesk.test` and its password from the README, then sign in.

**Say:** "I'll sign in as a demo merchant. All the data here is synthetic and labelled as demo data."

## 3. Evidence analysis (about 35 seconds)

**Do:** Open a dispute from the list. Point at each of these, in order:
- "Evidence readiness"
- "Evidence analysis", with its Available, Missing and Unverified statuses
- "Contradictions", if the dispute has any

**Say:** "For each dispute, fixed rules check the evidence: order confirmation, tracking, proof of delivery and
customer messages. Each one is Available, Missing or Unverified. The rules also flag records that contradict each
other. These statuses come from rules, not from AI. And missing evidence is never treated as proof that something did
not happen."

## 4. Claim, checklist and draft (about 30 seconds)

**Do:** Scroll to each of these, in order:
- "Claim and records"
- "Evidence checklist for this reason"
- "Response draft"

Show that the draft starts with "requires merchant review".

**Say:** "Here the buyer's claim sits beside what the records show and what they leave out, without deciding who is
right. The checklist is specific to the dispute's reason and says where the merchant might look. The draft marks every
gap the merchant still has to fill, and it always needs a human to review it. DisputeDesk never submits anything to
PayPal."

## 5. How the AI is checked (about 30 seconds)

**Do:** Scroll to "How the AI checks work" and click "Show a validation example". Slowly show the dropped lines and the
reasons they were dropped.

**Say:** "Gemini only rewords findings, and it sees only the listed record values. The server checks every line it
returns. This example runs a planted bad answer through the same checks. The lines that invent a carrier, a tracking
number or a delivery claim are dropped, and the merchant sees exactly why. On this public demo, live AI is switched
off, so this example shows the checks in action."

## 6. Buyer view (about 20 seconds)

**Do:** Sign out. Sign in as `buyer-a@demo.disputedesk.test`. Open their dispute.

**Say:** "Buyers see only their own disputes, explained in plain language: what the status means, the usual stages,
and the next steps. They never see the merchant's evidence or drafts. Another account's dispute answers 'not found',
exactly like a missing one."

## 7. Close (about 15 seconds)

**Do:** Go back to the landing page.

**Say:** "DisputeDesk AI: rules decide the facts, the AI only words them, and every line is checked against the record.
It reads real PayPal sandbox disputes read-only, and it has over 400 automated tests. Thanks for watching."

---

## After recording

1. In Clipchamp, cut any long waits. Then click Export and choose 1080p.
2. Upload the video to YouTube as **Public**. The hackathon asks for a public video under three minutes.
3. Paste the YouTube link into Devpost, and into `reports/devpost-description.md` under Links.
