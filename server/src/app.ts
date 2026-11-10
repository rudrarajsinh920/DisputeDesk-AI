import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import demoAccounts from "../../demo-accounts.json" with { type: "json" };
import extraDemos from "../../demo-disputes.json" with { type: "json" };
import sample from "../../sample-dispute.json" with { type: "json" };
import { readiness } from "../../shared/readiness.ts";
import { CONFIRMABLE, DOCUMENT_LIMITS, DOCUMENT_MEDIA_TYPES } from "../../shared/types.ts";
import type { Dispute, DocumentMediaType, EvidenceChecklist, Role } from "../../shared/types.ts";
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
import { buildChecklist } from "./checklist.ts";
import { analyzeDispute } from "./evidence.ts";
import { AiError } from "./gemini.ts";
import { buildIntelligence, buildIntelligenceAiRequest, composeIntelligenceExplanation, rulesIntelligenceExplanation } from "./intelligence.ts";
import type { GeminiClient } from "./gemini.ts";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";
import { assistWithRefs, withProvenance } from "./provenance.ts";
import { cleanDocumentName, sniffMediaType } from "./documents.ts";
import { createExtractor, type Extractor } from "./extract.ts";
import {
  addDocument,
  audit,
  confirmGap,
  deleteDocument,
  findAccountByEmail,
  getAccount,
  downloadDocument,
  getDocumentPages,
  listAttachments,
  setDocumentLink,
  listAccounts,
  listAudit,
  listConfirmations,
  listDocuments,
  loadDisputes,
  seedDemo,
  withdrawGap,
} from "./store.ts";
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
// Upload attempts per merchant in each sign-in window (15 minutes), counted before the body is read.
export const UPLOAD_MAX_CALLS = 20;

// AI errors become: 429 for rate limits (with Retry-After), 504 for timeouts, 502 for everything else.
const AI_STATUS: Partial<Record<AiError["code"], number>> = { ai_rate_limited: 429, ai_timeout: 504 };

