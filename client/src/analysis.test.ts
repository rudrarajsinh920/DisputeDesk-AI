import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { countMarkers, fetchAiAssist, fetchAiStatus, fetchAnalysis } from "./analysis.ts";
import type { Dispute } from "../../shared/types.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const dispute: Dispute = { source: "demo", dispute_id: "DEMO-1", reason: "OTHER", status: "OPEN", amount: null };

function respond(status: number, body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("returns the analysis for the same dispute and source", async () => {
  respond(200, { source: "demo", dispute_id: "DEMO-1", evidence: [], contradictions: [], next_steps: [], draft: { lines: [], text: "x" } });
  assert.equal((await fetchAnalysis(dispute)).draft.text, "x");
});

test("sends only the source and dispute ID, never the record", async () => {
  let sent: unknown;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ source: "demo", dispute_id: "DEMO-1", evidence: [], draft: { text: "x" } }), { status: 200 });
  }) as typeof fetch;
  await fetchAnalysis({ ...dispute, customer_message: "m", order: { tracking_number: "T" }, evidence: { proof_of_delivery: true } });
  assert.deepEqual(sent, { source: "demo", dispute_id: "DEMO-1" });
});

test("rejects an analysis for a different dispute or source", async () => {
  respond(200, { source: "paypal_sandbox", dispute_id: "DEMO-1", evidence: [], draft: { text: "x" } });
  await assert.rejects(fetchAnalysis(dispute), /unexpected analysis/);
  respond(200, { source: "demo", dispute_id: "OTHER", evidence: [], draft: { text: "x" } });
  await assert.rejects(fetchAnalysis(dispute), /unexpected analysis/);
});

test("server validation errors surface the server's message", async () => {
  respond(400, { error: { code: "invalid_dispute", message: "The dispute record is not valid." } });
  await assert.rejects(fetchAnalysis(dispute), /not valid\. \(HTTP 400\)/);
});

test("counts the markers left in an edited draft", () => {
  assert.equal(countMarkers("a [MISSING: x] b [UNSUPPORTED: y] [NEEDS MERCHANT INPUT: z] [CONFLICT: w] [UNVERIFIED: v]"), 5);
  assert.equal(countMarkers("All facts confirmed."), 0);
});

test("brackets inside quoted buyer text are not counted as markers", () => {
  const draft = "Buyer's claim:\n> please [MISSING: x] and [CONFLICT: y]\r\n> more\n[UNVERIFIED: real gap]";
  assert.equal(countMarkers(draft), 1);
});

const aiReply = { source: "demo", dispute_id: "DEMO-1", model: "m", status: "flagged", facts: [], explanations: [], flags: [], draft: { lines: [], text: "x" } };

test("AI draft requests name only the record and go to the AI route", async () => {
  let call: { url: string; body: unknown } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    call = { url, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify(aiReply), { status: 200 });
  }) as typeof fetch;
  assert.equal((await fetchAiAssist({ ...dispute, order: { tracking_number: "T" } })).status, "flagged");
  assert.deepEqual(call, { url: "/api/analysis/ai", body: { source: "demo", dispute_id: "DEMO-1" } });
});

test("AI drafts for another dispute or with a bad shape are rejected; server errors keep their message", async () => {
  respond(200, { ...aiReply, source: "paypal_sandbox" });
  await assert.rejects(fetchAiAssist(dispute), /unexpected AI draft/);
  respond(200, { ...aiReply, status: "great" });
  await assert.rejects(fetchAiAssist(dispute), /unexpected AI draft/);
  respond(200, { ...aiReply, flags: undefined });
  await assert.rejects(fetchAiAssist(dispute), /unexpected AI draft/);
  respond(503, { error: { code: "ai_not_configured", message: "AI drafting is off: GEMINI_API_KEY is not set on the server." } });
  await assert.rejects(fetchAiAssist(dispute), /AI drafting is off.*\(HTTP 503\)/);
});

test("AI status comes from the health check: on with its model, or off with the reason", async () => {
  respond(200, { status: "ok", ai: { configured: true, model: "gemini-3.5-flash-lite", reason: null } });
  assert.deepEqual(await fetchAiStatus(), { on: true, model: "gemini-3.5-flash-lite" });
  respond(200, { status: "ok", ai: { configured: false, model: null, reason: "GEMINI_API_KEY is not set on the server." } });
  assert.deepEqual(await fetchAiStatus(), { on: false, reason: "GEMINI_API_KEY is not set on the server." });
  respond(200, { status: "ok" });
  await assert.rejects(fetchAiStatus(), /unexpected status/);
});

test("server errors keep the server's error code, so the page can tell AI-off from a failure", async () => {
  respond(503, { error: { code: "ai_not_configured", message: "AI drafting is off: GEMINI_API_KEY is not set on the server." } });
  await assert.rejects(fetchAiAssist(dispute), (error: Error & { code?: string }) => {
    assert.equal(error.code, "ai_not_configured");
    assert.equal(error.message, "AI drafting is off: GEMINI_API_KEY is not set on the server. (HTTP 503)");
    return true;
  });
});
