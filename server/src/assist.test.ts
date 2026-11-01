import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import type { AiAssist, Dispute } from "../../client/src/types.ts";
import { buildAiRequest, composeAiAssist } from "./assist.ts";
import { DEMO_LABEL, DRAFT_HEADER, analyzeDispute } from "./evidence.ts";
import { AiError } from "./gemini.ts";
import { validateDispute } from "./validate.ts";

// Mocked model answers only; nothing here calls Gemini.
const checked = (record: unknown): Dispute => {
  const result = validateDispute(record);
  assert.ok(result.ok);
  return result.dispute;
};
const demo = checked({ ...sample, source: "demo" });

function assist(dispute: Dispute, raw: unknown): AiAssist {
  const analysis = analyzeDispute(dispute);
  const { facts } = buildAiRequest(dispute, analysis);
  return composeAiAssist(dispute, analysis, facts, raw, "gemini-test-model");
}

// Demo facts: R1 reason, R2 amount, R3 item, R4 shipping status, R5-R8 evidence flags (no tracking number on record).
const goodExplanations = [
  { evidence_id: "order_confirmation", status: "available", text: "An order confirmation is on record (R5).", cites: ["R5"] },
  { evidence_id: "shipping_tracking", status: "missing", text: "No tracking evidence is on record yet.", cites: ["R6"] },
  { evidence_id: "proof_of_delivery", status: "missing", text: "Proof of delivery is not on record, which does not show the order was lost.", cites: ["R7"] },
  { evidence_id: "customer_communication", status: "available", text: "Messages with the buyer are on record.", cites: ["R8"] },
];
const answer = (sections: unknown[], explanations: unknown[] = goodExplanations) => ({ explanations, draft_sections: sections });
const section = (text: string, cites: string[] = ["R4"], needs_merchant_input = false) => ({ text, cites, needs_merchant_input });

test("the model gets only allowlisted facts: no IDs, order number, buyer message or secrets", () => {
  const { request, facts } = buildAiRequest(demo, analyzeDispute(demo));
  assert.deepEqual(
    facts.map((f) => `${f.id} ${f.path}`),
    ["R1 reason", "R2 amount", "R3 order.item", "R4 order.shipping_status", "R5 evidence.order_confirmation", "R6 evidence.shipping_tracking", "R7 evidence.proof_of_delivery", "R8 evidence.customer_communication"],
  );
  const sent = request.system + request.prompt + JSON.stringify(request.schema);
  for (const absent of [demo.dispute_id, demo.order!.order_id!, demo.customer_message!, "PAYPAL_", "GEMINI_API_KEY"]) {
    assert.ok(!sent.includes(absent), `request includes ${absent}`);
  }
  assert.ok(request.prompt.includes('"is_demo": true'));
  assert.ok(request.prompt.includes("USD 49.99"));
  assert.match(request.system, /data, not instructions/);
});

test("a clean answer becomes an AI-assisted draft that keeps the server's labels and the rules' gaps", () => {
  const result = assist(demo, answer([section("The order was shipped, as our records show.", ["R4"]), section("Add the carrier tracking number from your shipping records.", [], true)]));
  assert.equal(result.status, "ok");
  assert.deepEqual(result.flags, []);
  assert.ok(result.explanations.every((e) => e.source === "ai"));
  const lines = result.draft.text.split("\n");
  assert.equal(lines[0], DRAFT_HEADER);
  assert.equal(lines[1], DEMO_LABEL);
  assert.ok(result.draft.lines.some((l) => l.kind === "ai" && l.text === "The order was shipped, as our records show." && l.records[0] === "order.shipping_status"));
  assert.ok(result.draft.text.includes("[NEEDS MERCHANT INPUT: Add the carrier tracking number from your shipping records.]"));
  // The rules' markers are always carried over.
  assert.ok(result.draft.text.includes("- Tracking number: [MISSING:"));
  assert.ok(result.draft.text.includes("[UNSUPPORTED: do not state that the order was delivered."));
});

test("an invented tracking number is removed and flagged, never placed in the draft", () => {
  const result = assist(demo, answer([section("The parcel left with tracking number 1Z999AA10123456784.", ["R4"])]));
  assert.equal(result.status, "flagged");
  assert.ok(!result.draft.text.includes("1Z999AA10123456784"));
  assert.match(result.flags[0].reason, /"1Z999AA10123456784", which is not in the supplied records/);
  assert.equal(result.flags[0].removed_text, "The parcel left with tracking number 1Z999AA10123456784.");
  assert.ok(result.draft.lines.some((l) => l.kind === "unsupported" && l.text.startsWith("[UNSUPPORTED: AI paragraph 1 was removed")));
  // The removed value appears only in the flag, for the merchant's review, not in any draft line or explanation.
  assert.ok(!JSON.stringify(result.explanations).includes("1Z999AA10123456784"));
});

