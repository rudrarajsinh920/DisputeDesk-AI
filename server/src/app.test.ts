import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { DEMO_DISPUTES, createApp } from "./app.ts";
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
const lookup = (source: string, dispute_id: unknown, extra: object = {}) => postJson(JSON.stringify({ source, dispute_id, ...extra }));
const sandboxItem = { dispute_id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "OPEN", dispute_amount: { currency_code: "USD", value: "12.50" } };

test("demo analysis uses the server's own demo record and labels it demo", async () => {
  const { client, calls } = mockPayPal();
  const res = await get(createApp(client), "/api/analysis", lookup("demo", "DEMO-1001"));
  assert.equal(res.status, 200);
  assert.equal(res.body.source, "demo");
  assert.equal(res.body.dispute_id, "DEMO-1001");
  assert.ok(res.body.draft.text.startsWith("DRAFT — REQUIRES MERCHANT REVIEW."));
  assert.ok(res.body.draft.text.includes("DEMO DATA — NOT A REAL PAYPAL DISPUTE."));
  assert.equal(calls.length, 0);
  assertNoSecrets(res.text);

  const unknown = await get(createApp(client), "/api/analysis", lookup("demo", "DEMO-9999"));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "dispute_not_found");
  assert.equal(unknown.body.draft, undefined);
});

test("a demo record cannot be relabeled as a sandbox dispute", async () => {
  // The attack: demo ID, sandbox label, invented evidence. The sandbox has no such dispute.
  const { client, calls } = mockPayPal();
  const forged = {
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    order: { tracking_number: "FAKE-TRK-1", shipping_status: "DELIVERED" },
    evidence: { shipping_tracking: true, proof_of_delivery: true },
  };
  const res = await get(createApp(client), "/api/analysis", lookup("paypal_sandbox", "DEMO-1001", forged));
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "dispute_not_found");
  assert.ok(!res.text.includes("FAKE-TRK-1"));
  assert.ok(calls.every((c) => c.method === "GET" || c.url.endsWith("/v1/oauth2/token")));
});

test("sandbox analysis uses only what PayPal returned, never fields from the request", async () => {
  const { client, calls } = mockPayPal({ disputes: () => json(200, { items: [sandboxItem] }) });
  const extra = { status: "RESOLVED", order: { tracking_number: "FAKE-TRK-2" }, evidence: { proof_of_delivery: true } };
  const res = await get(createApp(client), "/api/analysis", lookup("paypal_sandbox", "PP-D-1", extra));
  assert.equal(res.status, 200);
  assert.equal(res.body.source, "paypal_sandbox");
  assert.ok(!res.body.draft.text.includes("DEMO DATA"));
  assert.ok(!res.text.includes("FAKE-TRK-2"));
  assert.ok(res.body.draft.text.includes("Amount: USD 12.50"));
  // No order or evidence data comes from PayPal, so every item is unverified rather than taken from the request.
  assert.ok(res.body.evidence.every((e: { status: string }) => e.status === "unverified"));
  assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/v1/customer/disputes")));
  assertNoSecrets(res.text);

  const missing = await get(createApp(client), "/api/analysis", lookup("paypal_sandbox", "PP-D-404"));
  assert.equal(missing.status, 404);
});

test("sandbox analysis without credentials is 503, and PayPal failures are 502 without secrets", async () => {
  const offline = await get(createApp(null), "/api/analysis", lookup("paypal_sandbox", "PP-D-1"));
  assert.equal(offline.status, 503);
  assert.equal(offline.body.error.code, "paypal_not_configured");

  const { client } = mockPayPal({ token: () => json(401, { error: "invalid_client" }) });
  const failed = await get(createApp(client), "/api/analysis", lookup("paypal_sandbox", "PP-D-1"));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error.code, "paypal_auth_failed");
  assertNoSecrets(failed.text);
});

test("analysis endpoint rejects bad lookups, bad JSON and oversized bodies", async () => {
  const { client, calls } = mockPayPal();
  const app = createApp(client);
  const bad = async (init: RequestInit) => {
    const res = await get(app, "/api/analysis", init);
    assert.equal(res.status, 400, String(init.body));
    return res;
  };
  assert.deepEqual((await bad(lookup("live", "DEMO-1001"))).body.error.details, ['source must be "demo" or "paypal_sandbox".']);
  assert.equal((await bad(lookup("demo", 1001))).body.error.code, "invalid_request");
  await bad(lookup("demo", "../v1/payments"));
  await bad(lookup("demo", "x".repeat(101)));
  await bad(postJson("[]"));
  assert.equal((await bad(postJson("{not json"))).body.error.code, "invalid_json");
  await bad({ method: "POST", body: "a=b" });

  const huge = await get(app, "/api/analysis", lookup("demo", "DEMO-1001", { pad: "x".repeat(5000) }));
  assert.equal(huge.status, 413);
  assert.equal(huge.body.error.code, "payload_too_large");
  assert.equal(calls.length, 0);
});

test("the server's demo set is the validated demo fixture", () => {
  assert.equal(DEMO_DISPUTES.length, 1);
  assert.ok(DEMO_DISPUTES.every((d) => d.source === "demo"));
  assert.equal(DEMO_DISPUTES[0].dispute_id, "DEMO-1001");
});

test("only the token POST and read-only GETs are ever sent to PayPal", async () => {
  const { client, calls } = mockPayPal();
  const app = createApp(client);
  await get(app, "/api/sandbox/disputes");
  await get(app, "/api/analysis", lookup("paypal_sandbox", "PP-D-1"));
  assert.ok(calls.length >= 2);
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
