import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import type { Dispute, ParagraphClaim } from "../../shared/types.ts";
import { DEMO_DISPUTES } from "./app.ts";
import { checkMerchantDraft } from "./assist.ts";
import { analyzeDispute } from "./evidence.ts";
import { normalizeDetails, normalizeDispute } from "./paypal.ts";
import { buildProvenance } from "./provenance.ts";

// Paragraph claim mapping for the merchant's edit check (Phase 7.3). Synthetic records only; no PayPal or Gemini.
const demo: Dispute = { ...sample, source: "demo" };
const byId = (id: string) => DEMO_DISPUTES.find((d) => d.dispute_id === id)!;
const check = (d: Dispute, text: string) => checkMerchantDraft(d, analyzeDispute(d), text);
const claim = (d: Dispute, text: string): ParagraphClaim => {
  const result = check(d, text);
  assert.equal(result.claims.length, 1, text);
  return result.claims[0];
};
const support = (d: Dispute, text: string) => claim(d, text).support;
const withRecord = (order: Dispute["order"], evidence: Dispute["evidence"]): Dispute => ({ ...demo, order, evidence });

test("the known examples on the sample record (shipped, no tracking, no proof of delivery, communication on record)", () => {
  // DEMO-1001: SHIPPED, proof of delivery false, tracking false, order confirmation and communication true.
  assert.deepEqual(claim(demo, "We shipped the order."), {
    paragraph: 1,
    excerpt: "We shipped the order.",
    support: "supported",
    refs: ["demo:DEMO-1001:order.shipping_status"],
    reasons: [],
  });
  assert.deepEqual(claim(demo, "We sent the keyboard and the buyer has it now."), {
    paragraph: 1,
    excerpt: "We sent the keyboard and the buyer has it now.",
    support: "flagged",
    refs: [],
    reasons: ["Claims delivery, but proof of delivery is not available."],
  });
  assert.equal(support(demo, "The buyer received the item."), "flagged");
  assert.deepEqual(claim(demo, "We refunded the payment."), {
    paragraph: 1,
    excerpt: "We refunded the payment.",
    support: "unsupported",
    refs: [],
    reasons: ["No supporting record in DisputeDesk: DisputeDesk holds no refund records."],
  });
  // The communication record backs the fact of contact, never what the message said (Phase 8.2).
  assert.deepEqual(claim(demo, "We contacted the buyer.").refs, ["demo:DEMO-1001:evidence.customer_communication"]);
  assert.equal(support(demo, "We contacted the buyer."), "supported");
  assert.deepEqual(claim(demo, "We told the buyer about the delay.").reasons, [
    "No supporting record in DisputeDesk: the communication record shows that messages exist, not what they said.",
  ]);
});

test("tracking wording never backs delivery, and message content needs its own record (Phase 8.2)", () => {
  // DEMO-1002 (delivery contradicted) and DEMO-2013: tracking on record, proof of delivery not available.
  for (const id of ["DEMO-1002", "DEMO-2013"]) {
    for (const text of [
      "Tracking confirms the parcel reached the buyer.",
      "The tracking shows the package was delivered.",
      "Tracking confirms delivery.",
      "The parcel made it to the customer.",
      "It is in the buyer's hands.",
    ]) {
      const c = claim(byId(id), text);
      assert.equal(c.support, "flagged", `${id} ${text}`);
      assert.ok(c.reasons.includes("Claims delivery, but proof of delivery is not available."), `${id} ${text}`);
    }
  }
  // With proof of delivery on record the same sentence is backed by it.
  assert.ok(claim(byId("DEMO-1003"), "Tracking confirms the parcel reached the buyer.").refs.includes("demo:DEMO-1003:evidence.proof_of_delivery"));

  // DEMO-1001: tracking marked not available. Neither the message flag nor anything else backs the tracking content.
  const emailed = claim(demo, "We emailed the buyer the tracking number.");
  assert.equal(emailed.support, "unsupported");
  assert.deepEqual(emailed.refs, []);
  assert.ok(emailed.reasons.includes("No supporting record in DisputeDesk: shipping tracking is marked not available."));
  // Even with tracking on record, the message flag doesn't show what the email said.
  assert.equal(support(byId("DEMO-1003"), "We emailed the buyer the tracking number."), "unsupported");
  assert.equal(support(byId("DEMO-1003"), "We wrote to the buyer."), "supported");
  // "Reached out" is contact, not delivery.
  assert.equal(support(demo, "We reached out to the buyer."), "not_a_claim");
});

