import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import { humanize } from "../../client/src/disputes.ts";
import type { Analysis, Dispute } from "../../client/src/types.ts";
import { analyzeDispute, findContradictions } from "./evidence.ts";
import { validateDispute } from "./validate.ts";

const demo: Dispute = { ...sample, source: "demo" };
const withChanges = (changes: Partial<Dispute>): Dispute => ({ ...demo, ...changes });
const status = (a: Analysis, id: string) => a.evidence.find((e) => e.id === id)!.status;

function valueAt(dispute: Dispute, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), dispute);
}

// Every "fact" line must point at supplied records and repeat only what they say.
function assertFactsComeFromRecords(dispute: Dispute, analysis: Analysis) {
  for (const line of analysis.draft.lines.filter((l) => l.kind === "fact")) {
    assert.ok(line.records.length > 0, `fact without a record: ${line.text}`);
    for (const path of line.records) {
      const value = valueAt(dispute, path);
      assert.ok(value !== undefined && value !== null && value !== false, `"${line.text}" cites ${path}, which is not on record`);
      if (typeof value === "string") {
        assert.ok(line.text.includes(value) || line.text.includes(humanize(value)), `"${line.text}" does not match ${path}`);
      }
    }
  }
}

test("demo fixture: same missing items as evidence-checklist.js", () => {
  const a = analyzeDispute(demo);
  assert.deepEqual(
    a.evidence.filter((e) => e.status === "missing").map((e) => e.label),
    ["Shipping tracking", "Proof of delivery"],
  );
  assert.equal(status(a, "order_confirmation"), "available");
  assert.equal(status(a, "customer_communication"), "available");
  assertFactsComeFromRecords(demo, a);
});

