import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchSandboxDisputes } from "./sandbox.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: string) {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
}

test("returns sandbox disputes tagged with their source", async () => {
  respond(200, JSON.stringify({ source: "paypal_sandbox", disputes: [{ dispute_id: "PP-1", source: "paypal_sandbox" }] }));
  const disputes = await fetchSandboxDisputes();
  assert.equal(disputes.length, 1);
  assert.equal(disputes[0].source, "paypal_sandbox");
});

test("a sandbox list containing a record with another label is rejected, not relabeled", async () => {
  respond(200, JSON.stringify({ source: "paypal_sandbox", disputes: [{ dispute_id: "PP-1", source: "paypal_sandbox" }, { dispute_id: "DEMO-1001", source: "demo" }] }));
  await assert.rejects(fetchSandboxDisputes(), /unexpected response/);
  respond(200, JSON.stringify({ source: "paypal_sandbox", disputes: [{ dispute_id: "PP-2" }] }));
  await assert.rejects(fetchSandboxDisputes(), /unexpected response/);
});

test("an empty sandbox is an empty list, not an error", async () => {
  respond(200, JSON.stringify({ source: "paypal_sandbox", disputes: [] }));
  assert.deepEqual(await fetchSandboxDisputes(), []);
});

test("server errors surface the server's message", async () => {
  respond(502, JSON.stringify({ error: { code: "paypal_auth_failed", message: "PayPal sandbox rejected the server's credentials." } }));
  await assert.rejects(fetchSandboxDisputes(), /rejected the server's credentials\. \(HTTP 502\)/);
});

test("no server (empty proxy reply) gives a plain message", async () => {
  respond(502, "");
  await assert.rejects(fetchSandboxDisputes(), /not responding\. \(HTTP 502\)/);
});

test("a reply that is not a sandbox list is rejected", async () => {
  respond(200, JSON.stringify({ disputes: [] }));
  await assert.rejects(fetchSandboxDisputes(), /unexpected response/);
  respond(200, "<!doctype html>");
  await assert.rejects(fetchSandboxDisputes(), /unexpected response/);
});
