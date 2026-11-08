// UI tests: real components rendered to HTML (react-dom/server), fed by the real evidence engine and AI checks
// on synthetic records. No network: Gemini answers are canned objects, and fetch throws if called.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAiRequest, checkMerchantDraft, composeAiAssist } from "../../server/src/assist.ts";
import { assistWithRefs, withProvenance } from "../../server/src/provenance.ts";
import { buildChecklist } from "../../server/src/checklist.ts";
import { analyzeDispute } from "../../server/src/evidence.ts";
import { VALIDATION_EXAMPLE_MODEL, validationExampleAnswer } from "../../server/src/assist.ts";
import { AI_OFF_BAD_MODEL } from "../../server/src/config.ts";
import { AiResult, AiSectionView, AnalysisView, CheckResult, ChecklistView, ClaimAndRecords, DISCARD_EDITS, DraftEditor, ReadinessSummary, ValidationExampleView } from "./AnalysisPanel.tsx";
import { readiness } from "./analysis.ts";
import type { AiState, ExampleState } from "./AnalysisPanel.tsx";
import { AccountView } from "./Account.tsx";
import { AdminAccounts, AdminAudit, AdminOverview, AdminSettings, AdminSystem, ownerNames } from "./Admin.tsx";
import type { AdminAccount, AuditEntry, Health, Settings } from "./Admin.tsx";
import App, { BuyerHome, Dashboard, DisputesView } from "./App.tsx";
import { BuyerDisputes, ExplainView } from "./Buyer.tsx";
import type { ExplainState } from "./Buyer.tsx";
import { AI_WORDING_OFF, FAILED_CHECKS, buyerGuidance, rulesExplanation, toBuyerRecord } from "../../server/src/buyer.ts";
import type { SandboxLoad } from "./App.tsx";
import { DisputeDetail } from "./DisputeDetail.tsx";
import { DisputeList, readinessLine } from "./DisputeList.tsx";
import { Landing } from "./Landing.tsx";
import { Login, emailError, passwordError } from "./Login.tsx";
import { SIGNED_OUT_EVENT, serverError } from "./sandbox.ts";
import accountsFile from "../../demo-accounts.json" with { type: "json" };
import extraDemos from "../../demo-disputes.json" with { type: "json" };
import sample from "../../sample-dispute.json" with { type: "json" };
import type { AccountInfo, AiAssist, BuyerDispute, Dispute } from "../../shared/types.ts";

// Test fixture: the synthetic records the server serves. The page itself no longer bundles them.
const demoDisputes = [sample, ...extraDemos].map((record) => ({ ...record, source: "demo" })) as Dispute[];
const merchant: AccountInfo = { id: "merchant-a", email: "merchant-a@demo.disputedesk.test", role: "merchant", display_name: "Demo Merchant A", paypal_sandbox: true };
const admin: AccountInfo = { id: "admin", email: "admin@demo.disputedesk.test", role: "admin", display_name: "Demo Admin", paypal_sandbox: false };

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
  const page = text(html(createElement(Dashboard, { account: merchant, onSignOut: noop })));
  assert.match(page, /DEMO DATA — NOT A REAL PAYPAL DISPUTE/);
  assert.match(page, /Nothing here is connected to PayPal/);
  assert.match(page, /Demo Merchant A Merchant Sign out/);
  // The demo list comes from the server for this account, so the first render shows its loading state.
  assert.match(page, /Loading demo disputes…/);
  assert.doesNotMatch(page, /DEMO-100/, "no demo record is bundled into the page");

  const list = text(view(demoDisputes, { status: "ready", disputes: demoDisputes }));
  assert.match(list, /Demo dispute DEMO-1001/);
  assert.doesNotMatch(list, /PayPal sandbox dispute/);
  // Analysis runs on the server, so the first render shows its loading state.
  assert.match(list, /Analyzing evidence…/);
});

// ---- Sign-in and roles ----

test("before the server answers, the app shows only a session check", () => {
  const page = text(html(createElement(App)));
  assert.match(page, /Checking your session…/);
  assert.doesNotMatch(page, /DEMO-100|Sign out/);
});

test("the sign-in form is labeled, says the accounts are synthetic, and holds no credentials", () => {
  const out = html(createElement(Login, { notice: "Your session has ended. Sign in again to continue.", onSignedIn: noop }));
  assert.match(out, /<label for="login-email">Email<\/label>/);
  const input = (id: string) => out.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] ?? "";
  for (const attr of ['type="email"', 'name="email"', 'autoComplete="username"', 'required=""']) assert.ok(input("login-email").includes(attr), attr);
  for (const attr of ['type="password"', 'name="password"', 'autoComplete="current-password"', 'required=""']) assert.ok(input("login-password").includes(attr), attr);
  assert.match(text(out), /SYNTHETIC DEMO ACCOUNTS/);
  assert.match(text(out), /Never enter a real password here/);
  assert.match(out, /role="status">Your session has ended/);
  assert.doesNotMatch(out, /value=|demo-(admin|merchant|buyer)-/, "no prefilled or listed passwords");
});

test("sign-in field checks give a message per field, and none for a valid entry", () => {
  assert.equal(emailError(""), "Enter your email address.");
  assert.match(emailError("merchant-a") ?? "", /like name@example.com/);
  assert.equal(emailError(" merchant-a@demo.disputedesk.test "), undefined);
  assert.equal(passwordError(""), "Enter your password.");
  assert.equal(passwordError("x"), undefined);
  assert.match(html(createElement(Login, { notice: null, onSignedIn: noop })), /<form class="login-form" noValidate="">/i);
  // A server that can't be reached is announced as an alert (Phase 8.2).
  assert.match(html(createElement(Login, { notice: "Could not reach the server.", noticeIsError: true, onSignedIn: noop })), /role="alert">Could not reach the server/);
});

// ---- Landing page (signed out) ----

const landing = () => html(createElement(Landing, { onSignIn: noop }));

test("the landing page has one h1, a heading on every section, and sign-in buttons instead of a sign-up", () => {
  const out = landing();
  assert.equal(out.match(/<h1[ >]/g)?.length, 1);
  assert.match(text(out), /Every dispute, checked against the record\./);
  for (const id of ["hero-h", "how-h", "roles-h", "safeguards-h", "faq-h", "close-h"]) {
    assert.match(out, new RegExp(`aria-labelledby="${id}"[\\s\\S]*?<h[12] id="${id}"`), id);
  }
  for (const anchor of ["how", "roles", "safeguards", "faq"]) assert.match(out, new RegExp(`id="${anchor}"`), anchor);
  assert.ok((out.match(/<button[^>]*>Sign in( to the demo)?<\/button>/g) ?? []).length >= 3);
  assert.doesNotMatch(text(out), /get started|register|sign up|create an account/i, "no sign-up flow exists");
  const levels = [...out.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
  assert.ok(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1), `headings skip a level: ${levels.join(",")}`);
});

