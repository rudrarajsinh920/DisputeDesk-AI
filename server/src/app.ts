import { randomBytes } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import demoAccounts from "../../demo-accounts.json" with { type: "json" };
import extraDemos from "../../demo-disputes.json" with { type: "json" };
import sample from "../../sample-dispute.json" with { type: "json" };
import type { Dispute, Role } from "../../shared/types.ts";
import { VALIDATION_EXAMPLE_MODEL, buildAiRequest, composeAiAssist, validationExampleAnswer } from "./assist.ts";
import {
  LOGIN_MAX_FAILURES_PER_ADDRESS,
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
import { analyzeDispute } from "./evidence.ts";
import { AiError } from "./gemini.ts";
import type { GeminiClient } from "./gemini.ts";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";
import { validateDispute, validateLogin, validateLookup } from "./validate.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

// The buyer view leaves out the merchant's order and evidence records.
const buyerView = ({ source, dispute_id, reason, status, amount, create_time }: Dispute) => ({
  source,
  dispute_id,
  reason,
  status,
  amount,
  create_time,
});

function notConfigured(res: Response) {
  res.status(503).json({
    error: { code: "paypal_not_configured", message: "PayPal sandbox credentials are not set on the server.", upstream_status: null },
  });
}

// AI errors become: 429 for rate limits (with Retry-After), 504 for timeouts, 502 for everything else.
const AI_STATUS: Partial<Record<AiError["code"], number>> = { ai_rate_limited: 429, ai_timeout: 504 };

// paypal and ai are null when they are not configured; the server still runs and says so.
// aiOff is the safe reason shown when ai is null.
// accounts and now are for tests; the server uses the demo accounts and the real clock.
export function createApp(
  paypal: PayPalClient | null,
  ai: GeminiClient | null = null,
  aiOff: string = AI_OFF_NO_KEY,
  { accounts = DEMO_ACCOUNTS, now = Date.now }: { accounts?: Account[]; now?: () => number } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  // shortcut: in-memory, one server process; one AI request per dispute at a time to avoid double cost.
  const aiInFlight = new Set<string>();
  const sessions = createSessions(now);
  const limiter = createLoginLimiter(now);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  // Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
  const dummyHash = hashPassword(randomBytes(16).toString("hex"));

  // The account always comes from the server's session store, never from the request.
  const signedIn = (res: Response) => res.locals.account as Account;
  const requireRole =
    (...roles: Role[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store");
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const account = token ? accountsById.get(sessions.get(token) ?? "") : undefined;
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
    const records = source === "demo" ? DEMO_DISPUTES : await paypal!.listDisputes();
    // Someone else's dispute looks exactly like a missing one, so IDs can't be probed.
    const dispute = records.find((d) => d.dispute_id === dispute_id && canAccess(account, d));
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
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
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
    const keys = [`email:${result.email}`, `ip:${req.ip}`];
    if (limiter.blocked([keys[0]]) || limiter.blocked([keys[1]], LOGIN_MAX_FAILURES_PER_ADDRESS)) {
      res.set("Retry-After", String(LOGIN_WINDOW_MS / 1000));
      sendError(res, 429, "too_many_attempts", "Too many failed sign-in attempts. Try again in 15 minutes.");
      return;
    }
    const account = accounts.find((a) => a.email === result.email);
    const valid = await verifyPassword(result.password, account?.password_hash ?? (await dummyHash));
    if (!account || !valid) {
      limiter.fail(keys);
      sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
      return;
    }
    limiter.reset(keys[0]);
    // A new token on every sign-in; any session the browser already had is ended.
    const previous = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (previous) sessions.delete(previous);
    res.set("Set-Cookie", sessionCookie(sessions.create(account.id)));
    res.json({ account: toAccountInfo(account) });
  });

  // Works with or without a valid session, so the browser can always clear its cookie.
  app.post("/api/auth/logout", (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) sessions.delete(token);
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
    res.json({ source: "demo", disputes: DEMO_DISPUTES.filter((d) => canAccess(account, d)) });
  });

  app.get("/api/buyer/disputes", requireRole("buyer"), (_req, res) => {
    const account = signedIn(res);
    res.json({ source: "demo", disputes: DEMO_DISPUTES.filter((d) => canAccess(account, d)).map(buyerView) });
  });

  // Read-only: admin can list accounts but nothing changes them. Password hashes never leave the server.
  app.get("/api/admin/accounts", requireRole("admin"), (_req, res) => {
    res.json({ accounts: accounts.map((a) => ({ ...toAccountInfo(a), dispute_ids: a.dispute_ids })) });
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
    if (dispute) res.json(analyzeDispute(dispute));
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
    aiInFlight.add(key);
    try {
      const analysis = analyzeDispute(dispute);
      const { request, facts } = buildAiRequest(dispute, analysis);
      const raw = await ai.generateJson(request);
      res.json(composeAiAssist(dispute, analysis, facts, raw, ai.model));
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
    res.json(composeAiAssist(dispute, analysis, facts, validationExampleAnswer(analysis, facts), VALIDATION_EXAMPLE_MODEL));
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
