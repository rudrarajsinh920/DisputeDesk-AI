import express from "express";
import type { NextFunction, Request, Response } from "express";
import sample from "../../sample-dispute.json" with { type: "json" };
import type { Dispute } from "../../client/src/types.ts";
import { buildAiRequest, composeAiAssist } from "./assist.ts";
import { analyzeDispute } from "./evidence.ts";
import { AiError } from "./gemini.ts";
import type { GeminiClient } from "./gemini.ts";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";
import { validateDispute, validateLookup } from "./validate.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Synthetic demo records, owned by the server and always labeled "demo".
// Built from the same file the client lists, so the two never drift; an invalid fixture stops the server at startup.
export const DEMO_DISPUTES: Dispute[] = [sample].map((record) => {
  const result = validateDispute({ ...record, source: "demo" });
  if (!result.ok) throw new Error(`sample-dispute.json is not a valid dispute: ${result.errors.join(" ")}`);
  return result.dispute;
});

function notConfigured(res: Response) {
  res.status(503).json({
    error: { code: "paypal_not_configured", message: "PayPal sandbox credentials are not set on the server.", upstream_status: null },
  });
}

// AI errors become: 429 for rate limits (with Retry-After), 504 for timeouts, 502 for everything else.
const AI_STATUS: Partial<Record<AiError["code"], number>> = { ai_rate_limited: 429, ai_timeout: 504 };

// paypal and ai are null when their keys are missing; the server still runs and says so.
export function createApp(paypal: PayPalClient | null, ai: GeminiClient | null = null) {
  const app = express();
  app.disable("x-powered-by");
  // shortcut: in-memory, one server process; one AI request per dispute at a time to avoid double cost.
  const aiInFlight = new Set<string>();

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
    if (source === "paypal_sandbox" && !paypal) {
      notConfigured(res);
      return null;
    }
    const records = source === "demo" ? DEMO_DISPUTES : await paypal!.listDisputes();
    const dispute = records.find((d) => d.dispute_id === dispute_id);
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

  // DNS-rebinding guard: another site pointed at 127.0.0.1 still sends its own Host, so only local names pass.
  // Vite's proxy forwards the browser's Host (localhost:5173), which is allowed.
  app.use((req, res, next) => {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (LOCAL_HOSTS.has(hostname)) return next();
    res.status(403).json({
      error: { code: "forbidden_host", message: "DisputeDesk only answers requests addressed to this machine.", upstream_status: null },
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", paypal: { environment: "sandbox", configured: paypal !== null } });
  });

  app.get("/api/sandbox/disputes", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!paypal) return notConfigured(res);
    res.json({ source: "paypal_sandbox", disputes: await paypal.listDisputes() });
  });

  // Sandbox records come from the same read-only list GET as above. Nothing is ever submitted to PayPal.
  app.post("/api/analysis", express.json({ limit: "4kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const dispute = await findDispute(req, res);
    if (dispute) res.json(analyzeDispute(dispute));
  });

  // On demand only. The rules run first; Gemini words their findings; assist.ts checks every line it returns.
  // The result is a draft for merchant review, never sent anywhere.
  app.post("/api/analysis/ai", express.json({ limit: "4kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!ai) {
      res.status(503).json({
        error: { code: "ai_not_configured", message: "AI drafting is off: GEMINI_API_KEY is not set on the server.", upstream_status: null },
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