test("never invents a tracking number when none exists", () => {
  const a = analyzeDispute(demo);
  const trackingLine = a.draft.lines.find((l) => l.text.startsWith("- Tracking number:"))!;
  assert.equal(trackingLine.kind, "missing");
  assert.match(trackingLine.text, /^- Tracking number: \[MISSING:/);
  // No line anywhere presents a tracking number as a fact.
  assert.ok(!a.draft.lines.some((l) => l.kind === "fact" && l.records.includes("order.tracking_number")));
  assert.ok(!/tracking number [A-Z0-9]{6,}/i.test(JSON.stringify(a)));
});

test("a recorded tracking number is used exactly as supplied", () => {
  const d = withChanges({ order: { ...demo.order, tracking_number: "TRK-TEST-42" }, evidence: { ...demo.evidence, shipping_tracking: true } });
  const a = analyzeDispute(d);
  assert.equal(status(a, "shipping_tracking"), "available");
  assert.ok(a.draft.text.includes("- Tracking number: TRK-TEST-42"));
  assertFactsComeFromRecords(d, a);
});

test("tracking needs both the flag and a number; otherwise it is unverified, not available", () => {
  const tracking = (flag: boolean | undefined, number: string | null) =>
    status(analyzeDispute(withChanges({ evidence: { ...demo.evidence, shipping_tracking: flag }, order: { ...demo.order, tracking_number: number } })), "shipping_tracking");
  assert.equal(tracking(true, "TRK-1"), "available");
  assert.equal(tracking(true, null), "unverified");
  assert.equal(tracking(false, "TRK-1"), "unverified");
  assert.equal(tracking(false, null), "missing");
  assert.equal(tracking(undefined, null), "unverified");
});

test("missing evidence is never presented as proof that something did not happen", () => {
  const a = analyzeDispute(demo);
  for (const e of a.evidence.filter((x) => x.status === "missing")) {
    assert.match(e.explanation, /does not show that it did not happen/);
  }
  assert.ok(!/was not delivered|never shipped|did not ship|not received by/i.test(a.draft.text.replace(/does not show it was not delivered/, "")));
});

test("unsupported claims are marked, not made", () => {
  const a = analyzeDispute(demo);
  const unsupported = a.draft.lines.filter((l) => l.kind === "unsupported").map((l) => l.text);
  assert.ok(unsupported.some((t) => /do not state that the order was delivered/.test(t)));
  assert.ok(unsupported.some((t) => /do not cite tracking/.test(t)));
  assert.ok(!a.draft.lines.some((l) => l.kind === "fact" && /delivered/i.test(l.text)));

  const delivered = withChanges({ evidence: { ...demo.evidence, proof_of_delivery: true } });
  assert.ok(analyzeDispute(delivered).draft.lines.some((l) => l.kind === "fact" && l.text === "Proof of delivery is on record."));
});

test("contradictory records are flagged with the records involved", () => {
  const d = withChanges({
    order: { ...demo.order, shipping_status: "NOT_SHIPPED", tracking_number: null },
    evidence: { ...demo.evidence, shipping_tracking: true, proof_of_delivery: true },
  });
  const found = findContradictions(d);
  assert.deepEqual(
    found.map((c) => c.records.map((r) => r.path)),
    [
      ["evidence.shipping_tracking", "order.tracking_number"],
      ["evidence.proof_of_delivery", "order.shipping_status"],
    ],
  );
  const a = analyzeDispute(d);
  assert.equal(a.draft.lines.filter((l) => l.kind === "conflict").length, 2);
  assert.ok(a.next_steps.some((s) => s.startsWith("Resolve:")));

  const numberWithoutFlag = withChanges({ order: { ...demo.order, tracking_number: "TRK-9" } });
  assert.equal(findContradictions(numberWithoutFlag).length, 1);
  assert.deepEqual(findContradictions(demo), []);
});

test("incomplete records give gaps, not guesses", () => {
  const d: Dispute = { source: "paypal_sandbox", dispute_id: "PP-X", reason: "UNAUTHORISED", status: "OPEN", amount: null };
  const a = analyzeDispute(d);
  assert.ok(a.evidence.every((e) => e.status === "unverified"));
  assert.ok(a.draft.text.includes("Amount: [MISSING: not on record]"));
  assert.ok(a.draft.text.includes("[MISSING: the buyer's message was not supplied]"));
  assert.ok(a.draft.text.includes("[NEEDS MERCHANT INPUT:"));
  assert.ok(!a.draft.text.includes("DEMO DATA"));
  assert.deepEqual(a.draft.lines.filter((l) => l.kind === "fact").map((l) => l.records), [["dispute_id"], ["reason"]]);
  assertFactsComeFromRecords(d, a);
});

test("draft is labeled as a draft needing review, and demo cases are labeled demo", () => {
  const a = analyzeDispute(demo);
  assert.equal(a.draft.lines[0].text, "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL.");
  assert.equal(a.draft.lines[1].text, "DEMO DATA — NOT A REAL PAYPAL DISPUTE.");
  assert.equal(a.source, "demo");
});

test("validation accepts the demo fixture and drops unknown fields", () => {
  const result = validateDispute({ ...demo, extra: "x", order: { ...demo.order, secret: "y" } });
  assert.ok(result.ok);
  assert.ok(!JSON.stringify(result.dispute).includes('"extra"'));
  assert.ok(!JSON.stringify(result.dispute).includes('"secret"'));
});

test("validation rejects bad input with field-level reasons", () => {
  const bad = validateDispute({
    source: "live",
    dispute_id: "",
    reason: 5,
    status: "OPEN",
    amount: { currency_code: "usd", value: "1e9" },
    order: { tracking_number: 123 },
    evidence: { proof_of_delivery: "yes" },
  });
  assert.ok(!bad.ok);
  assert.equal(bad.errors.length, 6);
  assert.equal(validateDispute(null).ok, false);
  assert.equal(validateDispute([]).ok, false);
  // An empty tracking number means "not recorded".
  const empty = validateDispute({ ...demo, order: { ...demo.order, tracking_number: "  " } });
  assert.ok(empty.ok && empty.dispute.order?.tracking_number === null);
});
