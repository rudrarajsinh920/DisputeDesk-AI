import express from "express";
import type { NextFunction, Request, Response } from "express";
import { PayPalError } from "./paypal.ts";
import type { PayPalClient } from "./paypal.ts";

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

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
