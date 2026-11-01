// UI tests: real components rendered to HTML (react-dom/server), fed by the real evidence engine and AI checks
// on synthetic records. No network: Gemini answers are canned objects, and fetch throws if called.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAiRequest, composeAiAssist } from "../../server/src/assist.ts";
import { analyzeDispute } from "../../server/src/evidence.ts";
import { VALIDATION_EXAMPLE_MODEL, validationExampleAnswer } from "../../server/src/assist.ts";
import { AI_OFF_BAD_MODEL } from "../../server/src/config.ts";
import { AiResult, AiSectionView, AnalysisView, DISCARD_EDITS, DraftEditor, ValidationExampleView } from "./AnalysisPanel.tsx";
import type { AiState, ExampleState } from "./AnalysisPanel.tsx";
import App, { DisputesView } from "./App.tsx";
import type { SandboxLoad } from "./App.tsx";
import { DisputeDetail } from "./DisputeDetail.tsx";
import { demoDisputes } from "./data.ts";
import type { AiAssist, Dispute } from "./types.ts";

globalThis.fetch = (() => {
  throw new Error("UI tests must not make network requests");
}) as typeof fetch;

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};

const demo = demoDisputes[0];
// Synthetic sandbox-shaped records with obvious mock IDs. "Delivered" without proof of delivery is a contradiction.
const sandbox: Dispute[] = [
  {
    source: "paypal_sandbox",
    dispute_id: "MOCK-SBX-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: { currency_code: "USD", value: "120.00" },
    order: { order_id: "ORD-77", item: "Desk lamp", shipping_status: "DELIVERED", tracking_number: "TRK-MOCK-1" },
    evidence: { proof_of_delivery: false, shipping_tracking: true, order_confirmation: true, customer_communication: false },
  },
  { source: "paypal_sandbox", dispute_id: "MOCK-SBX-2", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", status: "RESOLVED", amount: null },
];

const view = (disputes: Dispute[] | null, sandboxLoad: SandboxLoad, selectedId: string | null = null) =>
  html(
    createElement(DisputesView, { disputes, sandbox: sandboxLoad, onRetry: noop, filter: "ALL", onFilter: noop, selectedId, onSelect: noop }),
  );

// A mocked Gemini answer run through the server's real checks.
function assistFor(dispute: Dispute, answer: unknown): AiAssist {
  const analysis = analyzeDispute(dispute);
  const { facts } = buildAiRequest(dispute, analysis);
  return composeAiAssist(dispute, analysis, facts, answer, "mock-model");
}
const demoAnswer = {
  explanations: [
    { evidence_id: "order_confirmation", status: "available", text: "An order confirmation is on record.", cites: ["R5"] },
    { evidence_id: "shipping_tracking", status: "missing", text: "No tracking evidence is on record yet.", cites: ["R6"] },
    { evidence_id: "proof_of_delivery", status: "missing", text: "Proof of delivery is not on record.", cites: ["R7"] },
    { evidence_id: "customer_communication", status: "available", text: "Messages with the buyer are on record.", cites: ["R8"] },
  ],
  draft_sections: [{ text: "Add the carrier record from your shipping system.", cites: [], needs_merchant_input: true }],
};

type Props = Record<string, unknown>;
// First element in an unrendered tree (child components are not called) that matches pred.
function findElement(node: ReactNode, pred: (el: ReactElement<Props>) => boolean): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as ReactElement<Props>;
  return pred(el) ? el : findElement(el.props.children as ReactNode, pred);
}

type Button = ReactElement<{ onClick: () => void; children: string }>;
function regenerateButton(assist: AiAssist, pending: boolean, onRegenerate: () => void) {
  const editor = findElement(AiResult({ assist, id: "ai-draft-DEMO-1001", pending, onRegenerate }), (el) => el.type === DraftEditor);
  assert.ok(editor, "the AI draft uses the draft editor");
  return editor.props.extraAction as (edited: boolean) => Button;
}

// ---- Dashboard states ----

test("dashboard loads with demo data, labeled as synthetic and not PayPal", () => {
  const page = text(html(createElement(App)));
  assert.match(page, /DEMO DATA — NOT A REAL PAYPAL DISPUTE/);
  assert.match(page, /Nothing here is connected to PayPal/);
  assert.match(page, /Demo dispute DEMO-1001/);
  assert.doesNotMatch(page, /PayPal sandbox dispute/);
  // Analysis runs on the server, so the first render shows its loading state.
  assert.match(page, /Analyzing evidence…/);
});