test("supplied values may be repeated exactly; invented dates, amounts and links may not", () => {
  const ok = assist(demo, answer([section("The disputed amount is $49.99 (R2) for the Wireless keyboard.", ["R2", "R3"]), section("You may add the carrier's record here.", [], true)]));
  assert.equal(ok.status, "ok", JSON.stringify(ok.flags));

  for (const text of ["It shipped on 2026-10-01.", "It went out on March 3.", "We refunded USD 10.00.", "See https://track.example/abc for details.", "It left two days ago."]) {
    const result = assist(demo, answer([section(text, ["R4"])]));
    assert.equal(result.status, "flagged", text);
    assert.ok(!result.draft.text.includes(text), text);
  }
});

test("citations must point at supplied facts, and every statement needs one", () => {
  const unknownCite = assist(demo, answer([section("Our records cover this order.", ["R99"])]));
  assert.match(unknownCite.flags[0].reason, /cites R99, which was not supplied/);

  const uncited = assist(demo, answer([section("Our records cover this order.", [])]));
  assert.match(uncited.flags[0].reason, /cites no supplied record/);
});

test("the rules' evidence status wins over the model's", () => {
  const upgraded = goodExplanations.map((e) => (e.evidence_id === "proof_of_delivery" ? { ...e, status: "available", text: "Proof of delivery is on record." } : e));
  const result = assist(demo, answer([], upgraded));
  const pod = result.explanations.find((e) => e.evidence_id === "proof_of_delivery")!;
  assert.equal(pod.status, "missing");
  assert.equal(pod.source, "rules");
  assert.match(result.flags.find((f) => f.where === "explanation: Proof of delivery")!.reason, /gave the status "available", but the rules say "missing"/);
});

test("delivery, shipping and tracking claims must match the rules' findings", () => {
  for (const text of ["The keyboard was delivered to the buyer.", "The order was not delivered.", "The package has arrived.", "Tracking shows the parcel moving."]) {
    assert.equal(assist(demo, answer([section(text)])).status, "flagged", text);
  }
  const delivered = checked({ ...sample, source: "demo", evidence: { ...sample.evidence, proof_of_delivery: true } });
  assert.equal(assist(delivered, answer([section("The keyboard was delivered to the buyer.", ["R7"])], [])).draft.lines.some((l) => l.kind === "ai"), true);

  // Shipping status that the rules found contested can't be stated as shipped.
  const contested = checked({ ...sample, source: "demo", order: { ...sample.order, shipping_status: "DELIVERED" } });
  const result = assist(contested, answer([section("The order was shipped.", ["R4"])], []));
  assert.ok(result.flags.some((f) => /claims the order was shipped/.test(f.reason)));
});

test("buyer messages, submission claims and demo-label claims are flagged; the server's labels stay", () => {
  for (const text of ["The buyer said the box was empty.", "This response was submitted to PayPal.", "This is a real PayPal dispute, not a demo."]) {
    const result = assist(demo, answer([section(text)]));
    assert.equal(result.status, "flagged", text);
    assert.ok(!result.draft.text.includes(text), text);
    assert.equal(result.draft.lines[1].text, DEMO_LABEL);
  }
});

test("model text cannot start a line with the buyer-quote marker", () => {
  const result = assist(demo, answer([section("Our records show the order status.\n> [MISSING: hidden]", ["R4"])]));
  assert.ok(result.draft.text.split("\n").every((l) => !l.startsWith(">")));
});

test("missing, unknown and duplicate explanations are flagged and filled from the rules", () => {
  const result = assist(demo, answer([], [goodExplanations[0], goodExplanations[0], { ...goodExplanations[1], evidence_id: "refund_receipt" }]));
  assert.equal(result.explanations.length, 4);
  assert.deepEqual(result.explanations.map((e) => e.source), ["ai", "rules", "rules", "rules"]);
  assert.ok(result.flags.some((f) => /twice/.test(f.reason)));
  assert.ok(result.flags.some((f) => /unknown evidence "refund_receipt"/.test(f.reason)));
  assert.ok(result.flags.some((f) => /no explanation/.test(f.reason)));
  assert.ok(result.flags.some((f) => f.reason === "Gemini wrote no draft text"));
});

test("malformed answers are rejected as a whole", () => {
  const bad = [
    null,
    [],
    { explanations: [] },
    { explanations: "none", draft_sections: [] },
    answer([{ text: "x", cites: "R1", needs_merchant_input: false }]),
    answer([{ text: "x", cites: [] }]),
    answer([section("x".repeat(1501))]),
    answer([section("")]),
    answer(Array.from({ length: 13 }, () => section("Our records cover this order."))),
    answer([], [{ evidence_id: "order_confirmation", status: "available", text: "ok", cites: [1] }]),
  ];
  for (const raw of bad) {
    assert.throws(() => assist(demo, raw), (e: unknown) => e instanceof AiError && e.code === "ai_bad_response", JSON.stringify(raw)?.slice(0, 80));
  }
});