// paypal and ai are null when they are not configured; the server still runs and says so.
// aiOff is the safe reason shown when ai is null.
// db is the server's database (index.ts opens the file); tests get a fresh in-memory one.
// accounts and now are for tests; the server uses the demo accounts and the real clock.
// extractor reads uploaded PDFs (extract.ts); tests pass their own to wait for it or fake the worker.
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
    extractor,
  }: { accounts?: Account[]; now?: () => number; db?: DatabaseSync; trustProxy?: number; extractor?: Extractor } = {},
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
  // Created after seeding; it queues any PDF an earlier run left unread.
  const extraction = extractor ?? createExtractor(db, { now });
  const limiter = createLoginLimiter(now);
  // The sign-in limiter's sliding window, reused: each Gemini call counts against the account that asked for it.
  const aiLimiter = createLoginLimiter(now);
  const aiAllowed = (account: Account) => {
    const key = `ai:${account.id}`;
    if (aiLimiter.blocked([key], AI_MAX_CALLS)) return false;
    aiLimiter.fail([key]);
    return true;
  };
  const uploadLimiter = createLoginLimiter(now);
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
  // lookup defaults to the JSON body; the upload route, whose body is the file, passes its own.
  async function findDispute(req: Request, res: Response, lookup: unknown = req.body): Promise<Dispute | null> {
    const result = validateLookup(lookup);
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

  // The checklist plus the confirmations the account may see: a merchant only their own, admin every account's.
  // Only confirmations of items that are still gaps are returned; one on an item a later record filled, or that the
  // reason no longer lists, is kept but not shown. Sandbox disputes are never stored, so they have none.
  const checklistFor = (dispute: Dispute, account: Account): EvidenceChecklist => {
    const checklist = buildChecklist(dispute, analyzeDispute(dispute));
    const gaps = new Set(checklist.items.filter((i) => CONFIRMABLE.includes(i.status)).map((i) => i.id));
    const onlyAccount = account.role === "admin" ? null : account.id;
    if (dispute.source !== "demo") return { ...checklist, confirmations: [], attachments: [] };
    // Linked documents follow the same rule: shown only on items that are still gaps, never as a record.
    const confirmations = listConfirmations(db, dispute.dispute_id, onlyAccount).filter((c) => gaps.has(c.item_id));
    const attachments = listAttachments(db, dispute.dispute_id, onlyAccount).filter((a) => gaps.has(a.item_id));
    return { ...checklist, confirmations, attachments };
  };

  // Evidence checklist for the dispute's reason, derived from the same analysis. Reading it is not audited.
  app.post("/api/analysis/checklist", requireRole("merchant", "admin"), express.json({ limit: "4kb" }), async (req, res) => {
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    res.json(checklistFor(dispute, signedIn(res)));
  });

  // A merchant records that they hold a record for a gap, or withdraws that. It changes no status, count, draft or
  // AI input: DisputeDesk has not seen the record. Merchants only (admin is read-only), demo disputes only.
  app.post("/api/analysis/checklist/confirm", requireRole("merchant"), express.json({ limit: "1kb" }), async (req, res) => {
    const body = req.body as { source?: unknown; item_id?: unknown; confirmed?: unknown } | undefined;
    if (typeof body?.item_id !== "string" || !/^[a-z_]{1,40}$/.test(body.item_id) || typeof body.confirmed !== "boolean") {
      sendError(res, 400, "invalid_request", "item_id must be a checklist item ID and confirmed must be true or false.");
      return;
    }
    // Checked before any lookup, so a sandbox request never reaches PayPal.
    if (body.source === "paypal_sandbox") {
      sendError(res, 409, "not_confirmable", "Confirmations are kept for demo disputes only. PayPal sandbox disputes are never stored.");
      return;
    }
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const account = signedIn(res);
    const item = buildChecklist(dispute, analyzeDispute(dispute)).items.find((i) => i.id === body.item_id);
    if (body.confirmed) {
      if (!item || !CONFIRMABLE.includes(item.status)) {
        sendError(res, 409, "not_confirmable", "Only a missing item or one not shown by the records can be confirmed.");
        return;
      }
      confirmGap(db, now(), account.id, dispute.dispute_id, item.id);
    } else {
      // Withdrawing is always allowed, so a confirmation on an item that has since changed can still be removed.
      withdrawGap(db, now(), account.id, dispute.dispute_id, body.item_id);
    }
    res.json(checklistFor(dispute, account));
  });

  // ---- Merchant documents (Stage 3). Demo disputes only. DisputeDesk stores the file and has not checked it:
  // no route here changes an evidence status, the readiness counts, the draft or anything sent to Gemini. ----

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const documentsFor = (disputeId: string, account: Account) => listDocuments(db, disputeId, account.role === "admin" ? null : account.id);
  const notForSandbox = (res: Response) =>
    sendError(res, 409, "documents_demo_only", "Documents are kept for demo disputes only. PayPal sandbox disputes are never stored.");

  // A merchant sees their own documents on the dispute; admin sees every account's (read-only). Buyers: 403.
  app.post("/api/documents", requireRole("merchant", "admin"), express.json({ limit: "1kb" }), async (req, res) => {
    // Checked before any lookup, so a sandbox request never reaches PayPal.
    if ((req.body as { source?: unknown } | undefined)?.source === "paypal_sandbox") return notForSandbox(res);
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    res.json({ documents: documentsFor(dispute.dispute_id, signedIn(res)) });
  });

  // The body is the file itself (no multipart). The dispute comes in X-Dispute-Id and the percent-encoded filename
  // in X-Document-Name, so neither ends up in a URL. Merchants only; admin is read-only.
  app.post(
    "/api/documents/upload",
    requireRole("merchant"),
    (req, res, next) => {
      const declared = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!DOCUMENT_MEDIA_TYPES.includes(declared as DocumentMediaType)) {
        sendError(res, 415, "unsupported_media_type", "Upload a PDF, PNG or JPEG file.");
        return;
      }
      const key = `upload:${signedIn(res).id}`;
      if (uploadLimiter.blocked([key], UPLOAD_MAX_CALLS)) {
        res.set("Retry-After", String(LOGIN_WINDOW_MS / 1000));
        sendError(res, 429, "too_many_uploads", "Too many uploads. Try again later.");
        return;
      }
      uploadLimiter.fail([key]);
      next();
    },
    // The dispute is checked before the body is read, so a file for a dispute this merchant can't reach is never
    // buffered. Same 404 and access-denied audit as every other route.
    async (req, res, next) => {
      const disputeId = req.headers["x-dispute-id"];
      const dispute = await findDispute(req, res, { source: "demo", dispute_id: typeof disputeId === "string" ? disputeId : undefined });
      if (!dispute) return;
      res.locals.uploadDispute = dispute;
      next();
    },
    // inflate: false refuses compressed bodies (415): files are sent as they are.
    express.raw({ limit: DOCUMENT_LIMITS.maxBytes, type: () => true, inflate: false }),
    async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) {
        sendError(res, 400, "empty_file", "The file is empty.");
        return;
      }
      const declared = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      // The first bytes decide the type, and they must agree with what the browser declared.
      if (sniffMediaType(bytes) !== declared) {
        sendError(res, 415, "unsupported_media_type", "The file's contents are not a PDF, PNG or JPEG of the declared type.");
        return;
      }
      const dispute = res.locals.uploadDispute as Dispute;
      const account = signedIn(res);
      const result = addDocument(
        db,
        now(),
        {
          id: randomUUID(),
          account_id: account.id,
          dispute_id: dispute.dispute_id,
          display_name: cleanDocumentName(typeof req.headers["x-document-name"] === "string" ? req.headers["x-document-name"] : undefined),
          media_type: declared as DocumentMediaType,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        bytes,
      );
      if (!result.ok) {
        const refusal = {
          too_many: ["too_many_documents", `A dispute can hold at most ${DOCUMENT_LIMITS.perDispute} documents. Delete one first.`],
          account_full: ["storage_full", "Your documents already use the 50 MB allowed per account. Delete one first."],
          duplicate: ["duplicate_document", "This file is already attached to this dispute."],
        }[result.reason];
        sendError(res, 409, refusal[0], refusal[1]);
        return;
      }
      // Read after the answer is sent, in its own worker; the merchant sees "pending" until it is done.
      if (result.document.status === "pending") extraction.enqueue(result.document.id);
      res.status(201).json({ document: result.document, documents: documentsFor(dispute.dispute_id, account) });
    },
  );

  // The text read from one document, page by page: the owner's own, or any (read-only) for admin. Buyers: 403.
  // Another account's document answers 404 exactly like a missing one. The text is untrusted and unverified: it is
  // returned as plain strings for display, and nothing here changes an evidence status or reaches Gemini.
  app.post("/api/documents/pages", requireRole("merchant", "admin"), express.json({ limit: "1kb" }), async (req, res) => {
    const body = req.body as { source?: unknown; document_id?: unknown } | undefined;
    if (typeof body?.document_id !== "string" || !UUID.test(body.document_id)) {
      sendError(res, 400, "invalid_request", "document_id must be a document ID.");
      return;
    }
    if (body.source === "paypal_sandbox") return notForSandbox(res);
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const account = signedIn(res);
    const found = getDocumentPages(db, dispute.dispute_id, body.document_id, account.role === "admin" ? null : account.id);
    if (!found) {
      sendError(res, 404, "document_not_found", "No document with this ID is attached to this dispute.");
      return;
    }
    res.json(found);
  });

  // Deletes the merchant's own document: the file goes with it. Admin is read-only.
  app.post("/api/documents/delete", requireRole("merchant"), express.json({ limit: "1kb" }), async (req, res) => {
    const body = req.body as { source?: unknown; document_id?: unknown } | undefined;
    if (typeof body?.document_id !== "string" || !UUID.test(body.document_id)) {
      sendError(res, 400, "invalid_request", "document_id must be a document ID.");
      return;
    }
    if (body.source === "paypal_sandbox") return notForSandbox(res);
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const account = signedIn(res);
    // Another account's document answers exactly like a missing one.
    if (!deleteDocument(db, now(), account.id, dispute.dispute_id, body.document_id)) {
      sendError(res, 404, "document_not_found", "No document with this ID is attached to this dispute.");
      return;
    }
    // The checklist too: the document's links went with it.
    res.json({ documents: documentsFor(dispute.dispute_id, account), checklist: checklistFor(dispute, account) });
  });

  // Links the merchant's own document to a checklist gap, or removes that link (Stage 3.4). A merchant statement: it
  // changes no evidence status, count, draft or AI input, and DisputeDesk has not checked the document. Merchants
  // only (admin is read-only), demo disputes only. Answers with the document list and the checklist.
  app.post("/api/documents/link", requireRole("merchant"), express.json({ limit: "1kb" }), async (req, res) => {
    const body = req.body as { source?: unknown; document_id?: unknown; item_id?: unknown; linked?: unknown } | undefined;
    if (
      typeof body?.document_id !== "string" ||
      !UUID.test(body.document_id) ||
      typeof body.item_id !== "string" ||
      !/^[a-z_]{1,40}$/.test(body.item_id) ||
      typeof body.linked !== "boolean"
    ) {
      sendError(res, 400, "invalid_request", "document_id must be a document ID, item_id a checklist item ID and linked true or false.");
      return;
    }
    if (body.source === "paypal_sandbox") return notForSandbox(res);
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const account = signedIn(res);
    if (body.linked) {
      const item = buildChecklist(dispute, analyzeDispute(dispute)).items.find((i) => i.id === body.item_id);
      if (!item || !CONFIRMABLE.includes(item.status)) {
        sendError(res, 409, "not_linkable", "A document can be linked only to a missing item or one not shown by the records.");
        return;
      }
    }
    // Unlinking is always allowed, so a link on an item that has since changed can still be removed.
    if (setDocumentLink(db, now(), account.id, dispute.dispute_id, body.document_id, body.item_id, body.linked) === null) {
      sendError(res, 404, "document_not_found", "No document with this ID is attached to this dispute.");
      return;
    }
    res.json({ documents: documentsFor(dispute.dispute_id, account), checklist: checklistFor(dispute, account) });
  });

  // The merchant's own original file, as a download (Stage 3.4). Never shown inline: a fixed type from the allowlist,
  // an attachment disposition, nosniff and a sandboxing CSP, so the browser can't render or run it. Admin can't
  // download originals (it reads metadata and text only); another account's file answers 404 like a missing one.
  app.post("/api/documents/download", requireRole("merchant"), express.json({ limit: "1kb" }), async (req, res) => {
    const body = req.body as { source?: unknown; document_id?: unknown } | undefined;
    if (typeof body?.document_id !== "string" || !UUID.test(body.document_id)) {
      sendError(res, 400, "invalid_request", "document_id must be a document ID.");
      return;
    }
    if (body.source === "paypal_sandbox") return notForSandbox(res);
    const dispute = await findDispute(req, res);
    if (!dispute) return;
    const file = downloadDocument(db, now(), signedIn(res).id, dispute.dispute_id, body.document_id);
    if (!file) {
      sendError(res, 404, "document_not_found", "No document with this ID is attached to this dispute.");
      return;
    }
    const extension = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[file.media_type];
    res.set({
      "Content-Type": file.media_type,
      // An ASCII fallback name, and the cleaned name percent-encoded (RFC 6266): no quote or header injection.
      "Content-Disposition": `attachment; filename="document.${extension}"; filename*=UTF-8''${encodeURIComponent(file.display_name)}`,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      "Cache-Control": "no-store",
    });
    res.send(Buffer.from(file.bytes));
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
    if (bodyError === "encoding.unsupported") {
      res.status(415).json({ error: { code: "unsupported_content_encoding", message: "Send the request body uncompressed.", upstream_status: null } });
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