test("sandbox loading, empty and error states", () => {
  const loading = view(null, { status: "loading" });
  assert.match(loading, /role="status" aria-busy="true"/);
  assert.match(text(loading), /Loading PayPal sandbox disputes…/);

  const empty = text(view([], { status: "ready", disputes: [] }));
  assert.match(empty, /No disputes in the PayPal sandbox/);
  assert.match(empty, /Refresh/);
  assert.doesNotMatch(empty, /DEMO-1001/, "demo records never fill an empty sandbox");

  const error = view(null, { status: "error", message: "PayPal sandbox could not be reached. (HTTP 502)" });
  assert.match(error, /role="alert"/);
  assert.match(text(error), /Couldn't load PayPal sandbox disputes PayPal sandbox could not be reached\. \(HTTP 502\)/);
  assert.match(text(error), /Try again/);
});

test("sandbox records are labeled sandbox, and the selected dispute is shown", () => {
  const first = text(view(sandbox, { status: "ready", disputes: sandbox }));
  assert.match(first, /PayPal sandbox dispute MOCK-SBX-1/, "the first dispute is selected by default");
  assert.doesNotMatch(first, /Demo dispute/);

  const second = view(sandbox, { status: "ready", disputes: sandbox }, "MOCK-SBX-2");
  assert.match(text(second), /PayPal sandbox dispute MOCK-SBX-2/);
  assert.equal((second.match(/aria-current="true"/g) ?? []).length, 1);
  assert.match(second, /aria-current="true"><span class="row-line"><span class="mono">MOCK-SBX-2/);
  assert.match(second, /aria-label="Dispute details" tabindex="-1"/, "details can take focus after selection on small screens");
});

// ---- Rule-based analysis ----

test("evidence statuses, citations, missing evidence and next steps come from the rules", () => {
  const out = text(html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) })));
  assert.match(out, /Order confirmation Available/);
  assert.match(out, /Shipping tracking Key for this reason Missing/);
  assert.match(out, /Proof of delivery Key for this reason Missing/);
  assert.match(out, /Missing from the supplied records does not show that it did not happen/);
  assert.match(out, /Based on: evidence\.order_confirmation = true/);
  assert.match(out, /order\.tracking_number = not on record/);
  assert.match(out, /No contradictions found/);
  assert.match(out, /Find or confirm the proof of delivery record\./);
});

test("contradictions show the records involved and carry into the draft", () => {
  const analysis = analyzeDispute(sandbox[0]);
  const markup = html(createElement(AnalysisView, { dispute: sandbox[0], analysis }));
  assert.match(markup, /class="finding finding-conflict"/);
  assert.match(
    text(markup),
    /The shipping status is "Delivered", but proof of delivery is marked not available\. Records: order\.shipping_status = DELIVERED; evidence\.proof_of_delivery = false/,
  );
  assert.match(analysis.draft.text, /\[CONFLICT:/);
});

test("the rule-based draft shows the merchant-review warning and its review header", () => {
  const markup = html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) }));
  assert.match(text(markup), /Draft only\. It requires merchant review, is never sent to PayPal/);
  assert.match(markup, /<label for="draft-DEMO-1001">Response draft<\/label>/);
  assert.match(markup, /DRAFT — REQUIRES MERCHANT REVIEW\. NOT SUBMITTED TO PAYPAL\./);
  assert.match(markup, /DEMO DATA — NOT A REAL PAYPAL DISPUTE\./);
  assert.match(text(markup), /5 markers to resolve/);
});

// ---- AI-assisted draft ----

const aiView = (ai: AiState) => html(createElement(AiSectionView, { dispute: demo, ai, onGenerate: noop }));
const idle: AiState = { run: 0, assist: null, pending: false, error: null, status: null };

test("AI drafting starts idle and keeps keyboard focus on its button while writing", () => {
  assert.match(text(aiView(idle)), /Generate AI draft/);
  const pending = aiView({ ...idle, pending: true });
  assert.match(pending, /aria-disabled="true">Writing AI draft…/);
  assert.doesNotMatch(pending, /<button[^>]* disabled=""/, "a disabled button would drop keyboard focus");
  assert.match(pending, /role="status">Writing AI draft…/);
});

test("a successful AI response shows AI wording, rule statuses, citations and the AI warning", () => {
  const assist = assistFor(demo, demoAnswer);
  assert.equal(assist.status, "ok");
  const markup = aiView({ ...idle, run: 1, assist });
  const out = text(markup);
  assert.match(out, /Checked, no issues found/);
  assert.match(out, /Written by mock-model\./);
  assert.match(out, /Proof of delivery AI wording Missing Proof of delivery is not on record\. Cites: R7 Proof of delivery = marked not available/);
  assert.equal((out.match(/AI wording/g) ?? []).length, 4);
  assert.match(out, /AI-assisted draft\. Check every statement against your records\. It is never sent to PayPal/);
  assert.match(markup, /AI-ASSISTED — CHECK EVERY STATEMENT AGAINST YOUR RECORDS\./);
  assert.match(markup, /DRAFT — REQUIRES MERCHANT REVIEW/);
  assert.match(markup, /role="status">AI draft ready\. Checked, no issues found\./);
});