test("agreements, offers and attachments are claims, not ordinary sentences (Phase 8.2)", () => {
  assert.deepEqual(claim(demo, "The buyer agreed to keep the item.").reasons, ["Describes buyer messages, which are not in DisputeDesk's records."]);
  assert.deepEqual(claim(demo, "We offered the buyer a refund.").reasons, ["No supporting record in DisputeDesk: DisputeDesk holds no record of what was offered or promised."]);
  assert.deepEqual(claim(demo, "Please review the attached invoice.").reasons, [
    "No supporting record in DisputeDesk: DisputeDesk hasn't checked any file, so it can't back an attachment.",
  ]);
  // The order confirmation's own wording is not a buyer message.
  assert.equal(support(demo, "The order confirmation shows what the buyer agreed to pay for."), "not_a_claim");
});

test("active-voice and possession claims are caught when the records don't back them", () => {
  const pending = withRecord({ order_id: "ORDER-T1", item: "Wireless keyboard", shipping_status: "PENDING" }, { order_confirmation: true });
  for (const text of ["We shipped the order.", "We sent the keyboard and the buyer has it now.", "The order shipped quickly.", "We dispatched it."]) {
    const c = claim(pending, text);
    assert.equal(c.support, "flagged", text);
    assert.ok(c.reasons.includes("Claims the order was shipped, which the records do not show."), text);
  }
  for (const text of ["The buyer has the keyboard.", "They had it for a week.", "It is in their possession.", "The buyer received the item."]) {
    assert.deepEqual(claim(pending, text).reasons, ["Claims delivery, but proof of delivery is not available."], text);
  }
  // The same claims pass the checks when the records back them.
  const complete = byId("DEMO-1003");
  assert.equal(support(complete, "We shipped the order."), "supported");
  const received = claim(complete, "The buyer received the item.");
  assert.equal(received.support, "supported");
  assert.deepEqual(received.refs, ["demo:DEMO-1003:evidence.proof_of_delivery"]);
});

test("ordinary sentences are not read as claims", () => {
  const pending = withRecord({ order_id: "ORDER-T1", item: "Wireless keyboard", shipping_status: "PENDING" }, {});
  for (const text of [
    "Thank you for reviewing this dispute.",
    "We sent the buyer an email with our return policy.",
    "The buyer has the right to ask for a review.",
    "We will ship a replacement if the buyer asks.",
    "Please contact us with any questions.",
    "We have not refunded the payment.",
  ]) {
    assert.equal(support(pending, text), "not_a_claim", text);
  }
});

test("a factual claim with no record behind it is unsupported, and never filled in", () => {
  const bare = withRecord({ order_id: "ORDER-T2", item: "Desk lamp" }, { order_confirmation: false, customer_communication: false });
  assert.deepEqual(claim(bare, "We told the buyer about the delay.").reasons, ["No supporting record in DisputeDesk: customer communication is marked not available."]);
  assert.deepEqual(claim(bare, "We provided the tracking information.").reasons, ["No supporting record in DisputeDesk: shipping tracking is not on record."]);
  // Repeating a value that is on record does not back a different claim.
  const placed = claim(bare, "The buyer placed the order ORDER-T2.");
  assert.equal(placed.support, "unsupported");
  assert.deepEqual(placed.refs, []);
  // A value alone, with no other claim, names the order: backed by that record.
  assert.deepEqual(claim(bare, "This response concerns order ORDER-T2."), {
    paragraph: 1,
    excerpt: "This response concerns order ORDER-T2.",
    support: "supported",
    refs: ["demo:DEMO-1001:order.order_id"],
    reasons: [],
  });
});