test("every product fragment on the landing page is labelled illustrative and holds no demo records or secrets", () => {
  const out = landing();
  const fragments = out.match(/data-ui="true"/g)?.length ?? 0;
  assert.ok(fragments >= 5, `${fragments} fragments`);
  assert.ok((text(out).match(/Illustrative example/g)?.length ?? 0) >= fragments);
  assert.doesNotMatch(out, /DEMO-\d|MOCK-|TRK-|@demo\.disputedesk|demo-(admin|merchant|buyer)-/, "no demo records, accounts or passwords");
  for (const fragment of out.match(/<figure data-ui="true"[\s\S]*?<\/figure>/g) ?? []) {
    assert.doesNotMatch(fragment, /style="/, "no inline styles in fragments, so the strict production CSP holds");
  }
});

test("the landing pane shows both sides the same facts, and the buyer's side never shows merchant evidence", () => {
  const out = landing();
  const faces = (side: string) => [...out.matchAll(new RegExp(`<div class="pane-face[^"]*" data-side="${side}"[^>]*>([\\s\\S]*?)Illustrative example\\. Not a real dispute\\.`, "g"))].map((m) => m[0]);
  const [merchant, buyer] = [faces("merchant"), faces("buyer")];
  assert.ok(merchant.length >= 2 && buyer.length === merchant.length, "every pane has both sides");
  const facts = (face: string) => text(face.match(/<dl[\s\S]*?<\/dl>/)?.[0] ?? "");
  for (let i = 0; i < merchant.length; i++) {
    assert.ok(facts(merchant[i]).includes("Awaiting seller"));
    assert.equal(facts(buyer[i]), facts(merchant[i]), "the shared lines are word for word the same");
    assert.doesNotMatch(text(buyer[i]), /Order confirmation|Shipping tracking|Proof of delivery|Customer communication/, "no merchant evidence");
    assert.match(buyer[i], /aria-hidden="true" inert=""/, "the side facing away starts hidden from assistive tech");
  }
});

test("the landing page makes no unsupported claims", () => {
  const page = text(landing());
  for (const claim of [/certified|compliant|guarantee|bank-grade|military/i, /prevent|win rate|\d+\s?%/i, /trusted by|customers/i]) {
    assert.doesNotMatch(page, claim, String(claim));
  }
  assert.match(page, /never submits/i);
  assert.match(page, /Not affiliated with or endorsed by PayPal or Google/);
});

test("the landing page's live draft starts undrafted and never offers a submission", () => {
  const out = landing();
  assert.match(out, /<button[^>]*type="button"[^>]*>Draft a response<\/button>/);
  assert.match(text(out), /Nothing is sent\. You send any response yourself\./);
  assert.doesNotMatch(text(out), /Submit (to|response)/i);
  assert.match(out, /aria-expanded="false" aria-controls="l-nav"/, "the phone menu starts closed");
  assert.ok([...out.matchAll(/<button[^>]*>/g)].every((b) => /type="button"/.test(b[0])), "no button submits a form");
});

// ---- Admin views: read-only, from the accounts, demo records and server configuration only ----

const demoAccounts = accountsFile.accounts.map(({ id, email, role, display_name, paypal_sandbox, dispute_ids }) => ({
  id,
  email,
  role,
  display_name,
  paypal_sandbox,
  dispute_ids,
})) as AdminAccount[];
const checkedAt = new Date(Date.UTC(2026, 10, 4, 9, 30));
const healthOn: Health = { checked_at: checkedAt, paypal_configured: true, ai: { on: true, model: "gemini-test-model" } };
const healthOff: Health = { checked_at: checkedAt, paypal_configured: false, ai: { on: false, reason: AI_OFF_BAD_MODEL } };
const CHANGING = /\b(Delete|Edit|Disable|Enable|Save|Suspend|Reset|Sync|Clear cache)\b/;

test("the admin dashboard opens on an overview, and merchants keep only Disputes and Insights", () => {
  const page = text(html(createElement(Dashboard, { account: admin, onSignOut: noop })));
  assert.match(page, /Workspace Overview Disputes Insights People Merchants Buyers Oversight Audit logs System health Admin settings You Account/);
  assert.match(page, /Loading the overview…/);
  const merchantPage = text(html(createElement(Dashboard, { account: merchant, onSignOut: noop })));
  assert.doesNotMatch(merchantPage, /Overview|Merchants|Buyers|System/);
});

test("the admin overview counts the real demo records, with no percentages and nothing that changes data", () => {
  const markup = html(createElement(AdminOverview, { accounts: demoAccounts, disputes: demoDisputes, health: healthOn, onOpen: noop, onStatus: noop, onSystem: noop }));
  const out = text(markup);
  assert.match(out, /Merchant accounts 3 Buyer accounts 2 Demo disputes 17 Unresolved 13/);
  assert.match(out, /Open 3 : show in Disputes Awaiting seller 4 : show in Disputes Awaiting buyer 2 : show in Disputes Under review 4 : show in Disputes Resolved 4/);
  assert.match(out, /Waiting for a response 6 demo disputes/);
  assert.match(out, /Credentials configured/);
  assert.doesNotMatch(out, /%|uptime|Healthy|incident/i);
  assert.doesNotMatch(out, CHANGING);
  assert.ok([...markup.matchAll(/<button[^>]*>/g)].every((b) => /type="button"/.test(b[0])));
  const levels = headingLevels(markup);
  assert.ok(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1), `headings skip a level: ${levels.join(",")}`);
});

test("admin account views list one role, show each account's disputes, and offer no account actions", () => {
  const merchants = text(html(createElement(AdminAccounts, { role: "merchant", accounts: demoAccounts, disputes: demoDisputes, onOpen: noop })));
  assert.match(merchants, /Merchant accounts 3 shown/);
  assert.match(merchants, /Demo Merchant A .*Demo Merchant B .*Demo Merchant C/);
  assert.doesNotMatch(merchants, /Demo Buyer|Demo Admin/);
  assert.match(merchants, /PayPal sandbox access Yes/);
  assert.match(merchants, /Read-only\. Accounts come from demo-accounts\.json/);
  assert.doesNotMatch(merchants, CHANGING);
  const buyers = text(html(createElement(AdminAccounts, { role: "buyer", accounts: demoAccounts, disputes: demoDisputes, onOpen: noop })));
  assert.match(buyers, /Buyer accounts 2 shown/);
  assert.doesNotMatch(buyers, /PayPal sandbox access|Demo Merchant/);
});