test("unsupported AI claims are flagged, shown as unused text, and kept out of the draft", () => {
  const answer = {
    explanations: demoAnswer.explanations.map((e) =>
      e.evidence_id === "proof_of_delivery" ? { ...e, text: "The buyer signed for the parcel at the door." } : e,
    ),
    draft_sections: [{ text: "UPS confirmed delivery on the porch.", cites: ["R4"], needs_merchant_input: false }],
  };
  const assist = assistFor(demo, answer);
  assert.equal(assist.status, "flagged");
  const markup = aiView({ ...idle, run: 1, assist });
  const out = text(markup);
  assert.match(out, /2 issues flagged/);
  assert.match(out, /names a carrier/);
  assert.match(out, /claims delivery, but proof of delivery is not available/);
  assert.match(out, /Text that was not used/);
  // The flagged explanation falls back to the rules' wording and status.
  assert.match(out, /Proof of delivery Rules' wording Missing/);
  const draft = markup.match(/<textarea[^>]*id="ai-draft-DEMO-1001"[^>]*>([^]*?)<\/textarea>/)?.[1] ?? "";
  assert.ok(draft.length > 0);
  assert.doesNotMatch(draft, /UPS|signed for|porch/);
});

test("an invalid AI response is an error in the AI section only", () => {
  // The server rejects a malformed answer before any of it reaches the page.
  assert.throws(() => assistFor(demo, { explanations: "nope" }));
  const out = aiView({ ...idle, error: "Gemini returned an answer DisputeDesk could not use. (HTTP 502)" });
  assert.match(out, /class="error-text" role="alert">Gemini returned an answer DisputeDesk could not use\. \(HTTP 502\)/);
  assert.match(text(out), /Try again/);
  assert.doesNotMatch(out, /<textarea/, "no AI draft is shown");
});

test("Gemini unavailable: the AI section says why, and the rules' analysis and draft still render", () => {
  const ai = text(aiView({ ...idle, error: "AI drafting is off: GEMINI_API_KEY is not set on the server. (HTTP 503)" }));
  assert.match(ai, /AI drafting is off: GEMINI_API_KEY is not set on the server\./);
  const rules = text(html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) })));
  assert.match(rules, /Evidence analysis/);
  assert.match(rules, /Response draft/);
});

test("a failed regeneration keeps the previous AI draft and says so", () => {
  const out = aiView({ ...idle, run: 1, assist: assistFor(demo, demoAnswer), error: "The configured Gemini model is not available. (HTTP 502)" });
  assert.match(
    text(out),
    /Couldn't write a new AI draft: The configured Gemini model is not available\. \(HTTP 502\) The previous AI draft is still shown\./,
  );
  assert.match(out, /id="ai-draft-DEMO-1001"/);
});

// ---- Draft editing ----

test("Generate again asks before discarding merchant edits, and not otherwise", () => {
  let regenerated = 0;
  const action = regenerateButton(assistFor(demo, demoAnswer), false, () => regenerated++);
  const asked: string[] = [];
  let answer = false;
  const g = globalThis as { window?: unknown };
  g.window = { confirm: (message: string) => (asked.push(message), answer) };
  try {
    action(false).props.onClick();
    assert.equal(regenerated, 1, "an unedited draft regenerates without asking");
    assert.equal(asked.length, 0);

    action(true).props.onClick();
    assert.deepEqual(asked, [DISCARD_EDITS]);
    assert.equal(regenerated, 1, "declining keeps the edits");

    answer = true;
    action(true).props.onClick();
    assert.equal(regenerated, 2);
  } finally {
    delete g.window;
  }
});

test("Generate again does nothing while a draft is being written", () => {
  let regenerated = 0;
  const button = regenerateButton(assistFor(demo, demoAnswer), true, () => regenerated++)(false);
  assert.equal(button.props.children, "Writing AI draft…");
  button.props.onClick();
  assert.equal(regenerated, 0);
});

test("the merchant-review warning sits outside the editable text, so edits can't remove it", () => {
  // Even with every line of the draft deleted, the note beside it still renders.
  const markup = html(createElement(DraftEditor, { id: "d", title: "Response draft", note: "Draft only. It requires merchant review.", generated: "" }));
  assert.match(markup, /<p class="muted">Draft only\. It requires merchant review\.<\/p><textarea [^>]*id="d"/);
  assert.match(text(markup), /No markers left/);
});

// ---- No PayPal submission ----

