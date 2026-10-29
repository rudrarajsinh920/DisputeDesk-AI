import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { createPayPalClient } from "./paypal.ts";

// Placeholder values only; nothing here talks to PayPal.
const CREDENTIALS = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const TOKEN = "test-access-token";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = () => Response | Promise<Response>;

function mockPayPal(handlers: { token?: Handler; disputes?: Handler } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url });
    if (url.endsWith("/v1/oauth2/token")) {
      return handlers.token ? handlers.token() : json(200, { access_token: TOKEN, token_type: "Bearer", expires_in: 32400 });
    }
    if (url.includes("/v1/customer/disputes")) return handlers.disputes ? handlers.disputes() : json(200, { items: [] });
    throw new Error(`Unexpected URL in test: ${url}`);
  }) as typeof fetch;
  return { client: createPayPalClient(CREDENTIALS, fetchImpl), calls };
}

async function get(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, init);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) };
  } finally {
    server.close();
  }
}

// fetch can't set Host, so this sends a raw request the way a DNS-rebinding page would.
async function getWithHost(app: ReturnType<typeof createApp>, path: string, host: string) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    return await new Promise<{ status: number; text: string }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        })
        .on("error", reject);
    });
  } finally {
    server.close();
  }
}

function assertNoSecrets(text: string) {
  for (const secret of [TOKEN, CREDENTIALS.clientId, CREDENTIALS.clientSecret]) {
    assert.ok(!text.includes(secret), `response leaked "${secret}"`);
  }
}

test("health reports configured state without secrets", async () => {
  const configured = await get(createApp(mockPayPal().client), "/api/health");
  assert.deepEqual(configured.body, { status: "ok", paypal: { environment: "sandbox", configured: true } });
  assertNoSecrets(configured.text);

  const missing = await get(createApp(null), "/api/health");
  assert.equal(missing.body.paypal.configured, false);
});

test("lists sandbox disputes with only whitelisted fields", async () => {
  const { client } = mockPayPal({
    disputes: () =>
      json(200, {
        items: [
          {
            dispute_id: "PP-D-1",
            reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            status: "OPEN",
            dispute_amount: { currency_code: "USD", value: "12.50" },
            create_time: "2026-10-01T10:00:00.000Z",
            links: [{ href: "https://example.invalid", rel: "self" }],
            buyer_email: "should-not-pass-through@example.invalid",
          },
          { dispute_id: "PP-D-2", status: "RESOLVED" },
        ],
      }),
  });
  const res = await get(createApp(client), "/api/sandbox/disputes");

  assert.equal(res.status, 200);
  assert.equal(res.body.source, "paypal_sandbox");
  assert.deepEqual(res.body.disputes, [
    {
      source: "paypal_sandbox",
      dispute_id: "PP-D-1",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "OPEN",
      amount: { currency_code: "USD", value: "12.50" },
      create_time: "2026-10-01T10:00:00.000Z",
    },
    { source: "paypal_sandbox", dispute_id: "PP-D-2", reason: "UNKNOWN", status: "RESOLVED", amount: null },
  ]);
  assertNoSecrets(res.text);
  assert.ok(!res.text.includes("buyer_email"));
});

test("empty sandbox returns an empty list, not an error", async () => {
  const res = await get(createApp(mockPayPal().client), "/api/sandbox/disputes");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { source: "paypal_sandbox", disputes: [] });

  const noItemsField = await get(createApp(mockPayPal({ disputes: () => json(200, { links: [] }) }).client), "/api/sandbox/disputes");
  assert.deepEqual(noItemsField.body.disputes, []);
});

test("rejected credentials become a clear auth error", async () => {
  const { client } = mockPayPal({ token: () => json(401, { error: "invalid_client", error_description: "Client Authentication failed" }) });
  const res = await get(createApp(client), "/api/sandbox/disputes");
  assert.equal(res.status, 502);
  assert.deepEqual(res.body.error, {
    code: "paypal_auth_failed",
    message: "PayPal sandbox rejected the server's credentials.",
    upstream_status: 401,
  });
  assertNoSecrets(res.text);
});

test("PayPal non-2xx on the dispute list is passed on as an upstream error", async () => {
  const { client } = mockPayPal({ disputes: () => json(500, { name: "INTERNAL_SERVICE_ERROR" }) });
  const res = await get(createApp(client), "/api/sandbox/disputes");
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, "paypal_error");
  assert.equal(res.body.error.upstream_status, 500);
});

test("network failure becomes paypal_unreachable", async () => {
  const { client } = mockPayPal({
    token: () => {
      throw new TypeError("fetch failed");
    },
  });
  const res = await get(createApp(client), "/api/sandbox/disputes");
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, "paypal_unreachable");
});

