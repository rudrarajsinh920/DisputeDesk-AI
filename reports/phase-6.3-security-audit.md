# DisputeDesk AI: Phase 6.3 Security Audit

Audit only. No source, config, schema, demo data or existing report was changed. Nothing was installed, committed or pushed. No live PayPal or Gemini call was made. No `.env` value was read or printed.

## 1. Executive summary

DisputeDesk's core security controls hold up under testing:

- passwords are hashed with scrypt;
- session cookies are `__Host-`, HttpOnly, Secure and SameSite=Strict, and only a hash of each token is stored;
- the session token changes at every sign-in;
- write requests from other sites are refused by an Origin and Sec-Fetch-Site guard;
- a Host allow-list blocks DNS rebinding;
- every route checks the role on the server;
- another account's dispute answers 404, the same as a missing one;
- SQL uses parameters only;
- the production CSP is strict;
- the audit log cannot be changed or deleted.

No Critical or High issue was found, and `npm audit` reports 0 known vulnerabilities.

One **Medium** issue: a shared per-address sign-in cap. Locally, and behind a proxy, every request arrives from one address. Anyone who can reach the server can therefore block **all** sign-ins for 15 minutes with 100 wrong attempts.

Five **Low** issues and ten **Informational** notes follow. Most concern going to production, which the app does not yet support: it is localhost-only by design.

**Verdict: CONDITIONAL PASS.**

## 2. Git baseline

| Item | Value |
|---|---|
| Branch / HEAD | `master` at `8efebc0` ("Warn on over-long drafts and print one line when the database won't open") |
| Ahead of origin | 3 commits, not pushed |
| Tracked changes, staged changes, stashes | none |
| Untracked | `reports/*` (earlier reports, PDFs, `visual-qa/`). All preserved. |
| Phase 6.2 | Audit only, so no commits of its own. Its L1 and L3 fixes are in `8efebc0`, and `a34db75` and older commits are present. |
| `.env` | Ignored (`.gitignore:1`) and never committed (`git log --all -- .env` is empty). Only `.env.example` is tracked, and all four of its values are empty. |

## 3. Audit scope

- **Server:** `server/src/` (`app.ts`, `auth.ts`, `store.ts`, `db.ts`, `validate.ts`, `paypal.ts`, `gemini.ts`, `config.ts`, `index.ts`).
- **Client:** `client/src/security-headers.ts`, `vite.config.ts` and `index.html`, the built bundle in `client/dist`, and a scan of the client source for raw HTML.
- **Root scripts:** the PayPal sandbox scripts, read only.
- **Dependencies:** all three lock files.

Out of scope: a real deployment (none exists), live PayPal and Gemini, browser extensions, and the operating system.

**Tools.** I used only built-in tools: git, grep, `npm audit`, the existing test suites, and two throwaway probe scripts in the session scratchpad.

- The probes ran an isolated server: an in-memory database, the demo account layout with random test-only passwords, PayPal off, and a fake Gemini object that only counted calls.
- The real database, demo accounts and running app were not touched, and no real demo account was locked.
- Security skills are installed (`security-review`, `security-and-hardening`, `cso`), but I did not use them. The listed design skills (Emil, Web Interface Guidelines, Taste, UI UX Pro Max, GSAP, Impeccable) are not security tools.
- The Chrome DevTools MCP server failed to connect. It was not needed.

## 4. Security checks performed

How each check was verified:
- **LIVE**: local test against the isolated server.
- **AUTO**: existing automated tests (server 189/189, client 86/86 pass).
- **SRC**: reading the source code.
- **INF**: inferred, not verified.

