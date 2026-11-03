# DisputeDesk AI

AI-assisted payment dispute platform. Planned modules: Merchant Evidence Intelligence (built), Buyer Dispute Clarity,
Dispute Prevention & Resolution Intelligence.

## Layout

- `client/` React + TypeScript + Vite. `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.
- `server/` Express + TypeScript, run directly by Node 24. `npm start`, `npm test`, `npm run typecheck`.
- `shared/` Types and labels used by both. Pure TypeScript, no browser or Node APIs.
- `server/src/evidence.ts` Rule-based evidence engine. `server/src/assist.ts` AI prompt and answer checks.
- Root `disputes.js`, `test.js`, `draft-response.js`, `evidence-checklist.js`: original PayPal sandbox scripts. Keep them.
  `draft-response.js` and `evidence-checklist.js` read `sample-dispute.json` as a single object; keep it one object.
- `sample-dispute.json`, `demo-disputes.json`: synthetic demo records.

## Guarantees (do not weaken)

- The deterministic evidence engine is the source of truth for evidence statuses and contradictions.
- Gemini only words explanations and drafts. The server checks every AI line against the records and drops invented facts.
- Never invent transaction facts or evidence: tracking numbers, carriers, dates, people, messages, delivery claims.
- Missing evidence is never proof that an event did not happen.
- PayPal integration is read-only (token + GET) unless the user explicitly approves more.
  Never create or change disputes, submit evidence, or make other state-changing PayPal calls.
- No automatic dispute submissions. Every draft requires human review and says so.
- Synthetic demo data is always labelled and kept separate from PayPal sandbox data.
- Buyer and merchant data must be protected by access controls; one account never sees another's data.
- Never return access tokens or credentials to the frontend.

## Working rules

- Never print, log or commit `.env` values, API keys, tokens or passwords. Never edit `.env`.
- Tests use synthetic data and mocked PayPal and Gemini; they make no network calls.
- No live Gemini or PayPal calls without the user's approval.
- No new dependencies unless needed.
- Commit only when the user says so. Do not push.