test("non-JSON or malformed PayPal bodies become paypal_bad_response", async () => {
  const html = mockPayPal({ disputes: () => new Response("<html>oops</html>", { status: 200 }) });
  assert.equal((await get(createApp(html.client), "/api/sandbox/disputes")).body.error.code, "paypal_bad_response");

  const badItems = mockPayPal({ disputes: () => json(200, { items: "nope" }) });
  assert.equal((await get(createApp(badItems.client), "/api/sandbox/disputes")).body.error.code, "paypal_bad_response");

  const noId = mockPayPal({ disputes: () => json(200, { items: [{ status: "OPEN" }] }) });
  assert.equal((await get(createApp(noId.client), "/api/sandbox/disputes")).body.error.code, "paypal_bad_response");
});

test("missing credentials return 503 and never call PayPal", async () => {
  const res = await get(createApp(null), "/api/sandbox/disputes");
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, "paypal_not_configured");
});

test("token is reused, and an expired token is dropped after a 401", async () => {
  let disputeCalls = 0;
  const { client, calls } = mockPayPal({
    disputes: () => (++disputeCalls === 2 ? json(401, { name: "AUTHENTICATION_FAILURE" }) : json(200, { items: [] })),
  });
  const app = createApp(client);
  await get(app, "/api/sandbox/disputes");
  const second = await get(app, "/api/sandbox/disputes");
  assert.equal(second.body.error.code, "paypal_auth_failed");
  await get(app, "/api/sandbox/disputes");

  const tokenCalls = calls.filter((c) => c.url.endsWith("/v1/oauth2/token")).length;
  assert.equal(tokenCalls, 2, "one token for the first two calls, a fresh one after the 401");
});

const postJson = (body: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body });
const demoRecord = {
  source: "demo",
  dispute_id: "DEMO-1001",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "OPEN",
  amount: { currency_code: "USD", value: "49.99" },
  order: { order_id: "ORDER-1001", item: "Wireless keyboard", shipping_status: "SHIPPED", tracking_number: null },
  evidence: { proof_of_delivery: false, shipping_tracking: false, order_confirmation: true, customer_communication: true },
};

test("analysis endpoint analyzes a valid record without calling PayPal", async () => {
  const { client, calls } = mockPayPal();
  const res = await get(createApp(client), "/api/analysis", postJson(JSON.stringify(demoRecord)));
  assert.equal(res.status, 200);
  assert.equal(res.body.source, "demo");
  assert.equal(res.body.dispute_id, "DEMO-1001");
  assert.ok(res.body.draft.text.startsWith("DRAFT — REQUIRES MERCHANT REVIEW."));
  assert.equal(calls.length, 0);
  assertNoSecrets(res.text);
});

test("analysis endpoint rejects invalid records, bad JSON and oversized bodies", async () => {
  const app = createApp(null);
  const invalid = await get(app, "/api/analysis", postJson(JSON.stringify({ ...demoRecord, source: "live" })));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "invalid_dispute");
  assert.deepEqual(invalid.body.error.details, ['source must be "demo" or "paypal_sandbox".']);

  const broken = await get(app, "/api/analysis", postJson("{not json"));
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, "invalid_json");

  const huge = await get(app, "/api/analysis", postJson(JSON.stringify({ ...demoRecord, customer_message: "x".repeat(40_000) })));
  assert.equal(huge.status, 413);
  assert.equal(huge.body.error.code, "payload_too_large");

  const notJson = await get(app, "/api/analysis", { method: "POST", body: "a=b" });
  assert.equal(notJson.status, 400);
});

test("only the token POST and read-only GETs are ever sent to PayPal", async () => {
  const { client, calls } = mockPayPal();
  await get(createApp(client), "/api/sandbox/disputes");
  for (const call of calls) {
    const allowed = call.url.endsWith("/v1/oauth2/token") ? "POST" : "GET";
    assert.equal(call.method, allowed, `${call.method} ${call.url}`);
    assert.ok(call.url.startsWith("https://api-m.sandbox.paypal.com/"), call.url);
  }
});

test("requests addressed to another host are refused before any route runs", async () => {
  const { client, calls } = mockPayPal({ disputes: () => json(200, { items: [{ dispute_id: "PP-D-1" }] }) });
  const app = createApp(client);
  for (const host of ["evil.example:3001", "evil.example", "127.0.0.1.evil.example"]) {
    const res = await getWithHost(app, "/api/sandbox/disputes", host);
    assert.equal(res.status, 403, host);
    assert.equal(JSON.parse(res.text).error.code, "forbidden_host");
    assert.ok(!res.text.includes("PP-D-1"));
  }
  assert.equal(calls.length, 0);
  for (const host of ["localhost:5173", "127.0.0.1:3001", "[::1]:3001", "LOCALHOST"]) {
    assert.equal((await getWithHost(app, "/api/health", host)).status, 200, host);
  }
});