test("the system page reports only the server's configuration, and says it is not monitoring", () => {
  const on = text(html(createElement(AdminSystem, { health: healthOn, onRetry: noop })));
  assert.match(on, /Credentials configured/);
  assert.match(on, /On · gemini-test-model/);
  assert.match(on, /does not contact PayPal or Gemini, and there is no uptime or performance monitoring/);
  assert.match(on, /Audit logs shows the latest entries/);
  assert.doesNotMatch(on, /Healthy|\d+(\.\d+)?%|\d+ ms/);
  const off = text(html(createElement(AdminSystem, { health: healthOff, onRetry: noop })));
  assert.match(off, /Credentials not configured/);
  assert.match(off, /AI wording \(Gemini\) Off/);
  assert.ok(off.includes(AI_OFF_BAD_MODEL));
});

test("admin disputes can be narrowed by account, and a dispute with no listed owner says so", () => {
  const owners = ownerNames(demoAccounts);
  const markup = html(createElement(DisputesView, { disputes: [...demoDisputes, sandbox[1]], sandbox: { status: "loading" }, onRetry: noop, filter: "ALL", onFilter: noop, selectedId: null, onSelect: noop, owners }));
  const out = text(markup);
  assert.match(out, /Account All accounts Demo Merchant A Demo Merchant B Demo Merchant C/);
  assert.match(out, /Owner not listed/);
  assert.doesNotMatch(text(view(demoDisputes, { status: "loading" })), /All accounts|Owner not listed/, "merchants see no account filter");
});

test("the admin view is read-only: no sandbox switch is hidden, but there is no AI draft button", () => {
  const page = text(html(createElement(Dashboard, { account: admin, onSignOut: noop, initialView: "disputes" })));
  assert.match(page, /Admin \(read-only\)/);
  assert.match(page, /Demo data PayPal sandbox/, "admin can read both sources");

  const merchantB: AccountInfo = { ...merchant, id: "merchant-b", paypal_sandbox: false };
  assert.doesNotMatch(text(html(createElement(Dashboard, { account: merchantB, onSignOut: noop }))), /PayPal sandbox/);

  const analysis = analyzeDispute(demo);
  const readOnly = text(html(createElement(AnalysisView, { dispute: demo, analysis, canDraft: false })));
  assert.match(readOnly, /Admin view is read-only/);
  assert.doesNotMatch(readOnly, /Generate AI draft/);
  assert.match(readOnly, /Show a validation example/);
});

// What the server sends a buyer: the reduced record plus rule-based guidance.
const buyerView = (d: Dispute): BuyerDispute => {
  const r = toBuyerRecord(d);
  return { ...r, guidance: buyerGuidance(r) };
};
const buyerReady = (disputes: BuyerDispute[]) => html(createElement(BuyerDisputes, { load: { status: "ready", disputes }, onRetry: noop }));
const headingLevels = (markup: string) => [...markup.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));

test("buyers see their own disputes with guidance labelled by source, and nothing of the merchant's", () => {
  const markup = buyerReady(demoDisputes.slice(1, 3).map(buyerView));
  const out = text(markup);
  assert.match(out, /Your disputes 2 on this account/);
  assert.match(out, /DEMO-1002 .*DEMO-1003/);
  assert.match(out, /Demo dispute DEMO-1002 Awaiting seller/, "the first dispute's details are shown");
  for (const heading of ["What this status means", "Usual stages", "Next steps", "Information you may want to have", "Talking to the seller", "Not on record", "Plain-language explanation"]) {
    assert.ok(out.includes(heading), heading);
  }
  assert.match(out, /The dispute is waiting for the seller to respond./);
  assert.match(out, /Opened Oct 18, 2026 From the record/);
  assert.match(out, /Amount \$129\.00 From the record/);
  assert.match(out, /not a recorded history/);
  assert.match(out, /Response deadline/);
  assert.match(out, /DisputeDesk does not message the seller or the payment provider for you/);
  assert.match(out, /does not decide the dispute or predict its outcome/);
  assert.equal(markup.match(/aria-current="step"/g)?.length, 1);
  assert.match(markup, /<li class="stage" aria-current="step"><span class="stage-name">Seller and buyer respond<\/span><span class="stage-state">Current status/);
  for (const merchantOnly of ["DEMO-1001", "ORDER-1002", "DEMO-TRK-1002", "Bluetooth speaker", "nothing arrived at my door", "Evidence analysis", "Response draft", "Generate AI draft"]) {
    assert.ok(!out.includes(merchantOnly), merchantOnly);
  }
  // Provenance (Phase 7.4) is merchant-only.
  for (const provenance of ["Verified against record", "Conflicting", "No time on record", "Sources for the generated draft", "DisputeDesk's records", "demo:"]) {
    assert.ok(!out.includes(provenance), provenance);
  }
  assert.ok(!/ref-list|draft-sources|tag-v-|tag-claim-/.test(markup), "no provenance markup");
  assert.ok([...markup.matchAll(/<button[^>]*>/g)].every((b) => /type="button"/.test(b[0])), "no button submits a form");
  const levels = headingLevels(markup);
  assert.equal(levels[0], 2);
  assert.ok(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1), `headings skip a level: ${levels.join(",")}`);
});

test("a buyer record with missing or unknown fields says not on record instead of guessing", () => {
  const markup = buyerReady([buyerView({ ...demoDisputes[0], status: "SOMETHING_NEW", amount: null })]);
  const out = text(markup);
  assert.match(out, /Amount Not on record/);
  assert.match(out, /Opened Not on record/);
  assert.match(out, /does not recognise the status "SOMETHING_NEW"/);
  assert.match(out, /Not known/);
  assert.doesNotMatch(markup, /aria-current="step"/, "no stage is marked current for an unknown status");
  assert.match(out, /A status DisputeDesk recognises/);
});

