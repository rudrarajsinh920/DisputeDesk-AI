import express from "express";
import type { NextFunction, Request, Response } from "express";
import { analyzeDispute } from "./evidence.ts";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";
import { validateDispute } from "./validate.ts";

// paypal is null when credentials are missing; the server still runs and says so.
export function createApp(paypal: PayPalClient | null) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", paypal: { environment: "sandbox", configured: paypal !== null } });
  });

  app.get("/api/sandbox/disputes", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!paypal) {
      res.status(503).json({
        error: {
          code: "paypal_not_configured",
          message: "PayPal sandbox credentials are not set on the server.",
          upstream_status: null,
        },
      });
      return;
    }
    res.json({ source: "paypal_sandbox", disputes: await paypal.listDisputes() });
  });

  // Analyzes only the record it is given; never calls PayPal and never submits anything.
  app.post("/api/analysis", express.json({ limit: "32kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = validateDispute(req.body);
    if (!result.ok) {
      res.status(400).json({
        error: { code: "invalid_dispute", message: "The dispute record is not valid.", details: result.errors, upstream_status: null },
      });
      return;
    }
    res.json(analyzeDispute(result.dispute));
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
