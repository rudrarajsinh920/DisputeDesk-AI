import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import { countByStatus, evidenceChecklist, filterByStatus, formatMoney, summarize } from "./disputes.ts";
import type { Dispute } from "./types.ts";

const demo: Dispute = { ...sample, source: "demo" };

function dispute(overrides: Partial<Dispute>): Dispute {
  return { ...demo, ...overrides };
}

test("checklist on the demo fixture matches evidence-checklist.js output", () => {
  const missing = evidenceChecklist(demo)!.filter((e) => !e.present).map((e) => e.item);
  assert.deepEqual(missing, ["Shipping tracking", "Proof of delivery"]);
});

test("tracking counts only when the flag is set and a number is recorded", () => {
  const tracking = (flag: boolean, number: string | null) =>
    evidenceChecklist(
      dispute({
        evidence: { ...demo.evidence!, shipping_tracking: flag },
        order: { ...demo.order!, tracking_number: number },
      }),
    )!.find((e) => e.item === "Shipping tracking")!.present;
  assert.equal(tracking(true, "1Z999"), true);
  assert.equal(tracking(false, "1Z999"), false);
  assert.equal(tracking(true, null), false);
});

test("checklist is null when the source has no evidence data", () => {
  assert.equal(evidenceChecklist(dispute({ evidence: undefined })), null);
});

test("status filter and counts", () => {
  const list = [demo, dispute({ dispute_id: "B", status: "RESOLVED" })];
  assert.equal(filterByStatus(list, "ALL").length, 2);
  assert.deepEqual(filterByStatus(list, "RESOLVED").map((d) => d.dispute_id), ["B"]);
  assert.equal(filterByStatus(list, "UNDER_REVIEW").length, 0);
  assert.deepEqual(countByStatus(list), { ALL: 2, OPEN: 1, RESOLVED: 1 });
});

test("summary sums exactly per currency and skips resolved from unresolved", () => {
  const s = summarize([
    dispute({ amount: { currency_code: "USD", value: "0.10" } }),
    dispute({ amount: { currency_code: "USD", value: "0.20" }, status: "RESOLVED" }),
    dispute({ amount: { currency_code: "EUR", value: "5.00" }, evidence: undefined }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.unresolved, 2);
  assert.deepEqual(s.amounts, [
    { currency_code: "USD", value: "0.30" },
    { currency_code: "EUR", value: "5.00" },
  ]);
  assert.equal(s.missingEvidence, 4);
});

test("summary of no disputes", () => {
  assert.deepEqual(summarize([]), { total: 0, unresolved: 0, amounts: [], missingEvidence: 0 });
});

test("money formatting falls back on an unknown currency code", () => {
  assert.equal(formatMoney({ currency_code: "USD", value: "49.99" }), "$49.99");
  assert.equal(formatMoney({ currency_code: "NOT_A_CODE", value: "1.00" }), "NOT_A_CODE 1.00");
});
