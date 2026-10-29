import type { Dispute, Money } from "./types.ts";

export const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  WAITING_FOR_SELLER_RESPONSE: "Awaiting seller",
  WAITING_FOR_BUYER_RESPONSE: "Awaiting buyer",
  UNDER_REVIEW: "Under review",
  RESOLVED: "Resolved",
};

export const REASON_LABELS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized transaction",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate transaction",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  CANCELED_RECURRING_BILLING: "Canceled recurring billing",
  PROBLEM_WITH_REMITTANCE: "Problem with remittance",
};

export const STATUS_FILTERS = ["ALL", ...Object.keys(STATUS_LABELS)];

export function humanize(code: string): string {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function labelFor(labels: Record<string, string>, code: string): string {
  return labels[code] ?? humanize(code);
}

export function statusTone(status: string): "warn" | "info" | "ok" | "neutral" {
  if (status === "OPEN" || status === "WAITING_FOR_SELLER_RESPONSE") return "warn";
  if (status === "UNDER_REVIEW" || status === "WAITING_FOR_BUYER_RESPONSE") return "info";
  if (status === "RESOLVED") return "ok";
  return "neutral";
}

export function filterByStatus(disputes: Dispute[], status: string): Dispute[] {
  return status === "ALL" ? disputes : disputes.filter((d) => d.status === status);
}

export function countByStatus(disputes: Dispute[]): Record<string, number> {
  const counts: Record<string, number> = { ALL: disputes.length };
  for (const d of disputes) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return counts;
}

export interface EvidenceItem {
  item: string;
  present: boolean;
  reason: string;
}

// Same rules as evidence-checklist.js. Returns null when the source has no evidence data.
export function evidenceChecklist(dispute: Dispute): EvidenceItem[] | null {
  const evidence = dispute.evidence;
  if (!evidence) return null;
  return [
    {
      item: "Order confirmation",
      present: evidence.order_confirmation,
      reason: "No order confirmation is marked as available.",
    },
    {
      item: "Shipping tracking",
      present: evidence.shipping_tracking && Boolean(dispute.order?.tracking_number),
      reason: "Tracking evidence is missing or no tracking number is recorded.",
    },
    {
      item: "Proof of delivery",
      present: evidence.proof_of_delivery,
      reason: "Proof of delivery is not marked as available.",
    },
    {
      item: "Customer communication",
      present: evidence.customer_communication,
      reason: "Relevant customer communication is not marked as available.",
    },
  ];
}

export function formatMoney({ currency_code, value }: Money): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency_code }).format(Number(value));
  } catch {
    return `${currency_code} ${value}`;
  }
}

export interface Summary {
  total: number;
  unresolved: number;
  amounts: Money[];
  missingEvidence: number;
}

export function summarize(disputes: Dispute[]): Summary {
  // Sum in cents so 0.1 + 0.2 stays exact.
  const cents = new Map<string, number>();
  let missingEvidence = 0;
  for (const d of disputes) {
    const value = Math.round(Number(d.amount.value) * 100);
    if (Number.isFinite(value)) {
      cents.set(d.amount.currency_code, (cents.get(d.amount.currency_code) ?? 0) + value);
    }
    missingEvidence += evidenceChecklist(d)?.filter((e) => !e.present).length ?? 0;
  }
  return {
    total: disputes.length,
    unresolved: disputes.filter((d) => d.status !== "RESOLVED").length,
    amounts: [...cents].map(([currency_code, c]) => ({ currency_code, value: (c / 100).toFixed(2) })),
    missingEvidence,
  };
}