test("no control in the workspace can submit, send or publish to PayPal", () => {
  const markup =
    html(createElement(DisputeDetail, { dispute: demo })) +
    html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) })) +
    aiView({ ...idle, run: 1, assist: assistFor(demo, demoAnswer) });
  const buttons = new Set([...markup.matchAll(/<button[^>]*>([^]*?)<\/button>/g)].map((m) => text(m[1]).trim()));
  assert.deepEqual([...buttons].sort(), ["Copy draft", "Generate AI draft", "Generate again", "Reset to generated draft", "Show a validation example"]);
  assert.doesNotMatch(markup, /<form|action="/);
  assert.match(text(markup), /DisputeDesk never submits responses to PayPal automatically\./);
});

test("the client calls only DisputeDesk's own read and analysis endpoints", () => {
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  const urls = [...new Set([...sources.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(urls, ["/api/analysis", "/api/analysis/ai", "/api/analysis/ai/example", "/api/health", "/api/sandbox/disputes"]);
  assert.equal((sources.match(/fetch\(/g) ?? []).length, 4, "each fetch call uses one of the endpoints above");
  assert.doesNotMatch(sources, /paypal\.com|generativelanguage|method:\s*"(PUT|PATCH|DELETE)"/i);
});

// ---- Demo set ----

test("the demo set shows a gaps case, a contradiction case and a complete case, all labeled demo", async () => {
  const { DEMO_DISPUTES } = await import("../../server/src/app.ts");
  assert.deepEqual(demoDisputes.map((d) => d.dispute_id), DEMO_DISPUTES.map((d) => d.dispute_id), "client and server list the same demo records");
  assert.ok(demoDisputes.every((d) => d.source === "demo"));

  const byId = Object.fromEntries(demoDisputes.map((d) => [d.dispute_id, analyzeDispute(d)]));
  assert.ok(byId["DEMO-1001"].evidence.some((e) => e.status === "missing"));
  assert.equal(byId["DEMO-1001"].contradictions.length, 0);
  assert.deepEqual(byId["DEMO-1002"].contradictions.map((c) => c.message), ['The shipping status is "Delivered", but proof of delivery is marked not available.']);
  assert.ok(byId["DEMO-1003"].evidence.every((e) => e.status === "available"));
  assert.equal(byId["DEMO-1003"].contradictions.length, 0);

  const list = text(view(demoDisputes, { status: "loading" }));
  assert.match(list, /Total disputes 3/);
  assert.match(list, /DEMO-1001 .*DEMO-1002 .*DEMO-1003/);
});

// ---- AI status and validation example ----

test("with AI drafting off, the AI section says why up front and offers no button that can't work", () => {
  const out = aiView({ ...idle, status: { on: false, reason: AI_OFF_BAD_MODEL } });
  assert.match(text(out), /AI drafting is off on this server\. GEMINI_MODEL is not a valid model code/);
  assert.match(text(out), /The rule-based analysis and draft above work without it\./);
  assert.doesNotMatch(out, /Generate AI draft|Try again/);
});

test("with AI drafting on, the AI section names the model before anyone clicks", () => {
  const out = text(aiView({ ...idle, status: { on: true, model: "gemini-3.5-flash-lite" } }));
  assert.match(out, /Model: gemini-3\.5-flash-lite\./);
  assert.match(out, /Generate AI draft/);
});

test("the validation example is labeled as not Gemini and shows every planted mistake as flagged", () => {
  const exampleView = (example: ExampleState) => html(createElement(ValidationExampleView, { example, onShow: noop, onHide: noop }));
  assert.match(text(exampleView({ assist: null, pending: false, error: null })), /Show a validation example/);
  assert.match(exampleView({ assist: null, pending: true, error: null }), /aria-disabled="true"[^>]*>Checking example…/);

  const analysis = analyzeDispute(demo);
  const { facts } = buildAiRequest(demo, analysis);
  const assist = composeAiAssist(demo, analysis, facts, validationExampleAnswer(analysis, facts), VALIDATION_EXAMPLE_MODEL);
  const markup = exampleView({ assist, pending: false, error: null });
  const out = text(markup);
  assert.match(out, /VALIDATION EXAMPLE — NOT WRITTEN BY GEMINI\./);
  assert.match(out, /Written by validation example \(fixed test text, not Gemini\)\./);
  assert.match(out, /4 issues flagged/);
  assert.match(out, /Example wording/);
  assert.doesNotMatch(out, /AI wording/, "fixed example text is never called AI wording");
  assert.match(markup, /<details open="">/, "the unused text shows without an extra click");
  assert.doesNotMatch(markup, /<textarea/, "the example never becomes a draft");
  assert.match(out, /Hide validation example/);
});
