import assert from "node:assert/strict";
import { test } from "node:test";
import { AiError, GEMINI_API_URL, createGeminiClient } from "./gemini.ts";

// Placeholder only; nothing here talks to Google.
const KEY = "test-gemini-key";
const REQUEST = { system: "rules", prompt: "facts", schema: { type: "OBJECT" } };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const answer = (value: unknown, finishReason = "STOP") =>
  json(200, { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] });

function mockGemini(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { client: createGeminiClient({ apiKey: KEY, model: "gemini-test-model" }, fetchImpl), calls };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AiError, String(error));
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(KEY), "error message leaked the key");
    return true;
  });
}

test("sends one JSON-mode generateContent request with the key in a header, not the URL", async () => {
  const { client, calls } = mockGemini(() => answer({ ok: true }));
  assert.deepEqual(await client.generateJson(REQUEST), { ok: true });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, `${GEMINI_API_URL}/models/gemini-test-model:generateContent`);
  assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
  assert.ok(!url.includes(KEY));
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], KEY);
  const body = JSON.parse(String(init.body));
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, REQUEST.schema);
  assert.equal(body.systemInstruction.parts[0].text, "rules");
  assert.equal(body.contents[0].parts[0].text, "facts");
  assert.ok(!String(init.body).includes(KEY));
});

test("joins multi-part answers before parsing", async () => {
  const { client } = mockGemini(() => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }] }));
  assert.deepEqual(await client.generateJson(REQUEST), { a: 1 });
});

test("timeouts and network failures are reported, not thrown raw", async () => {
  await rejectsWith(
    mockGemini(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }).client.generateJson(REQUEST),
    "ai_timeout",
  );
  await rejectsWith(
    mockGemini(() => {
      throw new TypeError("fetch failed");
    }).client.generateJson(REQUEST),
    "ai_unavailable",
  );
});

test("HTTP errors map to clear codes, and upstream bodies are not passed on", async () => {
  const limited = mockGemini(() => json(429, { error: { message: "quota" } }, { "Retry-After": "30" }));
  await assert.rejects(limited.client.generateJson(REQUEST), (e: unknown) => e instanceof AiError && e.code === "ai_rate_limited" && e.retryAfterSeconds === 30);
  await rejectsWith(mockGemini(() => json(429, {})).client.generateJson(REQUEST), "ai_rate_limited");

  await rejectsWith(mockGemini(() => json(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })).client.generateJson(REQUEST), "ai_auth_failed");
  await rejectsWith(mockGemini(() => json(403, {})).client.generateJson(REQUEST), "ai_auth_failed");
  await rejectsWith(mockGemini(() => json(404, { error: { message: "model not found" } })).client.generateJson(REQUEST), "ai_unavailable");
  await rejectsWith(mockGemini(() => json(503, {})).client.generateJson(REQUEST), "ai_unavailable");
  await rejectsWith(mockGemini(() => json(400, { error: { message: "secret detail from upstream" } })).client.generateJson(REQUEST), "ai_error");
  await assert.rejects(
    mockGemini(() => json(400, { error: { message: "secret detail from upstream" } })).client.generateJson(REQUEST),
    (e: unknown) => e instanceof Error && !e.message.includes("secret detail"),
  );
});

test("blocked, cut-off and malformed answers are rejected", async () => {
  await rejectsWith(mockGemini(() => json(200, { promptFeedback: { blockReason: "SAFETY" } })).client.generateJson(REQUEST), "ai_blocked");
  await rejectsWith(mockGemini(() => answer({}, "SAFETY")).client.generateJson(REQUEST), "ai_blocked");
  await rejectsWith(mockGemini(() => answer({}, "MAX_TOKENS")).client.generateJson(REQUEST), "ai_bad_response");
  await rejectsWith(mockGemini(() => new Response("<html>oops</html>", { status: 200 })).client.generateJson(REQUEST), "ai_bad_response");
  await rejectsWith(mockGemini(() => json(200, { candidates: [] })).client.generateJson(REQUEST), "ai_bad_response");
  await rejectsWith(mockGemini(() => json(200, null)).client.generateJson(REQUEST), "ai_bad_response");
  await rejectsWith(
    mockGemini(() => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Sure! Here is the draft:" }] } }] })).client.generateJson(REQUEST),
    "ai_bad_response",
  );
});

test("a busy 5xx from Gemini is retried once; other errors are not", async () => {
  let n = 0;
  const blip = mockGemini(() => (n++ === 0 ? json(503, {}) : answer({ ok: true })));
  assert.deepEqual(await blip.client.generateJson(REQUEST), { ok: true });
  assert.equal(blip.calls.length, 2);

  const down = mockGemini(() => json(503, {}));
  await rejectsWith(down.client.generateJson(REQUEST), "ai_unavailable");
  assert.equal(down.calls.length, 2);

  const limited = mockGemini(() => json(429, {}));
  await assert.rejects(limited.client.generateJson(REQUEST));
  assert.equal(limited.calls.length, 1);
});
