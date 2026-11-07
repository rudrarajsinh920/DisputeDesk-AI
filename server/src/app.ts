import { randomBytes } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import demoAccounts from "../../demo-accounts.json" with { type: "json" };
import extraDemos from "../../demo-disputes.json" with { type: "json" };
import sample from "../../sample-dispute.json" with { type: "json" };
import { readiness } from "../../shared/readiness.ts";
import type { Dispute, Role } from "../../shared/types.ts";
import { MAX_CHECK_TEXT, VALIDATION_EXAMPLE_MODEL, buildAiRequest, checkMerchantDraft, composeAiAssist, validationExampleAnswer } from "./assist.ts";
import {
  AI_WORDING_LIMIT,
  AI_WORDING_OFF,
  AI_WORDING_UNAVAILABLE,
  buildBuyerAiRequest,
  buyerGuidance,
  composeBuyerExplanation,
  rulesExplanation,
  toBuyerRecord,
} from "./buyer.ts";
import {
  ABSOLUTE_MS,
  IDLE_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_PER_ADDRESS,
  LOGIN_MAX_FAILURES_PER_EMAIL,
  LOGIN_WINDOW_MS,
  SESSION_COOKIE,
  canAccess,
  clearSessionCookie,
  createLoginLimiter,
  createSessions,
  hashPassword,
  readCookie,
  sessionCookie,
  toAccountInfo,
  validateAccounts,
  verifyPassword,
} from "./auth.ts";
import type { Account } from "./auth.ts";
import { AI_OFF_NO_KEY } from "./config.ts";
import { openDatabase, transaction } from "./db.ts";
import { analyzeDispute } from "./evidence.ts";
import { AiError } from "./gemini.ts";
import { buildIntelligence, buildIntelligenceAiRequest, composeIntelligenceExplanation, rulesIntelligenceExplanation } from "./intelligence.ts";
import type { GeminiClient } from "./gemini.ts";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";
import { assistWithRefs, withProvenance } from "./provenance.ts";
import { audit, findAccountByEmail, getAccount, listAccounts, listAudit, loadDisputes, seedDemo } from "./store.ts";
import { validateDispute, validateLogin, validateLookup } from "./validate.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// The app uses none of these. The page's clipboard copy and intro video autoplay are left alone.
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
// One year. No includeSubDomains or preload: the domain owner decides those at deployment.
export const HSTS = "max-age=31536000";

// Synthetic demo records, owned by the server and always labeled "demo".
// Built from the same file the client lists, so the two never drift; an invalid fixture stops the server at startup.
export const DEMO_DISPUTES: Dispute[] = [sample, ...extraDemos].map((record) => {
  const result = validateDispute({ ...record, source: "demo" });
  if (!result.ok) throw new Error(`Demo record ${String(record.dispute_id)} is not a valid dispute: ${result.errors.join(" ")}`);
  return result.dispute;
});

// Synthetic demo accounts (hashes only). An invalid entry stops the server at startup.
export const DEMO_ACCOUNTS = demoAccounts.accounts as Account[];
const accountErrors = validateAccounts(DEMO_ACCOUNTS, DEMO_DISPUTES.map((d) => d.dispute_id));
if (accountErrors.length > 0) throw new Error(`demo-accounts.json is not valid: ${accountErrors.join(" ")}`);

const sendError = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message, upstream_status: null } });

const hasSandboxAccess = (account: Account) => account.role === "admin" || (account.role === "merchant" && account.paypal_sandbox);

// The buyer view leaves out the merchant's order, evidence and message records; guidance is built from what is left.
const buyerView = (d: Dispute) => {
  const record = toBuyerRecord(d);
  return { ...record, guidance: buyerGuidance(record) };
};

function notConfigured(res: Response) {
  res.status(503).json({
    error: { code: "paypal_not_configured", message: "PayPal sandbox credentials are not set on the server.", upstream_status: null },
  });
}

// Gemini calls per account in each sign-in window (15 minutes), across drafts, buyer and insights explanations.
// A cost guard: past it, drafts answer 429 and explanations fall back to the standard wording.
export const AI_MAX_CALLS = 20;