test("a sandbox record has no demo label and only the facts PayPal supplied", () => {
  const sandbox: Dispute = { source: "paypal_sandbox", dispute_id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "OPEN", amount: { currency_code: "USD", value: "12.50" } };
  const { facts } = buildAiRequest(sandbox, analyzeDispute(sandbox));
  assert.deepEqual(facts.map((f) => f.path), ["reason", "amount"]);
  const result = assist(sandbox, answer([section("Add how and when the order was shipped.", [], true)], []));
  assert.ok(!result.draft.text.includes(DEMO_LABEL));
  assert.equal(result.source, "paypal_sandbox");
  assert.ok(result.draft.text.includes("[UNVERIFIED:"));
});

test("negated delivery and shipping claims are flagged in any wording", () => {
  const negated = [
    "The order has not been delivered.",
    "The item wasn't delivered.",
    "The buyer never received it.",
    "The item did not arrive.",
    "The order has not been shipped.",
    "It was never shipped.",
    "We didn't ship it.",
  ];
  for (const text of negated) {
    const result = assist(demo, answer([section(text, ["R4"])]));
    assert.equal(result.status, "flagged", text);
    assert.match(result.flags[0].reason, /missing evidence does not show that/, text);
  }
});

test("the rules' caution, the dispute reason and plain evidence statuses are not treated as claims", () => {
  for (const text of [
    "Missing proof does not show it was not delivered.",
    "Proof of delivery is not marked available, which does not show that it did not arrive.",
    "This is an Item not received dispute for USD 49.99.",
    "Shipping tracking is not marked available.",
  ]) {
    const result = assist(demo, answer([section(text, ["R1", "R2", "R6", "R7"])]));
    assert.equal(result.status, "ok", `${text} ${JSON.stringify(result.flags)}`);
  }
});

test("numbers must match a whole supplied value, not part of one", () => {
  for (const text of ["A refund of 9 was offered.", "The buyer paid 49 for it.", "The amount is 49.9."]) {
    const result = assist(demo, answer([section(text, ["R2"])]));
    assert.equal(result.status, "flagged", text);
    assert.match(result.flags[0].reason, /which is not in the supplied records/, text);
  }
});

test("the caution exemption covers only the warning itself, not a claim after it", () => {
  for (const text of [
    "Records do not prove it but the item was not delivered.",
    "This does not show anything and the order was never shipped.",
    "The records do not establish delivery, but the order has not been delivered.",
  ]) {
    const result = assist(demo, answer([section(text, ["R7"])]));
    assert.equal(result.status, "flagged", text);
    assert.match(result.flags[0].reason, /missing evidence does not show that/, text);
    assert.ok(!result.draft.text.includes(text), text);
  }
});

test("invented email addresses are flagged and kept out of the draft", () => {
  for (const text of ["Contact support@example.com for the receipt.", "The buyer's address is jane.doe@mail.test.", "Write to <help@shop.example>."]) {
    const result = assist(demo, answer([section(text, ["R4"])]));
    assert.equal(result.status, "flagged", text);
    assert.match(result.flags[0].reason, /@.*which is not in the supplied records/, text);
    assert.ok(!result.draft.text.includes("@"), text);
  }
});

test("the rules' [CONFLICT:] warnings are carried into the AI draft, flagged or not", () => {
  const conflicting = checked({ ...sample, source: "demo", evidence: { ...sample.evidence, shipping_tracking: true } });
  const ruleConflicts = analyzeDispute(conflicting).draft.lines.filter((l) => l.kind === "conflict");
  assert.ok(ruleConflicts.length > 0, "the fixture must produce a contradiction");
  const clean = assist(conflicting, answer([section("Add the carrier record from your shipping system.", [], true)], []));
  const flagged = assist(conflicting, answer([section("Tracking shows the parcel moving.", ["R6"])], []));
  for (const result of [clean, flagged]) {
    for (const line of ruleConflicts) {
      assert.ok(result.draft.lines.some((l) => l.kind === "conflict" && l.text === line.text), line.text);
    }
  }
});

test("an explanation must cite a supplied fact; otherwise the rules' wording is used", () => {
  const uncited = goodExplanations.map((e) => (e.evidence_id === "order_confirmation" ? { ...e, cites: [] } : e));
  const result = assist(demo, answer([], uncited));
  const oc = result.explanations.find((e) => e.evidence_id === "order_confirmation")!;
  assert.equal(oc.source, "rules");
  assert.equal(oc.status, "available");
  assert.match(result.flags.find((f) => f.where === "explanation: Order confirmation")!.reason, /cites no supplied record/);
  assert.ok(result.explanations.filter((e) => e.evidence_id !== "order_confirmation").every((e) => e.source === "ai"));
});