test("a contested value is never supported", () => {
  // A tracking number on record while tracking is marked not available: the rules find a contradiction.
  const contested = withRecord({ order_id: "ORDER-T3", item: "Desk lamp", shipping_status: "SHIPPED", tracking_number: "DEMO-TRK-T3" }, { shipping_tracking: false });
  for (const text of ["Tracking number DEMO-TRK-T3.", "Our tracking number is DEMO-TRK-T3.", "We shipped the order with tracking DEMO-TRK-T3."]) {
    const c = claim(contested, text);
    assert.equal(c.support, "flagged", text);
    assert.deepEqual(c.refs, [], text);
    assert.match(c.reasons.join(" "), /contradict/, text);
  }
  // Every supported claim, on every demo record and sentence, rests only on verified, uncontested refs.
  const texts = [
    "We shipped the order.",
    "The buyer received the item.",
    "Our tracking number is DEMO-TRK-2005.",
    "The buyer placed the order.",
    "We told the buyer about the delay.",
    "This concerns order ORDER-1001 for USD 49.99.",
  ];
  for (const d of DEMO_DISPUTES) {
    const analysis = analyzeDispute(d);
    const refs = new Map(buildProvenance(d, analysis).refs.map((r) => [r.ref, r]));
    for (const text of texts) {
      for (const c of checkMerchantDraft(d, analysis, text).claims) {
        if (c.support !== "supported") continue;
        assert.ok(c.refs.length > 0, `${d.dispute_id} "${text}" supported with no refs`);
        for (const r of c.refs) assert.equal(refs.get(r)?.verification, "verified", `${d.dispute_id} "${text}" rests on ${r}`);
      }
    }
  }
});

test("paragraphs keep their numbers, and buyer quotes, markers and DisputeDesk's own lines are skipped", () => {
  const analysis = analyzeDispute(demo);
  const text = [
    analysis.draft.text,
    "> I never received it.",
    "We shipped the order.",
    "[MISSING: proof of delivery]",
    "The buyer received the item.",
    "Thank you for reviewing this dispute.",
  ].join("\n\n");
  const result = checkMerchantDraft(demo, analysis, text);
  assert.equal(result.checked, 3);
  assert.deepEqual(
    result.claims.map((c) => [c.paragraph, c.support]),
    [
      [1, "supported"],
      [2, "flagged"],
      [3, "not_a_claim"],
    ],
  );
  // Flags in claims and in the existing "flagged" list are the same paragraphs with the same reasons.
  assert.deepEqual(
    result.flagged,
    result.claims.filter((c) => c.support === "flagged").map(({ paragraph, excerpt, reasons }) => ({ paragraph, excerpt, reasons })),
  );
  // The unedited rule draft makes no claims of the merchant's own.
  assert.deepEqual(checkMerchantDraft(demo, analysis, analysis.draft.text).claims, []);
});

test("PayPal's message flag can't back a claim that the merchant contacted the buyer", () => {
  const raw = {
    dispute_id: "PP-D-T1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "20.00" },
    messages: [{ posted_by: "BUYER", content: "Where is my order?" }],
    disputed_transactions: [{ seller_transaction_id: "TX-T1", items: [{ item_name: "Test mug" }] }],
  };
  const d: Dispute = { ...normalizeDispute(raw), ...normalizeDetails(raw) };
  assert.deepEqual(claim(d, "We told the buyer about the delay.").reasons, [
    "No supporting record in DisputeDesk: the PayPal record has messages, but DisputeDesk can't tell who wrote them.",
  ]);
  // The seller transaction ID is a transaction record of the purchase.
  assert.deepEqual(claim(d, "The buyer placed the order.").refs, ["paypal_sandbox:PP-D-T1:evidence.order_confirmation"]);
});