test("buyer loading, empty and error states", () => {
  const loading = html(createElement(BuyerDisputes, { load: { status: "loading" }, onRetry: noop }));
  assert.match(loading, /role="status" aria-busy="true"/);
  assert.match(text(loading), /Loading your disputes…/);
  const empty = text(buyerReady([]));
  assert.match(empty, /You have no disputes/);
  const error = html(createElement(BuyerDisputes, { load: { status: "error", message: "Sign in to continue. (HTTP 401)" }, onRetry: noop }));
  assert.match(error, /role="alert"/);
  assert.match(text(error), /Couldn't load your disputes Sign in to continue\. \(HTTP 401\) Try again/);
});

test("the plain-language explanation is labelled as AI or standard wording, and says why", () => {
  const view = (state: ExplainState) => html(createElement(ExplainView, { state, onRun: noop }));
  const record = toBuyerRecord(demoDisputes[1]);
  const guidance = buyerGuidance(record);

  assert.match(text(view({ status: "idle" })), /checks every line .* Explain in plain language/);
  assert.match(view({ status: "loading" }), /aria-disabled="true"[^>]*>Writing explanation…/);
  const ai = text(view({ status: "ready", explanation: { source: "demo", dispute_id: "DEMO-1002", origin: "ai", model: "gemini-test-model", paragraphs: ["Checked wording."], fallback_reason: null, flags: [] } }));
  assert.match(ai, /AI wording \(checked\) Checked wording\./);
  assert.doesNotMatch(ai, /Standard explanation|Explain in plain language/);

  const off = text(view({ status: "ready", explanation: rulesExplanation(record, guidance, AI_WORDING_OFF) }));
  assert.match(off, /Standard explanation AI wording is off on this server/);
  assert.doesNotMatch(off, /AI wording \(checked\)/);
  const flagged = text(view({ status: "ready", explanation: rulesExplanation(record, guidance, FAILED_CHECKS, ["promises or predicts an outcome or refund"]) }));
  assert.match(flagged, /Checks the AI wording failed: promises or predicts an outcome or refund\./);
  assert.match(text(view({ status: "error", message: "Sign in to continue. (HTTP 401)" })), /Try again Sign in to continue/);
});

test("a not-signed-in reply from any endpoint sends the app back to sign-in", () => {
  const events: string[] = [];
  const target = new EventTarget();
  const realWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = target;
  target.addEventListener(SIGNED_OUT_EVENT, () => events.push("signed-out"));
  try {
    const err = serverError(new Response(null, { status: 401 }), { error: { code: "not_signed_in", message: "Sign in to continue." } });
    assert.equal(err.code, "not_signed_in");
    serverError(new Response(null, { status: 403 }), { error: { code: "forbidden", message: "Your account can't use this." } });
    assert.deepEqual(events, ["signed-out"], "only a missing session signs the app out");
  } finally {
    (globalThis as { window?: unknown }).window = realWindow;
  }
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

// ---- Evidence readiness and claim-and-records ----

const OUTCOME_WORDS = /%|\blikel|\bchances?\b|\bodds\b|\bwin|\blos[et]\b|\bpredict/i;
const FAULT_WORDS = /\b(fault|guilty|lying|liar|fraud\w*|blame\w*|in the right|in the wrong)\b/i;

test("readiness shows the rules' own counts, with no score or outcome", () => {
  const conflict = text(html(createElement(ReadinessSummary, { analysis: analyzeDispute(sandbox[0]) })));
  assert.match(conflict, /Key evidence on record 1 of 2/);
  assert.match(conflict, /Missing or unverified 2 2 missing, 0 unverified/);
  assert.match(conflict, /Conflicting records 1/);
  assert.match(conflict, /This is not a score and does not predict the outcome\./);

  assert.match(text(html(createElement(ReadinessSummary, { analysis: analyzeDispute(demo) }))), /Key evidence on record 0 of 2/);
  const credit = demoDisputes.find((d) => d.reason === "CREDIT_NOT_PROCESSED")!;
  assert.match(text(html(createElement(ReadinessSummary, { analysis: analyzeDispute(credit) }))), /No key evidence is defined for this reason, so this counts every item\./);

  for (const d of [...demoDisputes, ...sandbox]) {
    const analysis = analyzeDispute(d);
    const r = readiness(analysis);
    assert.equal(r.conflicts, analysis.contradictions.length, d.dispute_id);
    assert.equal(r.on_record + r.missing + r.unverified, r.total, d.dispute_id);
    assert.ok(r.key_on_record <= r.key_total, d.dispute_id);
    // The one disclaimer sentence is the only place "score" or "predict" may appear.
    const out = text(html(createElement(ReadinessSummary, { analysis }))).replace("This is not a score and does not predict the outcome.", "");
    assert.doesNotMatch(out, OUTCOME_WORDS, d.dispute_id);
    assert.doesNotMatch(out, /score/i, d.dispute_id);
  }
});

test("claim and records puts the buyer's words beside the records, never cites contested records, and assigns no fault", () => {
  const out = text(html(createElement(ClaimAndRecords, { dispute: sandbox[0], analysis: analyzeDispute(sandbox[0]) })));
  assert.match(out, /The buyer's message was not supplied\./);
  assert.match(out, /Tracking number: TRK-MOCK-1 order\.tracking_number/);
  assert.doesNotMatch(out, /Shipping status: Delivered/, "a contested record is not shown as a fact");
  assert.match(out, /Records disagree: The shipping status is "Delivered", but proof of delivery is marked not available\./);
  assert.match(out, /What the records leave out Not on record .*Proof of delivery: missing/);
  assert.match(out, /Missing from the records does not show that it did not happen\./);
  assert.match(out, /It does not decide who is right/);

  for (const d of demoDisputes) {
    const markup = text(html(createElement(ClaimAndRecords, { dispute: d, analysis: analyzeDispute(d) })));
    if (d.customer_message) assert.ok(markup.includes(text(d.customer_message).trim()), d.dispute_id);
    assert.doesNotMatch(markup, FAULT_WORDS, d.dispute_id);
  }
});

test("the open dispute links to readiness and claim and records, and quotes the buyer once", () => {
  const withMessage = demoDisputes.find((d) => d.customer_message)!;
  const out = text(html(createElement(DisputeDetail, { dispute: withMessage })));
  assert.match(out, /Facts Readiness Claim and records Checklist Evidence Contradictions Next steps Draft AI draft/);
  assert.doesNotMatch(out, /Customer message/);
});

test("buyers never see the merchant's claim-and-records view or the buyer message held on the merchant record", () => {
  for (const d of demoDisputes.filter((x) => x.customer_message)) {
    const shown = buyerView(d);
    assert.equal("customer_message" in shown, false);
    const out = text(buyerReady([shown]));
    assert.doesNotMatch(out, /Claim and records|What the records show|Evidence readiness|Key evidence on record/, d.dispute_id);
    assert.ok(!out.includes(text(d.customer_message!).trim()), d.dispute_id);
  }
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

test("a draft too long to check says so in the editor, and Check my edits is held back", () => {
  const checkFor = { source: "demo" as const, dispute_id: "DEMO-1001" };
  const long = html(createElement(DraftEditor, { id: "d", title: "Response draft", note: "n", generated: "x".repeat(8001), checkFor }));
  assert.match(text(long), /This draft has 8,001 characters\. Check my edits works on drafts up to 8,000/);
  assert.match(long, /aria-describedby="d-length"/);
  assert.match(long, /aria-disabled="true"[^>]*>Check my edits</);
  const ok = html(createElement(DraftEditor, { id: "d", title: "Response draft", note: "n", generated: "x".repeat(8000), checkFor }));
  assert.doesNotMatch(ok, /characters\. Check my edits/);
  assert.match(ok, /aria-disabled="false"[^>]*>Check my edits</);
});

// ---- No PayPal submission ----

test("no control in the workspace can submit, send or publish to PayPal", () => {
  const markup =
    html(createElement(DisputeDetail, { dispute: demo })) +
    html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) })) +
    aiView({ ...idle, run: 1, assist: assistFor(demo, demoAnswer) });
  const buttons = new Set([...markup.matchAll(/<button[^>]*>([^]*?)<\/button>/g)].map((m) => text(m[1]).trim()));
  assert.deepEqual([...buttons].sort(), ["Check my edits", "Copy draft", "Generate AI draft", "Generate again", "Reset to generated draft", "Show a validation example"]);
  assert.doesNotMatch(markup, /<form|action="/);
  assert.match(text(markup), /DisputeDesk never submits responses to PayPal automatically\./);
});

test("the dispute list shows each demo dispute's readiness counts in words, never a score", () => {
  const counts = Object.fromEntries(demoDisputes.map((d) => [d.dispute_id, readiness(analyzeDispute(d))]));
  const row = (list: Dispute[], r?: typeof counts) => text(html(createElement(DisputeList, { disputes: list, selectedId: undefined, onSelect: () => {}, readiness: r })));
  const all = row(demoDisputes, counts);
  for (const d of demoDisputes) assert.ok(all.includes(readinessLine(counts[d.dispute_id], d.reason)), d.dispute_id);
  assert.equal(readinessLine({ ...counts[demo.dispute_id], key_total: 2, key_on_record: 1, conflicts: 1 }), "Key evidence 1 of 2 · 1 conflict");
  assert.equal(readinessLine({ key_total: 0, key_on_record: 0, on_record: 3, total: 4, missing: 1, unverified: 0, conflicts: 0, markers: 1 }), "Evidence 3 of 4");
  // Every flag set still leaves the refund ID as a gap for refund reasons; other reasons get no such note.
  const allFlags = { key_total: 0, key_on_record: 0, on_record: 4, total: 4, missing: 0, unverified: 0, conflicts: 0, markers: 1 };
  assert.equal(readinessLine(allFlags, "CREDIT_NOT_PROCESSED"), "Evidence 4 of 4 · refund ID needed");
  assert.equal(readinessLine({ ...allFlags, conflicts: 1 }, "DUPLICATE_TRANSACTION"), "Evidence 4 of 4 · 1 conflict · refund ID needed");
  assert.equal(readinessLine(allFlags, "INCORRECT_AMOUNT"), "Evidence 4 of 4");
  assert.doesNotMatch(all, /score|ready to|strong|weak|win|chance|likely|%/i);
  assert.doesNotMatch(row(sandbox), /Key evidence|Evidence d/, "sandbox rows carry no counts");
});

test("the edit check is offered to merchants only and its result is advisory", () => {
  const analysis = analyzeDispute(demo);
  assert.match(html(createElement(AnalysisView, { dispute: demo, analysis })), />Check my edits</);
  assert.doesNotMatch(html(createElement(AnalysisView, { dispute: demo, analysis, canDraft: false })), /Check my edits/, "admin is read-only");

  const flagged = text(
    html(
      createElement(CheckResult, {
        result: {
          source: "demo",
          dispute_id: demo.dispute_id,
          checked: 2,
          markers_left: 1,
          flagged: [
            {
              paragraph: 2,
              excerpt: "We shipped it with UPS.",
              reasons: ["Names a carrier. No carrier is in DisputeDesk's records.", "Mentions a date or time. No dates are in DisputeDesk's records."],
            },
          ],
        },
      }),
    ),
  );
  assert.match(flagged, /1 paragraph mentions something that is not in the records DisputeDesk has. Confirm it from your own records before sending. 1 marker left/);
  assert.match(flagged, /Your paragraph 2.*We shipped it with UPS..*Names a carrier/);
  const reasonItems = html(createElement(CheckResult, { result: { source: "demo", dispute_id: "D", checked: 2, markers_left: 0, flagged: [{ paragraph: 2, excerpt: "x", reasons: ["A.", "B."] }] } }));
  assert.match(reasonItems, /<li>A\.<\/li><li>B\.<\/li>/, "each reason is its own line");
  assert.match(flagged, /never edits or blocks your text/);
  assert.doesNotMatch(flagged, /(removed|deleted|rejected|false|lie|wrong)/i, "flags ask for a check, they do not accuse");

  const clean = text(html(createElement(CheckResult, { result: { source: "demo", dispute_id: "D", checked: 1, markers_left: 0, flagged: [] } })));
  assert.match(clean, /Nothing in the paragraph you wrote goes beyond the records DisputeDesk has. 0 markers left/);
  const empty = text(html(createElement(CheckResult, { result: { source: "demo", dispute_id: "D", checked: 0, markers_left: 4, flagged: [] } })));
  assert.match(empty, /No text of your own to check yet/);
});

test("the client calls only DisputeDesk's own read and analysis endpoints", () => {
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  const urls = [...new Set([...sources.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(urls, ["/api/admin/accounts", "/api/admin/audit", "/api/admin/settings", "/api/analysis", "/api/analysis/ai", "/api/analysis/ai/example", "/api/analysis/check", "/api/analysis/checklist", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/buyer/disputes", "/api/buyer/explain", "/api/disputes", "/api/health", "/api/intelligence", "/api/intelligence/explain", "/api/sandbox/disputes"]);
  assert.equal((sources.match(/fetch\(/g) ?? []).length, 16, "each fetch call uses one of the endpoints above");
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

  // The first three are the Merchant A and B examples; DEMO-2001 to DEMO-2014 are the insights set for Merchant C.
  const list = text(view(demoDisputes.slice(0, 3), { status: "loading" }));
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

// ---- Phase 5: dispute insights ----

const { buildIntelligence, rulesIntelligenceExplanation } = await import("../../server/src/intelligence.ts");
const { InsightsExplainView, InsightsState, InsightsView } = await import("./Intelligence.tsx");
const NOV_4 = Date.UTC(2026, 10, 4);
const insightsOf = (ids: string[] | null, scope: "account" | "all" = "account") =>
  buildIntelligence(ids ? demoDisputes.filter((d) => ids.includes(d.dispute_id)) : demoDisputes, NOV_4, scope);
const merchantCIds = demoDisputes.filter((d) => d.dispute_id.startsWith("DEMO-20")).map((d) => d.dispute_id);
const insightsHtml = (ids: string[] | null, canExplain = true, scope: "account" | "all" = "account") =>
  html(createElement(InsightsView, { insights: insightsOf(ids, scope), canExplain }));
// Every "(N%)" must follow "of T" with T at or above the percentage minimum.
const buyer: AccountInfo = { id: "buyer-a", email: "buyer-a@demo.disputedesk.test", role: "buyer", display_name: "Demo Buyer A", paypal_sandbox: false };

test("every role gets an Account view in its rail, and buyers still open on Disputes", () => {
  assert.match(text(html(createElement(Dashboard, { account: admin, onSignOut: noop }))), /Overview Disputes Insights People Merchants Buyers Oversight Audit logs System health Admin settings You Account/);
  assert.match(text(html(createElement(Dashboard, { account: merchant, onSignOut: noop }))), /Workspace Disputes Insights You Account/);
  const buyerHome = text(html(createElement(BuyerHome, { account: buyer, onSignOut: noop })));
  assert.match(buyerHome, /Disputes Account/);
  assert.match(html(createElement(BuyerHome, { account: buyer, onSignOut: noop })), /<h1>Disputes<\/h1>/);
  const buyerAccount = html(createElement(BuyerHome, { account: buyer, onSignOut: noop, initialView: "account" }));
  assert.match(buyerAccount, /<h1>Account<\/h1>/);
  assert.match(text(buyerAccount), /DEMO ACCOUNT — SYNTHETIC/);
});

test("the account page shows the account read-only, for each role, with nothing that can't work", () => {
  for (const account of [merchant, { ...merchant, paypal_sandbox: false }, buyer, admin]) {
    const markup = html(createElement(AccountView, { account, onSignOut: noop }));
    const out = text(markup);
    for (const value of [account.display_name, account.email, account.id]) assert.ok(out.includes(value), value);
    assert.match(out, /Set in the demo data. It can't be changed here./);
    assert.match(out, /Follows your device/);
    assert.match(out, /Two-step sign-in./);
    // No form controls and no actions the app doesn't have: only Sign out.
    assert.doesNotMatch(markup, /<(input|select|textarea|form)|role="switch"/);
    assert.deepEqual([...markup.matchAll(/<button[^>]*>([^<]*)</g)].map((b) => b[1]), ["Sign out"]);
    assert.ok([...markup.matchAll(/<button[^>]*>/g)].every((b) => /type="button"/.test(b[0])));
    assert.doesNotMatch(out, /Edit profile|Change password|Verified|Connected|Sign out all|2FA/i);
    const levels = headingLevels(markup);
    assert.deepEqual([...new Set(levels)], [2]);
  }
  const reach = (account: AccountInfo) => text(html(createElement(AccountView, { account, onSignOut: noop })));
  assert.match(reach(merchant), /Can read sandbox disputes/);
  assert.match(reach({ ...merchant, paypal_sandbox: false }), /No sandbox access/);
  assert.doesNotMatch(reach({ ...merchant, paypal_sandbox: false }), /PayPal sandbox disputes, read-only/);
  assert.doesNotMatch(reach(buyer), /PayPal sandbox|draft responses/);
  assert.match(reach(buyer), /never shown to buyers/);
  assert.match(reach(admin), /Admin can't change accounts or disputes/);
});

test("signing out from the account page uses the app's sign-out handler", () => {
  const source = readFileSync(new URL("./Account.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick={onSignOut}/);
  assert.doesNotMatch(source, /fetch\(|from "\.\/(sandbox|auth|Admin)\.ts/);
});

const percentDenominators = (out: string) => [...out.matchAll(/of (\d+) \(\d+%\)/g)].map((m) => Number(m[1]));

test("the dashboard offers an Insights view, and the buyer home does not", () => {
  const page = text(html(createElement(Dashboard, { account: merchant, onSignOut: noop })));
  assert.match(page, /Disputes Insights/);
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const buyerHome = app.slice(app.indexOf("export function BuyerHome"));
  assert.doesNotMatch(buyerHome.slice(0, buyerHome.indexOf("\n}\n")), /Insights|intelligence/i);
  assert.doesNotMatch(readFileSync(new URL("./Buyer.tsx", import.meta.url), "utf8"), /\/api\/intelligence|Intelligence/);
});

test("Merchant C's insights show every suggestion with what was found, its records, why, an action and its limits", () => {
  const out = text(insightsHtml(merchantCIds));
  for (const h of ["About this data", "Suggestions to check", "Patterns found", "Evidence completeness", "Status", "Reasons", "By month opened", "Plain-language summary"]) {
    assert.match(out, new RegExp(h));
  }
  for (const title of ["Improve delivery confirmation records", "Keep a tracking record for every shipment", "Keep clearer customer communication records", "Keep transaction and refund records organized", "Resolve conflicting records", "Review unresolved disputes"]) {
    assert.match(out, new RegExp(`${title} (Moderate confidence|Limited data) What was detected .+? Supporting records DEMO-.+? Why it matters .+? Practical action .+? Limitation `), title);
  }
  assert.match(out, /Proof of delivery is missing or unverified in 6 of 7 item-not-received disputes/);
  assert.match(out, /DEMO-2003, DEMO-2005, DEMO-2007, DEMO-2009, DEMO-2011, DEMO-2013/);
  assert.match(out, /2026-05 .*2 disputes · 7 of 8 evidence items available/);
  assert.match(out, /They do not predict or change any dispute's outcome/);
  assert.ok(percentDenominators(out).every((n) => n >= 10), "percentages only with at least 10 disputes behind them");
  assert.match(out, /Unresolved 10 of 14 \(71%\)/);
  assert.match(out, /6 of 7 Recurring|Recurring .*6 of 7/, "a share of 7 is shown as a count");
  assert.doesNotMatch(out, /6 of 7 \(/);
});

test("with too little data the insights say so: counts only, no monthly view, limited confidence", () => {
  const a = text(insightsHtml(["DEMO-1001", "DEMO-1002"]));
  assert.doesNotMatch(a, /%/, "no percentage from two disputes");
  assert.match(a, /With fewer than 10 disputes, shares are shown as counts only/);
  assert.match(a, /Not enough dated disputes for a monthly view/);
  assert.match(a, /Below pattern minimum/);
  assert.match(a, /Review unresolved disputes Limited data/);
  assert.doesNotMatch(a, /Improve delivery confirmation records/, "two gaps are not a pattern");

  const b = text(insightsHtml(["DEMO-1003"]));
  assert.match(b, /Nothing to suggest yet/);
  assert.match(b, /No gaps, conflicts or waiting disputes were found/);
});

test("admin sees all demo merchants read-only, with no AI summary button", () => {
  const out = text(insightsHtml(null, false, "all"));
  assert.match(out, /All demo merchants \(read-only\)/);
  assert.doesNotMatch(out, /Summarize these insights|Plain-language summary/);
  const merchantView = text(insightsHtml(merchantCIds));
  assert.match(merchantView, /Your demo disputes/);
  assert.match(merchantView, /Summarize these insights/);
});

test("insights loading, error and empty states", () => {
  const state = (load: Parameters<typeof InsightsState>[0]["load"]) => text(html(createElement(InsightsState, { load, onRetry: noop, canExplain: true })));
  assert.match(state({ status: "loading" }), /Loading insights…/);
  assert.match(state({ status: "error", message: "Sign in to continue. (HTTP 401)" }), /Couldn't load insights Sign in to continue\. \(HTTP 401\) Try again/);
  assert.match(state({ status: "ready", insights: insightsOf([]) }), /No demo disputes on this account/);
});

test("the insights summary is labelled as checked AI wording or the standard summary, and says why", () => {
  const i = insightsOf(merchantCIds);
  const ready = (explanation: ReturnType<typeof rulesIntelligenceExplanation>) =>
    text(html(createElement(InsightsExplainView, { state: { status: "ready", explanation }, onRun: noop })));
  const standard = ready(rulesIntelligenceExplanation(i, "The AI wording did not pass DisputeDesk's checks, so this is the standard explanation.", ["claims a cause; the rules find gaps, not causes"]));
  assert.match(standard, /Standard explanation/);
  assert.match(standard, /did not pass DisputeDesk's checks/);
  assert.match(standard, /Checks the AI wording failed: claims a cause/);
  const ai = ready({ origin: "ai", model: "gemini-test-model", paragraphs: ["Checked wording."], fallback_reason: null, flags: [] });
  assert.match(ai, /AI wording \(checked\)/);
  const busy = html(createElement(InsightsExplainView, { state: { status: "loading" }, onRun: noop }));
  assert.match(busy, /aria-disabled="true"/);
  assert.match(busy, /aria-live="polite"/);
});

test("insights headings keep order, and every bar states its count in text", () => {
  const markup = insightsHtml(merchantCIds);
  const levels = headingLevels(markup);
  assert.ok(levels.every((l) => l === 2 || l === 3), "panels are h2, suggestion cards h3");
  const bars = [...markup.matchAll(/<li class="bar-row[^"]*">(.*?)<\/li>/g)].map((m) => text(m[1]));
  assert.ok(bars.length > 10);
  for (const bar of bars) assert.match(bar, /\d+ (of \d+|disputes?)/, bar);
  assert.match(markup, /<table class="evidence-table">/);
  assert.match(markup, /<th scope="col">Available<\/th>/);
});

test("admin audit logs name accounts and flag refused access; admin settings are read-only and hold no secrets", () => {
  const entries: AuditEntry[] = [
    { id: 2, at: 2_000, event: "dispute_access_denied", account_id: "merchant-b", dispute_id: "DEMO-1001", detail: "demo" },
    { id: 1, at: 1_000, event: "login_failed", account_id: null, dispute_id: null, detail: null },
  ];
  const audit = html(createElement(AdminAudit, { entries, accounts: demoAccounts as AdminAccount[], onRetry: noop }));
  assert.match(text(audit), /Access refused/);
  assert.match(text(audit), /Unknown email/);
  assert.match(audit, /badge badge-warn">Access refused/);
  assert.doesNotMatch(audit, /merchant-b<\/td>/, "account IDs show as display names");
  const settings: Settings = {
    session: { idle_minutes: 30, absolute_hours: 8 },
    sign_in: { max_failures: 10, max_failures_per_email: 50, max_failures_per_address: 100, window_minutes: 15 },
    paypal: { environment: "sandbox", configured: true, access: "read-only" },
    ai: { configured: false, model: null, reason: "No key" },
    audit: { append_only: true, shown: 200 },
  };
  const page = html(createElement(AdminSettings, { settings }));
  assert.match(text(page), /30 minutes/);
  assert.match(text(page), /from all addresses 50 in 15 minutes/);
  assert.match(text(page), /Refused by the database/);
  assert.doesNotMatch(page, /<(input|select|textarea|form)/, "nothing on the settings page can be edited");
  assert.ok([...page.matchAll(/<button[^>]*>/g)].length === 0);
});

// ---- Phase 7.4: provenance in the merchant workspace. Built from the server's own functions, no network. ----

test("evidence shows its verification state and every source: type, record, value, and no invented time", () => {
  const out = text(html(createElement(AnalysisView, { dispute: demo, analysis: withProvenance(demo, analyzeDispute(demo)) })));
  assert.match(out, /Order confirmation Verified against record Available/);
  assert.match(out, /Proof of delivery Key for this reason Missing Proof of delivery is not marked/);
  assert.match(out, /evidence\.order_confirmation = true Merchant-provided · Demo record ORDER-1001 · No time on record · Verified against record/);
  assert.match(out, /order\.tracking_number = not on record Delivery record · Demo record ORDER-1001 · No time on record · Missing/);
  assert.match(out, /DisputeDesk does not inspect the documents themselves/);
  assert.match(out, /"Verified against record" means the supplied record backs it and nothing in the records contradicts it/);
  // Reserved types are never shown as if DisputeDesk had them.
  assert.doesNotMatch(out, /Refund record|Document ·/);
});

test("contradicted evidence reads Conflicting, and sandbox values say how they were derived", () => {
  const out = text(html(createElement(AnalysisView, { dispute: sandbox[0], analysis: withProvenance(sandbox[0], analyzeDispute(sandbox[0])) })));
  assert.match(out, /Proof of delivery Key for this reason Conflicting/);
  assert.match(out, /Transaction record · PayPal sandbox record ORD-77/);
  assert.match(out, /Set because the PayPal record has a seller transaction ID\. That is a transaction record, not an order confirmation document\./);
});

test("the generated draft lists its sources, and an older analysis without provenance still renders as before", () => {
  const withRefs = text(html(createElement(AnalysisView, { dispute: demo, analysis: withProvenance(demo, analyzeDispute(demo)) })));
  assert.match(withRefs, /Sources for the generated draft The records each generated line rests on\. Your own edits are covered by Check my edits\./);
  assert.match(withRefs, /evidence\.order_confirmation/);
  const plain = text(html(createElement(AnalysisView, { dispute: demo, analysis: analyzeDispute(demo) })));
  assert.doesNotMatch(plain, /Sources for the generated draft|Verified against record/);
  assert.match(plain, /Based on: evidence\.order_confirmation = true/);
});

test("the edit check shows each paragraph's support in advisory words, with the records behind it", () => {
  const analysis = analyzeDispute(demo);
  const result = checkMerchantDraft(demo, analysis, "We shipped the order.\n\nWe refunded the payment.\n\nThe buyer received the item.\n\nThank you.");
  const out = text(html(createElement(CheckResult, { result })));
  assert.match(out, /1 paragraph mentions something that is not in the records DisputeDesk has/);
  assert.match(out, /Your paragraph 1 Backed by DisputeDesk's records "?We shipped the order\."? Records: order\.shipping_status/);
  assert.match(out, /Your paragraph 2 Not in DisputeDesk's records .*No supporting record in DisputeDesk: DisputeDesk holds no refund records\./);
  assert.match(out, /Your paragraph 3 Check against your records .*Claims delivery, but proof of delivery is not available\./);
  assert.match(out, /Your paragraph 4 No factual claim found/);
  assert.doesNotMatch(out, /(removed|deleted|rejected|false|lie|wrong|verified)/i, "claims ask for a check; they never accuse or certify");

  // No flags but an unsupported claim: the summary does not say everything is on record.
  const unsupported = text(html(createElement(CheckResult, { result: checkMerchantDraft(demo, analysis, "We refunded the payment.") })));
  assert.match(unsupported, /1 paragraph makes a claim DisputeDesk has no record for\. Confirm it from your own records before sending\./);
  assert.doesNotMatch(unsupported, /goes beyond/);
});

test("AI cites name the record field they point to, and the AI draft lists its sources", () => {
  const analysis = analyzeDispute(demo);
  const { facts } = buildAiRequest(demo, analysis);
  const assist = assistWithRefs(demo, composeAiAssist(demo, analysis, facts, validationExampleAnswer(analysis, facts), VALIDATION_EXAMPLE_MODEL));
  const out = text(html(createElement(AiResult, { assist, id: "ai-draft-DEMO-1001", onRegenerate: noop })));
  assert.match(out, /Cites: R5 Order confirmation = marked available \(evidence\.order_confirmation\)/);
  assert.match(out, /Sources for the generated draft/);
  assert.doesNotMatch(out, /demo:DEMO-1001:/, "raw ref IDs are shown as field names");
});

// ---- Stage 2.1b: evidence checklist section. ----

const checklistOf = (d: Dispute) => {
  const analysis = withProvenance(d, analyzeDispute(d));
  const refsById = new Map(analysis.provenance!.refs.map((r) => [r.ref, r]));
  return { checklist: buildChecklist(d, analyzeDispute(d)), refsById };
};
const checklistHtml = (d: Dispute) => {
  const { checklist, refsById } = checklistOf(d);
  return html(createElement(ChecklistView, { load: { status: "ready", checklist }, refsById, onRetry: noop }));
};

test("the checklist shows every status and tier as text, across the demo records", () => {
  const all = text(demoDisputes.map(checklistHtml).join(" "));
  for (const label of ["Available in records", "Missing from records", "Conflicting records", "Confirm from your records", "Not applicable to this reason"]) {
    assert.ok(all.includes(label), label);
  }
  assert.match(all, /General guidance/);
  assert.match(all, /DisputeDesk guidance/);
  assert.doesNotMatch(all, /PayPal-documented/, "no item is labelled official");
  assert.match(all, /Missing from the records does not show that it did not happen/);
});

test("gap guidance and not-applicable items stay folded, and the section has no AI or write buttons", () => {
  const duplicate = demoDisputes.find((d) => d.reason === "DUPLICATE_TRANSACTION")!;
  const out = checklistHtml(duplicate);
  assert.doesNotMatch(out, /<details[^>]*\sopen/, "nothing opens by itself");
  assert.match(text(out), /Not applicable to this reason \(2\)/);
  assert.match(text(out), /How to fill this gap/);
  assert.match(text(out), /Where you might find it .* Check before adding .* What DisputeDesk can't see/);
  assert.doesNotMatch(out, /<button|<form|<input|<textarea/);
});

test("an unmapped reason says the checklist is generic", () => {
  const out = text(checklistHtml({ ...demo, reason: "INCORRECT_AMOUNT" }));
  assert.match(out, /No reason-specific checklist for this reason; showing general evidence/);
  assert.doesNotMatch(text(checklistHtml(demo)), /No reason-specific checklist/);
});

test("the checklist shows loading and error states with a retry", () => {
  const refsById = new Map();
  const loading = html(createElement(ChecklistView, { load: { status: "loading" }, refsById, onRetry: noop }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the checklist/);
  const error = text(html(createElement(ChecklistView, { load: { status: "error", message: "Server unavailable." }, refsById, onRetry: noop })));
  assert.match(error, /Couldn't load the checklist\. Server unavailable\. Try again/);
});

test("the analysis view places the checklist between claim and records and the evidence analysis", () => {
  const out = html(createElement(AnalysisView, { dispute: demo, analysis: withProvenance(demo, analyzeDispute(demo)) }));
  const at = (id: string) => out.indexOf(`id="${id}"`);
  assert.ok(at("case-sides") < at("case-checklist") && at("case-checklist") < at("case-evidence"));
});