| Area | Result | How |
|---|---|---|
| Password hashing | scrypt (N=16384, r=8, p=1), 16-byte random salt, `timingSafeEqual` (`auth.ts:13-42`). A malformed hash is false. | SRC, AUTO |
| Unknown email vs wrong password | A dummy hash is verified for unknown emails (`app.ts:104,229`). Measured medians: 88 ms vs 79 ms, with the same message. | LIVE |
| Role or ID sent in the login body | Ignored. Signing in as Buyer with `role:"admin"` still returns the buyer role. | LIVE |
| Lockout per email | 10 failures in 15 min, then 429 with `Retry-After: 900`, even for the correct password. Case and space variants share one key (`validate.ts:30`). | LIVE, AUTO |
| Lockout bypass via `X-Forwarded-For` | Not possible: `trust proxy` is off, so the header is ignored. | LIVE |
| Per-address cap | 100 failures from one address, then every sign-in is blocked. See **M1**. | LIVE |
| Session token | 32 random bytes (43 characters, base64url). Only its SHA-256 is stored (`auth.ts:53-60`); the stored columns are `token_hash, account_id, created_at, last_seen_at, revoked_at`. | LIVE |
| Session fixation and rotation | A new token at sign-in, and the old cookie's session is revoked (`app.ts:237-243`). The old token then gives 401. | LIVE |
| Sign-out | Revoked on the server; the token afterwards gives 401. | LIVE |
| Expiry | Idle 30 min, absolute 8 h (`auth.ts:46-47,69`). | AUTO |
| Forged or missing cookie | 401 `not_signed_in`, and the forged cookie is cleared (`Max-Age=0`). | LIVE |
| Cookie flags | `__Host-dd_session; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`. | LIVE, AUTO |
| CSRF guard | Evil, `null` and malformed Origin get 403. Sec-Fetch-Site `cross-site` or `same-site` gets 403. Same origin passes. It also covers sign-in and sign-out (`app.ts:193-209`). | LIVE |
| Host allow-list | `evil.example` and `attacker.test:3001` get 403. `localhost` and `[::1]` pass. | LIVE |
| CORS | No `Access-Control-Allow-Origin` header anywhere. A preflight from an evil Origin gets 403. | LIVE |
| Authorization (IDOR) | Merchant A on B's dispute and on a missing ID both give 404 with an identical body; B on A's gives 404. Analysis, check, AI and example all give 404 on another merchant's dispute. The list shows own disputes only. The attempt is audited. | LIVE, AUTO |
| Buyer access | Merchant list, analysis, admin and Insights give 403. Another buyer's dispute gives 404. The buyer list has no `order`, `evidence` or `customer_message`. | LIVE, AUTO |
| Admin | AI draft and check give 403. `PUT /settings` gives 404. The account list holds no hashes. | LIVE |
| Route coverage | Every route uses `requireRole` except sign-in and sign-out; a test fails if a route is missing from the role table. | SRC, AUTO |
| SQL | `?` placeholders throughout. The only template is a constant column list (`store.ts:31-57`). | SRC |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in the client source. React escapes all record text. | SRC |
| Request sizes | Sign-in 1 KB, lookups 4 KB, check 64 KB. 5 KB to analysis gives 413; 70 KB to check gives 413; a 2 KB sign-in gives 413. | LIVE |
| Draft limit (Phase 6.2) | 8,000 characters gives 200; 8,001 gives 400 `text_too_long`; 8,000 accented characters gives 200. The old 16 KB body limit is now 64 KB (`app.ts:443`). A check of 8,000 characters took 8 ms. | LIVE, AUTO |
| Malformed input | Path traversal in a dispute ID and an array body give 400. Bad JSON gives `invalid_json`. `__proto__` in the body is harmless (200, no role change). | LIVE |
| API headers | `default-src 'none'; frame-ancestors 'none'`, `nosniff`, `DENY`, `no-referrer`, CORP `same-origin`, `Cache-Control: no-store`, no `X-Powered-By`. | LIVE |
| Page CSP (production) | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; …; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. No `unsafe-inline` or `unsafe-eval`. The only script tag in `index.html` is the external module. | SRC, AUTO |
| Secrets in tracked files | A pattern scan (Google API key, private key, PayPal token, GitHub and OpenAI-style tokens) found nothing. | SRC |
| Secrets in the bundle | `client/dist` has no key names and no PayPal or Gemini host names. There are no source maps. | SRC |
| Keys stay on the server | PayPal Basic auth and Bearer token live only in `paypal.ts`. The Gemini key goes in the `x-goog-api-key` header, never the URL (`gemini.ts:46-47`). | SRC |
| PayPal writes | Only `POST /v1/oauth2/token` plus two GETs. The dispute ID is URL-encoded (`paypal.ts:45,85,95`). | SRC, AUTO |
| Upstream errors | Fixed messages and an HTTP status only; no upstream body or token reaches the browser or logs (`app.ts:473-489`). | SRC, AUTO |
| AI output | Every line is checked against the records; flagged lines are removed; drafts are labelled and need review. | SRC, AUTO |
| AI off | 503 `ai_not_configured`, and the rule-based analysis still works. | LIVE (Phase 6.2) |
| Audit log | UPDATE and DELETE abort with "audit_log is append-only". 125 rows held no password, token, invented email or draft text. Unknown emails are not logged. A denied cross-account attempt is logged. | LIVE |
| Log injection | The log stores only server-validated values: known account IDs, real dispute IDs, fixed event names. | SRC |
| Database | Opened only at the path set in code or `DATABASE_PATH`. A bad file stops startup with one line (`index.ts:9-17`). Migrations are forward-only. The file ACL allows SYSTEM, Administrators and the user only. | SRC, LIVE |

## 5–8. Findings

