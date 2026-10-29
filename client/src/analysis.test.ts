import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { countMarkers, fetchAnalysis } from "./analysis.ts";
import type { Dispute } from "./types.ts";

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
