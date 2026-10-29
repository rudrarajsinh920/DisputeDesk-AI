import { REASON_LABELS, humanize, labelFor } from "../../client/src/disputes.ts";
import type {
  Analysis,
  Contradiction,
  Dispute,
  DraftLine,
  EvidenceFinding,
  EvidenceKey,
  RecordRef,
} from "../../client/src/types.ts";

// Rule-based on purpose: every statement comes from a supplied record or is a marked gap.
// Checklist rules and wording follow evidence-checklist.js; disclaimers follow draft-response.js.

const NOT_RECEIVED = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const NOT_AS_DESCRIBED = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
const SHIPPED_STATES = ["SHIPPED", "DELIVERED"];

const EVIDENCE_KEYS: EvidenceKey[] = ["order_confirmation", "shipping_tracking", "proof_of_delivery", "customer_communication"];

const LABELS: Record<EvidenceKey, string> = {
  order_confirmation: "Order confirmation",
  shipping_tracking: "Shipping tracking",
  proof_of_delivery: "Proof of delivery",
  customer_communication: "Customer communication",
};

const RELEVANCE: Record<EvidenceKey, string> = {
  order_confirmation: "Shows what the buyer ordered and agreed to pay for.",
  shipping_tracking: "A carrier tracking record can show that the order was sent and how it moved.",
  proof_of_delivery: "A carrier delivery confirmation can show where and when the order arrived.",
  customer_communication: "Messages with the buyer can show what was promised, reported or agreed.",
};

// Evidence that matters most for each reason; everything else is supporting.
const KEY_EVIDENCE: Record<string, EvidenceKey[]> = {
  [NOT_RECEIVED]: ["shipping_tracking", "proof_of_delivery"],
  [NOT_AS_DESCRIBED]: ["order_confirmation", "customer_communication"],
  UNAUTHORISED: ["order_confirmation", "customer_communication"],
};

const NOT_PROOF = "Missing from the supplied records does not show that it did not happen.";

function ref(dispute: Dispute, path: string): RecordRef {
  let value: unknown = dispute;
  for (const key of path.split(".")) {
    value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  }
  return { path, value: typeof value === "string" || typeof value === "boolean" ? value : null };
}

const trackingNumber = (d: Dispute) => (d.order?.tracking_number?.trim() ? d.order.tracking_number : null);

// Record paths named in any contradiction. Contested records are never cited as facts in the merchant response.
const contestedPaths = (contradictions: Contradiction[]) => new Set(contradictions.flatMap((c) => c.records.map((r) => r.path)));

function assess(dispute: Dispute, key: EvidenceKey, contested: Set<string>): EvidenceFinding {
  const flag = ref(dispute, `evidence.${key}`);
  const records = [flag];
  let status: EvidenceFinding["status"];
  let explanation: string;

  if (key === "shipping_tracking") {
    const number = trackingNumber(dispute);
    records.push(ref(dispute, "order.tracking_number"));
    if (flag.value === true && number) {
      status = "available";
      explanation = `Marked available, and tracking number ${number} is on record.`;
    } else if (flag.value === true) {
      status = "unverified";
      explanation = "Marked available, but no tracking number is on record to back it up.";
    } else if (number) {
      status = "unverified";
      explanation = "A tracking number is on record, but tracking evidence is not marked available. Confirm it with the carrier.";
    } else if (flag.value === false) {
      status = "missing";
      explanation = "Tracking evidence is missing or no tracking number is recorded.";
    } else {
      status = "unverified";
      explanation = "No tracking information was supplied.";
    }
    const shipping = ref(dispute, "order.shipping_status");
    if (!number && typeof shipping.value === "string" && SHIPPED_STATES.includes(shipping.value)) {
      records.push(shipping);
      explanation += ` The order is marked "${humanize(shipping.value)}", but no tracking number is recorded.`;
    }
  } else if (flag.value === true) {
    status = "available";
    explanation = `${LABELS[key]} is marked as available.`;
  } else if (flag.value === false) {
    status = "missing";
    explanation = `${LABELS[key]} is not marked as available.`;
  } else {
    status = "unverified";
    explanation = `The supplied records do not say whether ${LABELS[key].toLowerCase()} is available.`;
  }
  if (status === "missing") explanation += ` ${NOT_PROOF}`;
  if (status === "available" && contested.has(flag.path)) {
    status = "unverified";
    explanation += " Other supplied records contradict this, so it cannot be relied on until that is resolved.";
  }

  const isKey = (KEY_EVIDENCE[dispute.reason] ?? []).includes(key);
  const reason = labelFor(REASON_LABELS, dispute.reason);
  return {
    id: key,
    label: LABELS[key],
    status,
    priority: isKey ? "key" : "supporting",
    relevance: isKey ? `${RELEVANCE[key]} Key evidence for this dispute reason (${reason}).` : RELEVANCE[key],
    explanation,
    records,
  };
}

