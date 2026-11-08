import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dispute, EvidenceChecklist } from "../../shared/types.ts";
import { DEMO_DISPUTES } from "./app.ts";
import { CHECKLIST_NOTES, buildChecklist } from "./checklist.ts";
import { NOT_PROOF, analyzeDispute } from "./evidence.ts";
import { buildProvenance } from "./provenance.ts";

// Synthetic records only.
const record = (reason: string, evidence: Dispute["evidence"] = {}, order: Dispute["order"] = { order_id: "ORDER-T1", item: "Test mug" }): Dispute => ({
  source: "demo",
  dispute_id: "TEST-1",
  reason,
  status: "OPEN",
  amount: { currency_code: "USD", value: "10.00" },
  order,
  evidence,
});
const checklist = (d: Dispute) => buildChecklist(d, analyzeDispute(d));
const byId = (c: EvidenceChecklist, id: string) => c.items.find((i) => i.id === id)!;
const ids = (c: EvidenceChecklist, applicable: boolean) => c.items.filter((i) => (i.status !== "not_applicable") === applicable).map((i) => i.id);

const ENGINE = ["order_confirmation", "shipping_tracking", "proof_of_delivery", "customer_communication"];
const EXPECTED: Record<string, { items: string[]; notApplicable: string[] }> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    items: ["shipping_tracking", "proof_of_delivery", "order_confirmation", "customer_communication"],
    notApplicable: [],
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    items: ["order_confirmation", "customer_communication", "listing_record", "return_tracking", "shipping_tracking", "proof_of_delivery"],
    notApplicable: [],
  },
  UNAUTHORISED: {
    items: ["order_confirmation", "customer_communication", "shipping_address", "shipping_tracking", "proof_of_delivery"],
    notApplicable: [],
  },
  DUPLICATE_TRANSACTION: {
    items: ["refund_id", "other_transaction", "order_confirmation", "customer_communication"],
    notApplicable: ["shipping_tracking", "proof_of_delivery"],
  },
  CREDIT_NOT_PROCESSED: {
    items: ["refund_id", "return_tracking", "customer_communication", "order_confirmation"],
    notApplicable: ["shipping_tracking", "proof_of_delivery"],
  },
};

test("each mapped reason has its own item list; other reasons get the generic list", () => {
  for (const [reason, expected] of Object.entries(EXPECTED)) {
    const c = checklist(record(reason));
    assert.equal(c.reason_known, true, reason);
    assert.deepEqual(new Set(ids(c, true)), new Set(expected.items), reason);
    assert.deepEqual(ids(c, false), expected.notApplicable, reason);
    // Every engine item appears exactly once, as applicable or not.
    assert.deepEqual(c.items.map((i) => i.id).filter((id) => ENGINE.includes(id)).sort(), [...ENGINE].sort(), reason);
  }
  const lists = Object.keys(EXPECTED).map((r) => JSON.stringify(ids(checklist(record(r)), true).sort()));
  assert.equal(new Set(lists).size, lists.length, "no two reasons share an item list");
  for (const reason of ["INCORRECT_AMOUNT", "PAYMENT_BY_OTHER_MEANS", "CANCELED_RECURRING_BILLING", "PROBLEM_WITH_REMITTANCE", "SOMETHING_NEW"]) {
    const c = checklist(record(reason));
    assert.equal(c.reason_known, false, reason);
    assert.deepEqual(ids(c, true), [...ENGINE, "your_position"], reason);
    assert.deepEqual(ids(c, false), [], reason);
  }
});

test("key items come first and not-applicable items last", () => {
  const notReceived = checklist(record("MERCHANDISE_OR_SERVICE_NOT_RECEIVED"));
  assert.deepEqual(notReceived.items.slice(0, 2).map((i) => [i.id, i.priority]), [["shipping_tracking", "key"], ["proof_of_delivery", "key"]]);
  const duplicate = checklist(record("DUPLICATE_TRANSACTION"));
  const first = duplicate.items.findIndex((i) => i.status === "not_applicable");
  assert.ok(duplicate.items.slice(first).every((i) => i.status === "not_applicable"));
});

test("each status comes from the record the way the engine reads it", () => {
  const shipped = { order_id: "ORDER-T1", item: "Test mug", shipping_status: "SHIPPED", tracking_number: "TRACK-T1" };
  const c = checklist(
    record("MERCHANDISE_OR_SERVICE_NOT_RECEIVED", { shipping_tracking: true, proof_of_delivery: false, order_confirmation: true }, shipped),
  );
  assert.equal(byId(c, "shipping_tracking").status, "available");
  assert.equal(byId(c, "order_confirmation").status, "available");
  const missing = byId(c, "proof_of_delivery");
  assert.equal(missing.status, "missing");
  assert.ok(missing.limits.endsWith(NOT_PROOF), "a missing item says missing is not proof");
  assert.equal(byId(c, "customer_communication").status, "needs_confirmation", "a flag that is not supplied");

  const conflicting = DEMO_DISPUTES.find((d) => d.dispute_id === "DEMO-1002")!;
  assert.equal(byId(checklist(conflicting), "proof_of_delivery").status, "conflicting");

  const duplicate = checklist(record("DUPLICATE_TRANSACTION", { proof_of_delivery: true, shipping_tracking: true }, shipped));
  assert.equal(byId(duplicate, "refund_id").status, "needs_confirmation", "no record field holds a refund ID");
  assert.equal(byId(duplicate, "other_transaction").status, "needs_confirmation");
  assert.equal(byId(duplicate, "proof_of_delivery").status, "not_applicable", "even when it is on record");
  assert.deepEqual(byId(duplicate, "proof_of_delivery").refs, []);
});

