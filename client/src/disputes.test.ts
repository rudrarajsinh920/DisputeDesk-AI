import assert from "node:assert/strict";
import { test } from "node:test";
import sample from "../../sample-dispute.json" with { type: "json" };
import { countByStatus, filterByStatus, formatMoney, summarize } from "../../shared/disputes.ts";
import type { Dispute } from "../../shared/types.ts";

// Evidence checklist tests now live with the engine in server/src/evidence.test.ts.

const demo: Dispute = { ...sample, source: "demo" };

function dispute(overrides: Partial<Dispute>): Dispute {
  return { ...demo, ...overrides };
}

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
    dispute({ amount: null }),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.unresolved, 3);
  assert.deepEqual(s.amounts, [
    { currency_code: "USD", value: "0.30" },
    { currency_code: "EUR", value: "5.00" },
  ]);
});

test("summary of no disputes", () => {
  assert.deepEqual(summarize([]), { total: 0, unresolved: 0, amounts: [] });
});

test("a missing amount shows as a dash, never a number", () => {
  assert.equal(formatMoney(null), "—");
});

test("money formatting falls back on an unknown currency code", () => {
  assert.equal(formatMoney({ currency_code: "USD", value: "49.99" }), "$49.99");
  assert.equal(formatMoney({ currency_code: "NOT_A_CODE", value: "1.00" }), "NOT_A_CODE 1.00");
});
