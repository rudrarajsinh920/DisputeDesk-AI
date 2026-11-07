import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import type { Dispute, EvidenceKey, Provenance } from "../../shared/types.ts";
import { DEMO_DISPUTES } from "./app.ts";
import { analyzeDispute } from "./evidence.ts";
import { normalizeDetails, normalizeDispute } from "./paypal.ts";
import { buildProvenance } from "./provenance.ts";

// Synthetic records only. Nothing here talks to PayPal or Gemini.
const demo: Dispute = { ...sample, source: "demo" };
const provenanceOf = (d: Dispute) => buildProvenance(d, analyzeDispute(d));
const state = (p: Provenance, id: EvidenceKey) => p.findings.find((f) => f.evidence_id === id)!.verification;
const refOf = (p: Provenance, field: string) => p.refs.find((r) => r.field === field);
const withRecord = (order: Dispute["order"], evidence: Dispute["evidence"]): Dispute => ({ ...demo, order, evidence });

test("verification follows the rules: available is verified, false is missing, not supplied is unverified", () => {
  const p = provenanceOf(
    withRecord(
      { order_id: "ORDER-T1", item: "Test lamp", shipping_status: "DELIVERED", tracking_number: "DEMO-TRK-T1" },
      { order_confirmation: true, shipping_tracking: true, proof_of_delivery: true, customer_communication: false },
    ),
  );
  assert.equal(state(p, "order_confirmation"), "verified");
  assert.equal(state(p, "shipping_tracking"), "verified");
  assert.equal(state(p, "proof_of_delivery"), "verified");
  assert.equal(state(p, "customer_communication"), "missing");

  const unsupplied = provenanceOf(withRecord(undefined, {}));
  for (const f of unsupplied.findings) assert.equal(f.verification, "unverified", f.evidence_id);
});

test("every contradiction rule marks its own evidence as conflicting", () => {
  const order = { order_id: "ORDER-T2", item: "Test lamp" };
  // Tracking marked available with no number; a number with tracking marked not available.
  assert.equal(state(provenanceOf(withRecord({ ...order, tracking_number: null }, { shipping_tracking: true })), "shipping_tracking"), "conflicting");
  assert.equal(state(provenanceOf(withRecord({ ...order, tracking_number: "DEMO-TRK-T2" }, { shipping_tracking: false })), "shipping_tracking"), "conflicting");
  // Proof of delivery while the order is not shipped; delivered while proof is marked not available (the rules say missing).
  assert.equal(state(provenanceOf(withRecord({ ...order, shipping_status: "PENDING" }, { proof_of_delivery: true })), "proof_of_delivery"), "conflicting");
  const delivered = provenanceOf(withRecord({ ...order, shipping_status: "DELIVERED" }, { proof_of_delivery: false, shipping_tracking: false }));
  assert.equal(state(delivered, "proof_of_delivery"), "conflicting");
  assert.equal(refOf(delivered, "order.shipping_status")!.verification, "conflicting");
  // A delivery conflict does not spill onto tracking, even though both findings cite the shipping status.
  assert.equal(state(delivered, "shipping_tracking"), "missing");
});

test("verification never disagrees with the evidence engine, and the analysis is left untouched", () => {
  for (const d of DEMO_DISPUTES) {
    const analysis = analyzeDispute(d);
    const before = structuredClone(analysis);
    const p = buildProvenance(d, analysis);
    assert.deepEqual(analysis, before, d.dispute_id);
    for (const f of analysis.evidence) {
      const v = state(p, f.id);
      if (v === "verified") assert.equal(f.status, "available", `${d.dispute_id} ${f.id}`);
      if (f.status === "available") assert.equal(v, "verified", `${d.dispute_id} ${f.id}`);
      if (v === "missing") assert.equal(f.status, "missing", `${d.dispute_id} ${f.id}`);
      if (v === "unverified") assert.equal(f.status, "unverified", `${d.dispute_id} ${f.id}`);
    }
  }
});

