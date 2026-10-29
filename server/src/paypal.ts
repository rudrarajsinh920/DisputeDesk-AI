import type { Dispute } from "../../client/src/types.ts";

// Sandbox only, on purpose: there is no setting that points this at live PayPal.
export const PAYPAL_SANDBOX_URL = "https://api-m.sandbox.paypal.com";
const TIMEOUT_MS = 10_000;

export type PayPalErrorCode = "paypal_auth_failed" | "paypal_unreachable" | "paypal_error" | "paypal_bad_response";

export class PayPalError extends Error {
  readonly code: PayPalErrorCode;
  readonly upstreamStatus: number | null;

  constructor(code: PayPalErrorCode, message: string, upstreamStatus: number | null = null) {
    super(message);
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

// Read-only: only the token request (POST) and GET requests are ever sent.
export function createPayPalClient(
  credentials: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
) {
  // shortcut: two requests at the same moment may each fetch a token; fine for one user, dedupe if traffic grows.
  let token: { value: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; body: unknown }> {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PayPalError("paypal_unreachable", "Could not reach the PayPal sandbox.");
    }
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, ok: response.ok, body };
  }

  async function getToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;

    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
    const res = await send(`${PAYPAL_SANDBOX_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (res.status === 401 || res.status === 403) {
      throw new PayPalError("paypal_auth_failed", "PayPal sandbox rejected the server's credentials.", res.status);
    }
    if (!res.ok) throw new PayPalError("paypal_error", "PayPal sandbox sign-in failed.", res.status);

    const body = res.body as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (typeof body?.access_token !== "string") {
      throw new PayPalError("paypal_bad_response", "PayPal sandbox sent an unexpected sign-in response.");
    }
    const lifetime = typeof body.expires_in === "number" ? body.expires_in : 0;
    // Renew a minute early so a token never expires mid-request.
    token = { value: body.access_token, expiresAt: Date.now() + Math.max(0, lifetime - 60) * 1000 };
    return token.value;
  }

  // shortcut: first page only (up to 50 disputes); follow the "next" link once accounts hold more.
  async function listDisputes(): Promise<Dispute[]> {
    const accessToken = await getToken();
    const res = await send(`${PAYPAL_SANDBOX_URL}/v1/customer/disputes?page_size=50`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (res.status === 401) {
      token = null;
      throw new PayPalError("paypal_auth_failed", "PayPal sandbox rejected the access token.", 401);
    }
    if (!res.ok) throw new PayPalError("paypal_error", `PayPal sandbox answered HTTP ${res.status}.`, res.status);

    if (typeof res.body !== "object" || res.body === null) {
      throw new PayPalError("paypal_bad_response", "PayPal sandbox sent an unexpected dispute list.");
    }
    const items = (res.body as { items?: unknown }).items;
    if (items === undefined) return [];
    if (!Array.isArray(items)) {
      throw new PayPalError("paypal_bad_response", "PayPal sandbox sent an unexpected dispute list.");
    }
    return items.map(normalizeDispute);
  }

  return { listDisputes };
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// Copies only the fields the UI shows, so raw PayPal data never reaches the browser.
export function normalizeDispute(raw: unknown): Dispute {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = text(d.dispute_id);
  if (!id) throw new PayPalError("paypal_bad_response", "PayPal sandbox sent a dispute without an ID.");
  const amount = (d.dispute_amount ?? {}) as Record<string, unknown>;
  const currency = text(amount.currency_code);
  const value = text(amount.value);
  return {
    source: "paypal_sandbox",
    dispute_id: id,
    reason: text(d.reason) ?? "UNKNOWN",
    status: text(d.status) ?? "UNKNOWN",
    amount: currency && value ? { currency_code: currency, value } : null,
    create_time: text(d.create_time),
  };
}