The severity column (Sev) uses M for Medium, L for Low and I for Informational. Impact is for the app as built: localhost only, synthetic demo accounts.

| ID | Sev | Finding and evidence | Exploitability and impact | Verified | Smallest remediation (not done) |
|---|---|---|---|---|---|
| **M1** | Medium | **One per-address sign-in cap shared by everyone.** `LOGIN_MAX_FAILURES_PER_ADDRESS = 100` keyed on `req.ip` (`auth.ts:101`, `app.ts:220-223`). Locally every request comes from 127.0.0.1 through the Vite proxy. Behind a reverse proxy, without `trust proxy`, every request comes from the proxy. 100 failures on invented emails blocked the buyer's correct password (429). | Anyone who can reach the server can lock **all** users out for 15 minutes, repeatedly. No data is exposed. Locally only local users can do it; in production it is a cheap denial of service. | LIVE | At deploy time set `app.set("trust proxy", <hops>)` so `req.ip` is the real client. Optionally let a correct password through the per-address cap when that email's own key is not blocked. |
| **L1** | Low | **Targeted lockout.** 10 wrong passwords lock one account, even for its owner, for 15 minutes (`auth.ts:98`, `app.ts:223`). | An attacker who knows an email can keep that person signed out. This is the usual cost of hard lockouts. | LIVE | Accept, or replace the hard block with a growing delay per email. |
| **L2** | Low | **No per-account limit on Gemini-backed routes** (`/api/analysis/ai`, `/api/buyer/explain`, `/api/intelligence/explain`). There is only a one-at-a-time guard (`app.ts:98,290,331,411`). 25 back-to-back requests produced 25 Gemini calls (fake client). | A signed-in merchant or buyer can use up the Gemini quota or budget. Gemini's own 429 is handled (`gemini.ts:73`). | LIVE | Reuse `createLoginLimiter` as a per-account limiter on these three routes (for example 20 per 15 minutes) and answer 429. |
| **L3** | Low | **No HSTS and no Permissions-Policy** on the page or the API (`security-headers.ts:2-16`, `app.ts:169-178`). | No effect on localhost over HTTP. Over HTTPS, the missing HSTS allows a first-visit downgrade. | LIVE | Add `Strict-Transport-Security` at the HTTPS terminator. Add `Permissions-Policy: camera=(), microphone=(), geolocation=()` to `COMMON` and the API headers. |
| **L4** | Low | **The audit log and session table grow without limit.** Every analysis view, explanation and failed sign-in writes a row (`store.ts:141-147`). Expired sessions are cleared only at the next sign-in (`auth.ts:58`). | A signed-in user, or someone guessing passwords, can grow the database file. There is no retention or export. | SRC, LIVE (125 rows from one probe run) | Document a retention and backup policy. Because the log is append-only, archive it by copying the file rather than deleting rows, and add a startup cleanup of expired sessions. |
| **L5** | Low | **The limiter's memory is unbounded across many addresses.** Each failed unknown email adds a key for 15 minutes (`auth.ts:104-119`, which already marks it as a shortcut). | Only matters with many client addresses, meaning production behind `trust proxy`. | SRC | Cap the map size and drop the oldest keys. |
| I1 | Info | **Localhost-only by design.** The server binds 127.0.0.1 (`index.ts:26`), the Host allow-list holds only local names (`app.ts:50,182-188`), and the Secure cookie works because browsers treat `localhost` as secure. | Production needs an HTTPS terminator, its hostname added to the allow-list, `trust proxy`, and HSTS. Until then it cannot be exposed. | SRC | Deployment work, not a bug. |
| I2 | Info | **The dev-server CSP has no `script-src` or `style-src`** (`security-headers.ts:20-23`), needed for Vite hot reload. | Dev only. The production build uses the strict policy, which is tested. | SRC, AUTO | None. Never serve production with `npm run dev`. |
| I3 | Info | **The Origin check compares host and port, not scheme** (`app.ts:203-207`). | An `https://` origin on the same host and port cannot exist alongside this HTTP server, so it is not exploitable. | LIVE | Optional: compare `new URL(origin).origin` against the expected origin. |
| I4 | Info | **Requests with neither Origin nor Sec-Fetch-Site pass** (`app.ts:200`). | Browsers always send one of them on a POST. Clients that send neither (curl, tests) carry no browser cookie, so this is not CSRF. | LIVE | None. |
| I5 | Info | **Sign-out ends only the current session**, and there is no "sign out everywhere" (`auth.ts:77-79`). Changing a password hash does end all of that account's sessions (`store.ts:48`). | A stolen cookie stays valid on its own device for up to 8 h. | SRC | Optional "sign out of all sessions". |
| I6 | Info | **A locked sign-in answers faster** (5 ms against about 80 ms) because it skips scrypt. | It shows that an email is locked, but unknown emails lock too, so it does not show whether an account exists. | LIVE | None. |
| I7 | Info | **Each sandbox lookup calls PayPal's list GET** (`app.ts:148`). | Read-only. It only affects the sandbox quota. | SRC | Optional short cache. |
| I8 | Info | **`disputes.js` prints the sandbox API response to the terminal** (`disputes.js:42,49`). It never prints the token, and `test.js` prints only the token type and expiry. | Sandbox data on the developer's own console. These are the original scripts, which you asked to keep. | SRC | None. |
| I9 | Info | **The database file is not encrypted.** Its permissions are limited to SYSTEM, Administrators and the user; it holds hashes only, no passwords or tokens. | Anyone with that Windows account can read the hashes and the audit log. | LIVE | Leave it to disk encryption, and back the file up with the WAL files. |
| I10 | Info | **The scrypt cost settings are read from the stored hash** (`auth.ts:36`), and that hash comes from the tracked `demo-accounts.json`. | A bad value in that file could make sign-in slow. Only someone who can edit the file could do this. | SRC | Optional: reject N above 2^17 in `validateAccounts`. |