test("refs are stable, unique, labelled demo and cover everything the analysis cites", () => {
  for (const d of DEMO_DISPUTES) {
    const analysis = analyzeDispute(d);
    const p = buildProvenance(d, analysis);
    assert.deepEqual(buildProvenance(d, analyzeDispute(d)), p, `${d.dispute_id}: not deterministic`);
    const ids = p.refs.map((r) => r.ref);
    assert.equal(new Set(ids).size, ids.length, `${d.dispute_id}: duplicate refs`);
    for (const r of p.refs) {
      assert.equal(r.ref, `demo:${d.dispute_id}:${r.field}`);
      assert.equal(r.origin, "demo_fixture");
      assert.equal(r.derivation, null);
      // No evidence field carries a time, and the database's import time is never used as one.
      assert.equal(r.recorded_at, null);
      assert.ok(r.source_type !== "refund_record" && r.source_type !== "document", `${r.ref} claims a record DisputeDesk does not have`);
    }
    const cited = [
      ...p.findings.flatMap((f) => f.refs),
      ...analysis.contradictions.flatMap((c) => c.records.map((r) => `demo:${d.dispute_id}:${r.path}`)),
      ...analysis.draft.lines.flatMap((l) => l.records.map((path) => `demo:${d.dispute_id}:${path}`)),
    ];
    for (const ref of cited) assert.ok(ids.includes(ref), `${ref} is cited but has no ref`);
  }
});

test("each field gets its source type, record ID and value as supplied", () => {
  const p = provenanceOf(demo);
  const ref = (field: string) => refOf(p, field)!;
  assert.deepEqual(
    { type: ref("order.tracking_number").source_type, id: ref("order.tracking_number").record_id, value: ref("order.tracking_number").value, v: ref("order.tracking_number").verification },
    { type: "delivery_record", id: "ORDER-1001", value: null, v: "missing" },
  );
  assert.equal(ref("order.item").source_type, "order_record");
  assert.equal(ref("order.item").value, "Wireless keyboard");
  assert.equal(ref("evidence.order_confirmation").source_type, "merchant_provided");
  assert.equal(ref("evidence.proof_of_delivery").source_type, "delivery_record");
  assert.deepEqual([ref("amount").source_type, ref("amount").record_id, ref("amount").value], ["dispute_record", "DEMO-1001", "USD 49.99"]);
  // The buyer's claim is on record, but it is a claim: never verified.
  assert.deepEqual([ref("customer_message").source_type, ref("customer_message").verification], ["buyer_statement", "unverified"]);
  // Fields the record doesn't have and the analysis doesn't cite are left out, not listed as gaps.
  assert.equal(refOf(p, "seller_response_due_date"), undefined);
  assert.deepEqual(
    p.findings.find((f) => f.evidence_id === "shipping_tracking")!.refs,
    ["demo:DEMO-1001:evidence.shipping_tracking", "demo:DEMO-1001:order.tracking_number", "demo:DEMO-1001:order.shipping_status"],
  );
});

test("a PayPal sandbox record says how each inferred value was derived", () => {
  const raw = {
    dispute_id: "PP-D-T1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "20.00" },
    messages: [{ posted_by: "SELLER", content: "Checking with the carrier." }],
    disputed_transactions: [{ seller_transaction_id: "TX-T1", items: [{ item_name: "Test mug" }] }],
    evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ tracking_number: "TRK-T1" }] } }],
  };
  const d: Dispute = { ...normalizeDispute(raw), ...normalizeDetails(raw) };
  const p = provenanceOf(d);
  for (const r of p.refs) {
    assert.equal(r.origin, "paypal_sandbox");
    assert.equal(r.ref, `paypal_sandbox:PP-D-T1:${r.field}`);
  }
  const confirmation = refOf(p, "evidence.order_confirmation")!;
  assert.equal(confirmation.source_type, "transaction_record");
  assert.equal(confirmation.record_id, "TX-T1");
  assert.match(confirmation.derivation!, /seller transaction ID.*not an order confirmation document/);
  // Only the seller wrote, and the flag is still set: the derivation says "from either party".
  assert.match(refOf(p, "evidence.customer_communication")!.derivation!, /either party/);
  assert.equal(refOf(p, "evidence.customer_communication")!.source_type, "dispute_record");
  assert.match(refOf(p, "order.tracking_number")!.derivation!, /tracking number/);
  // Not in PayPal's record: listed because the rules cite it, with no derivation and the rules' status.
  const delivery = refOf(p, "evidence.proof_of_delivery")!;
  assert.deepEqual([delivery.value, delivery.derivation, delivery.verification], [null, null, "unverified"]);
  assert.equal(refOf(p, "reason")!.derivation, null);
});