// AI errors become: 429 for rate limits (with Retry-After), 504 for timeouts, 502 for everything else.
const AI_STATUS: Partial<Record<AiError["code"], number>> = { ai_rate_limited: 429, ai_timeout: 504 };

// paypal and ai are null when they are not configured; the server still runs and says so.
// aiOff is the safe reason shown when ai is null.
// db is the server's database (index.ts opens the file); tests get a fresh in-memory one.
// accounts and now are for tests; the server uses the demo accounts and the real clock.
// The demo accounts and disputes are copied into db on every start (seedDemo).
export function createApp(
  paypal: PayPalClient | null,
  ai: GeminiClient | null = null,
  aiOff: string = AI_OFF_NO_KEY,
  {
    accounts = DEMO_ACCOUNTS,
    now = Date.now,
    db = openDatabase(":memory:"),
    trustProxy = 0,
  }: { accounts?: Account[]; now?: () => number; db?: DatabaseSync; trustProxy?: number } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  // Behind trusted proxies req.ip is the client from X-Forwarded-For, so one client's failures can't lock out everyone.
  if (trustProxy > 0) app.set("trust proxy", trustProxy);
  // shortcut: in-memory, one server process; one AI request per dispute at a time to avoid double cost.
  const aiInFlight = new Set<string>();
  seedDemo(db, accounts, DEMO_DISPUTES, now());
  const sessions = createSessions(db, now);
  // Signed-out and expired sessions from earlier runs are cleared at start; live ones stay signed in.
  sessions.prune();
  const limiter = createLoginLimiter(now);
  // The sign-in limiter's sliding window, reused: each Gemini call counts against the account that asked for it.
  const aiLimiter = createLoginLimiter(now);
  const aiAllowed = (account: Account) => {
    const key = `ai:${account.id}`;
    if (aiLimiter.blocked([key], AI_MAX_CALLS)) return false;
    aiLimiter.fail([key]);
    return true;
  };
  // Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
  const dummyHash = hashPassword(randomBytes(16).toString("hex"));

  // The account always comes from the server's session store, never from the request.
  const signedIn = (res: Response) => res.locals.account as Account;
  const requireRole =
    (...roles: Role[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store");
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const accountId = token ? sessions.get(token) : null;
      const account = accountId ? getAccount(db, accountId) : null;
      if (!account) {
        if (token) res.set("Set-Cookie", clearSessionCookie());
        sendError(res, 401, "not_signed_in", "Sign in to continue.");
        return;
      }
      if (!roles.includes(account.role)) {
        sendError(res, 403, "forbidden", "Your account can't use this.");
        return;
      }
      res.locals.account = account;
      next();
    };

  // The caller names a record; the server loads it, so the source label and every field come from the server.
  // Sends the error response itself and returns null when the record can't be used.
  async function findDispute(req: Request, res: Response): Promise<Dispute | null> {
    const result = validateLookup(req.body);
    if (!result.ok) {
      res.status(400).json({
        error: { code: "invalid_request", message: "The analysis request is not valid.", details: result.errors, upstream_status: null },
      });
      return null;
    }
    const { source, dispute_id } = result.lookup;
    const account = signedIn(res);
    if (source === "paypal_sandbox" && !hasSandboxAccess(account)) {
      sendError(res, 403, "forbidden", "Your account has no access to the PayPal sandbox.");
      return null;
    }
    if (source === "paypal_sandbox" && !paypal) {
      notConfigured(res);
      return null;
    }
    const records = source === "demo" ? loadDisputes(db) : await paypal!.listDisputes();
    // Someone else's dispute looks exactly like a missing one, so IDs can't be probed. The attempt is audited.
    const match = records.find((d) => d.dispute_id === dispute_id);
    const dispute = match && canAccess(account, match) ? match : undefined;
    if (match && !dispute) audit(db, now(), "dispute_access_denied", { account_id: account.id, dispute_id, detail: source });
    // A sandbox dispute is analysed from its full PayPal record, read only after the account is cleared to see it.
    if (dispute && source === "paypal_sandbox") return { ...dispute, ...(await paypal!.getDisputeDetails(dispute.dispute_id)) };
    if (!dispute) {
      res.status(404).json({
        error: {
          code: "dispute_not_found",
          message: source === "demo" ? "No demo dispute has this ID." : "The PayPal sandbox has no dispute with this ID.",
          upstream_status: null,
        },
      });
      return null;
    }
    return dispute;
  }

  // The API only returns JSON: nothing in it may run, be framed or be read by another site.
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Permissions-Policy": PERMISSIONS_POLICY,
    });
    // Only over HTTPS: req.secure is true behind a trusted proxy that reports https, never on local HTTP.
    if (req.secure) res.set("Strict-Transport-Security", HSTS);
    next();
  });

  // DNS-rebinding guard: another site pointed at 127.0.0.1 still sends its own Host, so only local names pass.
  // Vite's proxy forwards the browser's Host (localhost:5173, changeOrigin: false in vite.config.ts), which is allowed.
  app.use((req, res, next) => {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (LOCAL_HOSTS.has(hostname)) return next();
    res.status(403).json({
      error: { code: "forbidden_host", message: "DisputeDesk only answers requests addressed to this machine.", upstream_status: null },
    });
  });

  // Cross-site guard on top of SameSite=Strict: browsers send Origin on every POST, and it must match the Host
  // the page was loaded from. Browsers also label every request with Sec-Fetch-Site; anything not from this exact
  // origin is refused even if Origin is missing. Clients that send neither (tests, curl) carry no browser cookies to abuse.
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const site = req.headers["sec-fetch-site"];
    if (site === "cross-site" || site === "same-site") {
      sendError(res, 403, "forbidden_origin", "Requests must come from the DisputeDesk page itself.");
      return;
    }
    if (req.headers.origin === undefined) return next();
    let host = "";
    try {
      host = new URL(req.headers.origin).host.toLowerCase();
    } catch {
      // "null" or a malformed Origin is refused below.
    }
    if (host !== "" && host === (req.headers.host ?? "").toLowerCase()) return next();
    sendError(res, 403, "forbidden_origin", "Requests must come from the DisputeDesk page itself.");
  });

  app.post("/api/auth/login", express.json({ limit: "1kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = validateLogin(req.body);
    if (!result.ok) {
      res.status(400).json({
        error: { code: "invalid_request", message: "The sign-in request is not valid.", details: result.errors, upstream_status: null },
      });
      return;
    }
    // Known and unknown emails are counted and answered the same way, so a lockout says nothing about whether an account exists.
    const emailKey = `email:${result.email}`;
    const addressKey = `ip:${req.ip}`;
    const pairKey = `${emailKey}|${addressKey}`;
    const account = findAccountByEmail(db, result.email);
    // Unknown emails are never written to the audit log; only known account IDs are.
    if (
      limiter.blocked([pairKey]) ||
      limiter.blocked([emailKey], LOGIN_MAX_FAILURES_PER_EMAIL) ||
      limiter.blocked([addressKey], LOGIN_MAX_FAILURES_PER_ADDRESS)
    ) {
      audit(db, now(), "login_locked", { account_id: account?.id ?? null });
      res.set("Retry-After", String(LOGIN_WINDOW_MS / 1000));
      sendError(res, 429, "too_many_attempts", "Too many failed sign-in attempts. Try again in 15 minutes.");
      return;
    }
    // Counted before the slow password check, so requests sent at the same moment can't all slip under the limit.
    limiter.fail([pairKey, emailKey, addressKey]);
    const valid = await verifyPassword(result.password, account?.password_hash ?? (await dummyHash));
    if (!account || !valid) {
      audit(db, now(), "login_failed", { account_id: account?.id ?? null });
      sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
      return;
    }
    limiter.forgive([emailKey, addressKey]);
    limiter.reset(pairKey);
    // A new token on every sign-in; any session the browser already had is ended.
    const previous = readCookie(req.headers.cookie, SESSION_COOKIE);
    const token = transaction(db, () => {
      if (previous) sessions.delete(previous);
      audit(db, now(), "login_succeeded", { account_id: account.id });
      return sessions.create(account.id);
    });
    res.set("Set-Cookie", sessionCookie(token));
    res.json({ account: toAccountInfo(account) });
  });

  // Works with or without a valid session, so the browser can always clear its cookie.
  app.post("/api/auth/logout", (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const accountId = sessions.get(token);
      transaction(db, () => {
        sessions.delete(token);
        if (accountId) audit(db, now(), "logout", { account_id: accountId });
      });
    }
    res.set("Cache-Control", "no-store");
    res.set("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });

  app.get("/api/auth/me", requireRole("merchant", "buyer", "admin"), (_req, res) => {
    res.json({ account: toAccountInfo(signedIn(res)) });
  });

  // Merchants get the demo disputes on their account; admin gets all of them.
  app.get("/api/disputes", requireRole("merchant", "admin"), (_req, res) => {
    const account = signedIn(res);
    const disputes = loadDisputes(db).filter((d) => canAccess(account, d));
    // Counts from the rules for each listed dispute, keyed by ID. Not a score. Sandbox lists have no evidence detail, so none.
    res.json({ source: "demo", disputes, readiness: Object.fromEntries(disputes.map((d) => [d.dispute_id, readiness(analyzeDispute(d))])) });
  });

  app.get("/api/buyer/disputes", requireRole("buyer"), (_req, res) => {
    const account = signedIn(res);
    res.json({ source: "demo", disputes: loadDisputes(db).filter((d) => canAccess(account, d)).map(buyerView) });
  });

  // Buyers only, on their own disputes. The rules' guidance is always the answer; Gemini may only reword it, and
  // every paragraph is checked. AI off, failing or flagged gives the standard explanation, labelled so.
  app.post("/api/buyer/explain", requireRole("buyer"), express.json({ limit: "4kb" }), async (req, res) => {
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const record = toBuyerRecord(dispute);
    const guidance = buyerGuidance(record);
    let result = rulesExplanation(record, guidance, AI_WORDING_OFF);
    if (ai) {
      const key = `buyer:${dispute.source}:${dispute.dispute_id}`;
      if (aiInFlight.has(key)) {
        res.status(409).json({
          error: { code: "ai_in_progress", message: "An explanation for this dispute is already being written.", upstream_status: null },
        });
        return;
      }
      aiInFlight.add(key);
      try {
        result = aiAllowed(signedIn(res))
          ? composeBuyerExplanation(record, guidance, await ai.generateJson(buildBuyerAiRequest(record, guidance)), ai.model)
          : rulesExplanation(record, guidance, AI_WORDING_LIMIT);
      } catch (error) {
        if (!(error instanceof AiError)) throw error;
        console.error(`Gemini request failed: ${error.code}${error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ""}`);
        result = rulesExplanation(record, guidance, AI_WORDING_UNAVAILABLE);
      } finally {
        aiInFlight.delete(key);
      }
    }
    const detail = result.origin === "ai" ? `ai, ${result.model}` : "rules";
    audit(db, now(), "buyer_explanation_generated", { account_id: signedIn(res).id, dispute_id: dispute.dispute_id, detail });
    res.json(result);
  });

  // Insights for the signed-in merchant's own demo disputes; admin reads all of them. Built on the server from the
  // account's access rows, so no request field can widen it. PayPal sandbox disputes are never included.
  const insightsFor = (account: Account) =>
    buildIntelligence(loadDisputes(db).filter((d) => canAccess(account, d)), now(), account.role === "admin" ? "all" : "account");

  app.get("/api/intelligence", requireRole("merchant", "admin"), (_req, res) => {
    const account = signedIn(res);
    const insights = insightsFor(account);
    audit(db, now(), "intelligence_viewed", { account_id: account.id, detail: `${insights.scope}, ${insights.total} demo disputes` });
    res.json(insights);
  });

  // Merchants only, like AI drafts. Gemini may only reword what the rules found, and every paragraph is checked.
  app.post("/api/intelligence/explain", requireRole("merchant"), async (_req, res) => {
    const account = signedIn(res);
    const insights = insightsFor(account);
    let result = rulesIntelligenceExplanation(insights, AI_WORDING_OFF);
    if (ai) {
      const key = `insights:${account.id}`;
      if (aiInFlight.has(key)) {
        res.status(409).json({
          error: { code: "ai_in_progress", message: "An explanation is already being written.", upstream_status: null },
        });
        return;
      }
      aiInFlight.add(key);
      try {
        result = aiAllowed(account)
          ? composeIntelligenceExplanation(insights, await ai.generateJson(buildIntelligenceAiRequest(insights)), ai.model)
          : rulesIntelligenceExplanation(insights, AI_WORDING_LIMIT);
      } catch (error) {
        if (!(error instanceof AiError)) throw error;
        console.error(`Gemini request failed: ${error.code}${error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ""}`);
        result = rulesIntelligenceExplanation(insights, AI_WORDING_UNAVAILABLE);
      } finally {
        aiInFlight.delete(key);
      }
    }
    const detail = result.origin === "ai" ? `ai, ${result.model}` : "rules";
    audit(db, now(), "intelligence_explanation_generated", { account_id: account.id, detail });
    res.json(result);
  });

  // Read-only: admin can list accounts but nothing changes them. Password hashes never leave the server.
  app.get("/api/admin/accounts", requireRole("admin"), (_req, res) => {
    res.json({ accounts: listAccounts(db).map((a) => ({ ...toAccountInfo(a), dispute_ids: a.dispute_ids })) });
  });

  // Read-only: the latest audit entries, newest first. The log itself can never be changed or deleted.
  app.get("/api/admin/audit", requireRole("admin"), (_req, res) => {
    res.json({ entries: listAudit(db) });
  });

  // Read-only: the limits this server runs with. Nothing here can be changed from the browser, and no secrets are named.
  app.get("/api/admin/settings", requireRole("admin"), (_req, res) => {
    res.json({
      session: { idle_minutes: IDLE_MS / 60_000, absolute_hours: ABSOLUTE_MS / 3_600_000 },
      sign_in: {
        max_failures: LOGIN_MAX_FAILURES,
        max_failures_per_email: LOGIN_MAX_FAILURES_PER_EMAIL,
        max_failures_per_address: LOGIN_MAX_FAILURES_PER_ADDRESS,
        window_minutes: LOGIN_WINDOW_MS / 60_000,
      },
      paypal: { environment: "sandbox", configured: paypal !== null, access: "read-only" },
      ai: ai ? { configured: true, model: ai.model, reason: null } : { configured: false, model: null, reason: aiOff },
      audit: { append_only: true, shown: 200 },
    });
  });

  // Signed in only: it names the AI model and says why AI or PayPal is off. Buyers never need it.
  app.get("/api/health", requireRole("merchant", "admin"), (_req, res) => {
    res.json({
      status: "ok",
      paypal: { environment: "sandbox", configured: paypal !== null },
      ai: ai ? { configured: true, model: ai.model, reason: null } : { configured: false, model: null, reason: aiOff },
    });
  });

  app.get("/api/sandbox/disputes", requireRole("merchant", "admin"), async (_req, res) => {
    if (!hasSandboxAccess(signedIn(res))) return sendError(res, 403, "forbidden", "Your account has no access to the PayPal sandbox.");
    if (!paypal) return notConfigured(res);
    res.json({ source: "paypal_sandbox", disputes: await paypal.listDisputes() });
  });

  // Sandbox records come from the same read-only list GET as above. Nothing is ever submitted to PayPal.
  app.post("/api/analysis", requireRole("merchant", "admin"), express.json({ limit: "4kb" }), async (req, res) => {
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    audit(db, now(), "analysis_viewed", { account_id: signedIn(res).id, dispute_id: dispute.dispute_id, detail: dispute.source });
    // Provenance is derived from the same analysis and only adds keys; statuses, counts and draft text are untouched.
    res.json(withProvenance(dispute, analyzeDispute(dispute)));
  });

  // On demand only. The rules run first; Gemini words their findings; assist.ts checks every line it returns.
  // The result is a draft for merchant review, never sent anywhere.
  // Merchants only: admin is read-only, and a draft is the merchant's own response.
  app.post("/api/analysis/ai", requireRole("merchant"), express.json({ limit: "4kb" }), async (req, res) => {
    if (!ai) {
      res.status(503).json({
        error: { code: "ai_not_configured", message: `AI drafting is off: ${aiOff}`, upstream_status: null },
      });
      return;
    }
    const dispute = await findDispute(req, res);
    if (!dispute) return;

    const key = `${dispute.source}:${dispute.dispute_id}`;
    if (aiInFlight.has(key)) {
      res.status(409).json({
        error: { code: "ai_in_progress", message: "An AI draft for this dispute is already being written.", upstream_status: null },
      });
      return;
    }
    if (!aiAllowed(signedIn(res))) {
      res.set("Retry-After", String(LOGIN_WINDOW_MS / 1000));
      sendError(res, 429, "ai_limit_reached", `Your account has used its ${AI_MAX_CALLS} AI requests for now. Try again in 15 minutes. The rule-based draft still works.`);
      return;
    }
    aiInFlight.add(key);
    try {
      const analysis = analyzeDispute(dispute);
      const { request, facts } = buildAiRequest(dispute, analysis);
      const raw = await ai.generateJson(request);
      // Refs are added after Gemini answers; the request above carries only R ids.
      const result = assistWithRefs(dispute, composeAiAssist(dispute, analysis, facts, raw, ai.model));
      audit(db, now(), "ai_draft_generated", { account_id: signedIn(res).id, dispute_id: dispute.dispute_id, detail: `${dispute.source}, ${ai.model}` });
      res.json(result);
    } finally {
      aiInFlight.delete(key);
    }
  });

  // Shows what the checks catch: a fixed, deliberately wrong answer goes through the same checks as Gemini's.
  // Never calls Gemini, so it works with AI drafting off; the result's model label says it is not Gemini.
  app.post("/api/analysis/ai/example", requireRole("merchant", "admin"), express.json({ limit: "4kb" }), async (req, res) => {
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const analysis = analyzeDispute(dispute);
    const { facts } = buildAiRequest(dispute, analysis);
    audit(db, now(), "ai_example_viewed", { account_id: signedIn(res).id, dispute_id: dispute.dispute_id, detail: dispute.source });
    res.json(assistWithRefs(dispute, composeAiAssist(dispute, analysis, facts, validationExampleAnswer(analysis, facts), VALIDATION_EXAMPLE_MODEL)));
  });

  // The merchant's own edits, run through the same checks as AI text. Advisory: nothing is removed, stored or audited,
  // and Gemini is never called. Merchants only, like the drafts themselves.
  // 64kb: room for MAX_CHECK_TEXT characters in any script once JSON-escaped, so the length check below answers, not a 413.
  app.post("/api/analysis/check", requireRole("merchant"), express.json({ limit: "64kb" }), async (req, res) => {
    const text = (req.body as { text?: unknown } | undefined)?.text;
    if (typeof text !== "string") {
      sendError(res, 400, "invalid_request", "text must be a string.");
      return;
    }
    if (text.length > MAX_CHECK_TEXT) {
      sendError(res, 400, "text_too_long", `This draft is too long to check. Shorten it to ${MAX_CHECK_TEXT.toLocaleString("en-US")} characters or fewer.`);
      return;
    }
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    res.json(checkMerchantDraft(dispute, analyzeDispute(dispute), text));
  });

  app.use("/api", (_req, res) => {
    sendError(res, 404, "not_found", "There is no such DisputeDesk API route.");
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const bodyError = typeof error === "object" && error !== null ? (error as { type?: unknown }).type : undefined;
    if (bodyError === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "The request body is not valid JSON.", upstream_status: null } });
      return;
    }
    if (bodyError === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "The request body is too large.", upstream_status: null } });
      return;
    }
    if (error instanceof AiError) {
      console.error(`Gemini request failed: ${error.code}${error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ""}`);
      if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
      res.status(AI_STATUS[error.code] ?? 502).json({
        error: { code: error.code, message: error.message, upstream_status: error.upstreamStatus },
      });
      return;
    }
    if (error instanceof PayPalError) {
      console.error(`PayPal request failed: ${error.code}${error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ""}`);
      res.status(502).json({
        error: { code: error.code, message: error.message, upstream_status: error.upstreamStatus },
      });
      return;
    }
    console.error("Unexpected server error:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error.", upstream_status: null } });
  });

  return app;
}