## 9. Dependency audit

`npm audit --json` was run read-only in the root, `client/` and `server/`. Each reported **0 vulnerabilities** at every severity (info, low, moderate, high, critical), and `npm audit fix` was not run.

- **Server runtime:** one direct dependency, `express@5.3.0`. Everything else is Node 24 built-ins (`node:sqlite`, `node:crypto`).
- **Client:** React 19.3, Vite 8.3, Tailwind 4.3, Radix 1.8, GSAP 3.15, lucide-react, cva, clsx and tailwind-merge. These run only in the browser bundle or at build time.
- **Limit:** the results reflect the advisory database at the time of the run.

## 10. Production readiness

**Ready as a local demo:** yes. Every check passes for the localhost-only setup it was built for.

**Ready to deploy on the internet:** not yet, but no code-level vulnerability blocks it. These deployment steps are needed:

1. Run behind an HTTPS terminator and send HSTS (L3).
2. Add the public hostname to the Host allow-list (I1).
3. Set `trust proxy` (M1).
4. Add a per-account AI limit (L2).
5. Plan data retention and backups (L4).

Serve the production build (`npm run build` / `npm run preview` headers), never `npm run dev`.

## 11. Recommended fixes, in priority order

1. **M1:** make the per-address key the real client address (`trust proxy` at deploy), and optionally let a correct password through the shared cap.
2. **L2:** add a per-account limit on the three Gemini routes.
3. **L3:** add Permissions-Policy now, and HSTS at the HTTPS terminator.
4. **L4:** clean up expired sessions at startup, and document log retention.
5. **L5:** cap the limiter's memory.
6. **L1:** decide between keeping hard lockouts and switching to a growing delay.
7. Optional: I3, I5, I7 and I10.

## 12. Regression risks for the fixes

- **M1 and L1:** changing lockout behaviour must keep the existing limiter tests (`auth.test.ts:143-188`) and the "unknown email takes as long as a wrong password" behaviour. A wrong `trust proxy` setting would let `X-Forwarded-For` spoofing bypass the per-address cap.
- **L2:** a new 429 must reach the user as a plain message in `AnalysisPanel`, `Buyer` and `Intelligence`, and the existing 409 "already in progress" must keep working.
- **L3:** a header change must keep `security-headers.test.ts` passing. A `Permissions-Policy` that is too broad could block nothing useful today, but check the intro video.
- **L4:** session cleanup must not break "a server restart keeps users signed in" (`auth.test.ts:90`). Never delete audit rows, because the triggers abort that.

## 13. Items needing manual verification

- A real HTTPS deployment: headers, the cookie and HSTS behind a proxy. None exists yet.
- Live PayPal and Gemini errors: these are verified only with mocks and source reading.
- A browser-level CSRF attempt from a real second origin. Verified with crafted headers only.
- Behaviour behind an actual reverse proxy, which M1 depends on.
- Running the production build (`npm run preview`) and checking its headers in a browser. Verified by test and source only in this phase.

## 14. Final security verdict

**CONDITIONAL PASS.** There are no Critical or High findings. One Medium (M1, a shared sign-in cap that allows denial of service) and five Low findings remain; all are manageable and none exposes data. Authorization, sessions, CSRF, headers, secrets and the PayPal and Gemini boundaries are sound in the tested scope.

**DisputeDesk is ready for Phase 6.4 remediation.** No fix has been implemented, and approval is needed before any change.