test("statuses and refs agree with the engine and provenance on every demo record", () => {
  for (const d of DEMO_DISPUTES) {
    const analysis = analyzeDispute(d);
    const provenance = buildProvenance(d, analysis);
    const c = buildChecklist(d, analysis);
    assert.equal(c.dispute_id, d.dispute_id);
    for (const item of c.items.filter((i) => i.evidence_key !== null && i.status !== "not_applicable")) {
      const finding = analysis.evidence.find((f) => f.id === item.evidence_key)!;
      const state = provenance.findings.find((f) => f.evidence_id === item.evidence_key)!;
      const expected =
        state.verification === "conflicting"
          ? "conflicting"
          : { available: "available", missing: "missing", unverified: "needs_confirmation" }[finding.status];
      assert.equal(item.status, expected, `${d.dispute_id} ${item.id}`);
      assert.equal(item.priority, finding.priority, `${d.dispute_id} ${item.id}`);
      assert.deepEqual(item.refs, state.refs, `${d.dispute_id} ${item.id}`);
      for (const r of item.refs) assert.ok(provenance.refs.some((p) => p.ref === r), `${r} has no provenance entry`);
    }
    for (const item of c.items.filter((i) => i.evidence_key === null)) assert.equal(item.status, "needs_confirmation", `${d.dispute_id} ${item.id}`);
  }
});

test("a different reason changes the checklist but leaves the record and the engine's statuses alone", () => {
  const d = DEMO_DISPUTES.find((x) => x.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED")!;
  const before = JSON.stringify(d);
  const asDuplicate = { ...d, reason: "DUPLICATE_TRANSACTION" };
  assert.notDeepEqual(ids(checklist(d), true), ids(checklist(asDuplicate), true));
  assert.deepEqual(
    analyzeDispute(asDuplicate).evidence.map((f) => f.status),
    analyzeDispute(d).evidence.map((f) => f.status),
  );
  assert.equal(JSON.stringify(d), before, "the record is not changed");
});

// Every item from every reason and every demo record.
const ALL_ITEMS = [
  ...[...Object.keys(EXPECTED), "SOMETHING_NEW"].flatMap((r) => checklist(record(r)).items),
  ...DEMO_DISPUTES.flatMap((d) => checklist(d).items),
];

test("no item is official, and an official item would need a citation", () => {
  for (const item of ALL_ITEMS) {
    assert.notEqual(item.tier, "official", item.id);
    if (item.tier === "official") assert.ok(item.citation?.url && item.citation.checked_on, `${item.id} has no citation`);
    else assert.equal(item.citation, null, item.id);
  }
});

test("every item says why, where to look, what to check and what DisputeDesk can't see", () => {
  for (const item of ALL_ITEMS) {
    assert.ok(item.why.trim() && item.limits.trim(), item.id);
    assert.ok(item.where.length > 0 && item.where.every((w) => w.trim()), item.id);
    assert.ok(item.check_before_adding.length > 0 && item.check_before_adding.every((w) => w.trim()), item.id);
  }
});

// Wording rules: suggestions only. No outcome, no reach into other systems, no claim that an event did not happen.
const BANNED = [
  // "what was promised" in the merchant's own messages is allowed; a promise about the dispute is not.
  /\b(we|DisputeDesk|this) (promise|will)\b|\b(guarantee\w*|will win|win the|likely|chances?|ensure\w*|succeed\w*|outcome)\b/i,
  /\bwe (found|checked|verified|confirmed)\b/i,
  /\bDisputeDesk (will|can (open|fetch|check|contact|see your))\b/i,
  /\b(fetch\w*|retriev\w*|downloads?)\b/i,
  /\bdid not happen\b|\bwas not delivered\b|\bnever\b|\bnot (sent|shipped|received)\b/i,
];

test("item and note text follows the wording rules", () => {
  const texts = [
    ...ALL_ITEMS.flatMap((i) => [i.label, i.why, i.limits.replace(NOT_PROOF, ""), ...i.where, ...i.check_before_adding]),
    ...CHECKLIST_NOTES.filter((n) => !n.includes("does not show that it did not happen")),
  ];
  for (const text of new Set(texts)) for (const pattern of BANNED) assert.doesNotMatch(text, pattern, text);
  // The one sentence allowed to name "did not happen" is the not-proof note itself.
  assert.ok(CHECKLIST_NOTES.some((n) => n.includes("does not show that it did not happen")));
});