export function findContradictions(dispute: Dispute): Contradiction[] {
  const found: Contradiction[] = [];
  const tracking = ref(dispute, "evidence.shipping_tracking");
  const number = ref(dispute, "order.tracking_number");
  const delivery = ref(dispute, "evidence.proof_of_delivery");
  const shipping = ref(dispute, "order.shipping_status");
  const hasNumber = trackingNumber(dispute) !== null;

  if (tracking.value === true && !hasNumber) {
    found.push({ message: "Shipping tracking is marked available, but no tracking number is recorded.", records: [tracking, number] });
  }
  if (tracking.value === false && hasNumber) {
    found.push({ message: "A tracking number is recorded, but shipping tracking is marked not available.", records: [tracking, number] });
  }
  if (delivery.value === true && typeof shipping.value === "string" && !SHIPPED_STATES.includes(shipping.value)) {
    found.push({
      message: `Proof of delivery is marked available, but the order's shipping status is "${humanize(shipping.value)}".`,
      records: [delivery, shipping],
    });
  }
  if (shipping.value === "DELIVERED" && delivery.value === false) {
    found.push({ message: 'The shipping status is "Delivered", but proof of delivery is marked not available.', records: [shipping, delivery] });
  }
  return found;
}

function buildDraft(dispute: Dispute, evidence: EvidenceFinding[], contradictions: Contradiction[]): DraftLine[] {
  const lines: DraftLine[] = [];
  const add = (kind: DraftLine["kind"], text: string, ...records: string[]) => lines.push({ kind, text, records });
  const field = (label: string, path: string, value: string | null | undefined, display = value) =>
    value ? add("fact", `- ${label}: ${display}`, path) : add("missing", `- ${label}: [MISSING: not on record]`, path);
  const found = (key: EvidenceKey) => evidence.find((e) => e.id === key)!;
  const contested = contestedPaths(contradictions);
  const conflict = (what: string, ...records: string[]) =>
    add("conflict", `[CONFLICT: do not cite ${what} until the conflicting records are resolved.]`, ...records);

  add("notice", "DRAFT — REQUIRES MERCHANT REVIEW. NOT SUBMITTED TO PAYPAL.");
  if (dispute.source === "demo") add("notice", "DEMO DATA — NOT A REAL PAYPAL DISPUTE.");
  add("notice", "");

  add("fact", `Dispute ID: ${dispute.dispute_id}`, "dispute_id");
  if (dispute.amount) add("fact", `Amount: ${dispute.amount.currency_code} ${dispute.amount.value}`, "amount");
  else add("missing", "Amount: [MISSING: not on record]", "amount");
  add("fact", `Reason: ${labelFor(REASON_LABELS, dispute.reason)} (${dispute.reason})`, "reason");
  add("notice", "");

  add("notice", "Buyer's claim, as stated in the dispute:");
  if (dispute.customer_message) add("fact", `"${dispute.customer_message}"`, "customer_message");
  else add("missing", "[MISSING: the buyer's message was not supplied]", "customer_message");
  add("notice", "");

  add("notice", "Order records:");
  field("Order ID", "order.order_id", dispute.order?.order_id);
  field("Item", "order.item", dispute.order?.item);
  const shipping = dispute.order?.shipping_status;
  field("Shipping status", "order.shipping_status", shipping, shipping && humanize(shipping));
  const number = trackingNumber(dispute);
  if (number) add("fact", `- Tracking number: ${number}`, "order.tracking_number");
  else add("missing", "- Tracking number: [MISSING: no tracking number on record. Add one only from a valid carrier record.]", "order.tracking_number");
  add("notice", "");

  add("notice", "Evidence on record:");
  for (const e of evidence) {
    if (e.status === "available") add("fact", `- ${e.label}: available, as marked in the evidence record`, `evidence.${e.id}`);
    else if (e.status === "missing") add("missing", `- ${e.label}: [MISSING: not available in the supplied records]`, `evidence.${e.id}`);
    else add("unverified", `- ${e.label}: [UNVERIFIED: ${e.explanation}]`, `evidence.${e.id}`);
  }
  add("notice", "");

  add("notice", "Merchant response:");
  if (dispute.reason === NOT_RECEIVED) {
    if (contested.has("order.shipping_status")) {
      conflict("the shipping status", "order.shipping_status");
    } else if (shipping && SHIPPED_STATES.includes(shipping)) {
      add("fact", `Our records show the order status as "${humanize(shipping)}".`, "order.shipping_status");
    } else {
      add("input", "[NEEDS MERCHANT INPUT: state whether and when the order was shipped, from your records.]");
    }
    if (found("shipping_tracking").status === "available") {
      add("fact", `The shipment has tracking number ${number}.`, "order.tracking_number", "evidence.shipping_tracking");
    } else if (contested.has("evidence.shipping_tracking")) {
      conflict("tracking", "evidence.shipping_tracking", "order.tracking_number");
    } else {
      add("unsupported", "[UNSUPPORTED: do not cite tracking until a valid tracking number is on record.]");
    }
    if (found("proof_of_delivery").status === "available") {
      add("fact", "Proof of delivery is on record.", "evidence.proof_of_delivery");
    } else if (contested.has("evidence.proof_of_delivery")) {
      conflict("proof of delivery", "evidence.proof_of_delivery", "order.shipping_status");
    } else {
      add("unsupported", "[UNSUPPORTED: do not state that the order was delivered. No proof of delivery is on record, which does not show it was not delivered.]");
    }
  } else if (dispute.reason === NOT_AS_DESCRIBED) {
    add("input", "[NEEDS MERCHANT INPUT: explain how the item matched its listing.]");
    if (found("order_confirmation").status === "available") add("fact", "An order confirmation is on record.", "evidence.order_confirmation");
    else add("unsupported", "[UNSUPPORTED: do not describe the order terms until an order confirmation is on record.]");
  } else {
    add("input", "[NEEDS MERCHANT INPUT: state your position on this dispute and the evidence that supports it.]");
  }
  if (found("customer_communication").status === "available") {
    add("fact", "Records of communication with the buyer are on record.", "evidence.customer_communication");
  }

  if (contradictions.length > 0) {
    add("notice", "");
    add("notice", "Resolve before responding:");
    for (const c of contradictions) add("conflict", `- [CONFLICT: ${c.message}]`, ...c.records.map((r) => r.path));
  }

  add("notice", "");
  add("notice", "This draft uses only the records supplied to DisputeDesk and does not establish any fact on its own.");
  add("notice", "Confirm every fact and the applicable evidence requirements before responding in PayPal.");
  return lines;
}

export function analyzeDispute(dispute: Dispute): Analysis {
  const contradictions = findContradictions(dispute);
  const contested = contestedPaths(contradictions);
  const evidence = EVIDENCE_KEYS.map((key) => assess(dispute, key, contested));
  const next_steps = [
    ...evidence
      .filter((e) => e.priority === "key" && e.status !== "available")
      .map((e) => `Find or confirm the ${e.label.toLowerCase()} record.`),
    ...contradictions.map((c) => `Resolve: ${c.message}`),
    "Fill every [MISSING], [UNVERIFIED] and [NEEDS MERCHANT INPUT] marker, or remove the statement.",
    "Confirm every fact in the draft before responding in PayPal.",
  ];
  const lines = buildDraft(dispute, evidence, contradictions);
  return {
    source: dispute.source,
    dispute_id: dispute.dispute_id,
    evidence,
    contradictions,
    next_steps,
    draft: { lines, text: lines.map((l) => l.text).join("\n") },
  };
}
