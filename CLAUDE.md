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
- `demo-accounts.json`: synthetic demo accounts (scrypt hashes only) and which disputes each can reach. The demo
  passwords are in README.md. Tests use their own test-only passwords.
- `server/src/db.ts`: SQLite (built-in `node:sqlite`), schema migrations, `transaction`. `server/src/store.ts`: accounts,
  demo disputes, evidence, access and the audit log. Database file: `server/data/` (gitignored).
- `server/src/auth.ts`: password hashing, sessions (in the database), cookie, sign-in limit, `canAccess`. Every protected route uses
  `requireRole` in `app.ts`; the account comes from the server's session store, never from the request.

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
  Another account's dispute answers 404, exactly like a missing one. Admin is read-only.
- Never trust a role or account ID sent by the browser. Demo disputes reach the browser only through the server.
- Every route needs a session except sign-in and sign-out; a test fails if a new route is not in its role table.
- Keep the security headers (API in `app.ts`, page in `client/src/security-headers.ts`) and the strict production CSP.
  Write requests from another site are refused (Origin and Sec-Fetch-Site).
- Never return access tokens or credentials to the frontend.
- SQL uses `?` placeholders only. Migrations are forward-only: never edit a released one, add a new one at the end.
- The demo files are the source of truth for demo data; the database mirrors them on start. PayPal sandbox disputes
  are never stored. Sessions store only a hash of the token. The audit log is append-only and never holds secrets.

## Working rules

- Never print, log or commit `.env` values, API keys, tokens or passwords. Never edit `.env`.
- Tests use synthetic data and mocked PayPal and Gemini; they make no network calls.
- No live Gemini or PayPal calls without the user's approval.
- No new dependencies unless needed.
- Commit only when the user says so. Do not push.
