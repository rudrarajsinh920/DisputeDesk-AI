import type { Dispute, Money } from "./types.ts";

// PayPal's dispute reasons reference lists proof of refund (the refund ID) for these reasons. DisputeDesk's records
// have no refund field, so for these the refund ID is always a gap the merchant fills.
export const REFUND_ID_REASONS = ["CREDIT_NOT_PROCESSED", "DUPLICATE_TRANSACTION"];

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

export function formatMoney(money: Money | null): string {
  if (!money) return "—";
  const { currency_code, value } = money;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency_code }).format(Number(value));
  } catch {
    return `${currency_code} ${value}`;
  }
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { dateStyle: "medium" });
}

// Below this many disputes a percentage would overstate a handful of records, so only "3 of 7" is shown.
export const MIN_FOR_PERCENT = 10;

export function formatShare(count: number, total: number): string {
  if (total < MIN_FOR_PERCENT) return `${count} of ${total}`;
  return `${count} of ${total} (${Math.round((count / total) * 100)}%)`;
}

export interface Summary {
  total: number;
  unresolved: number;
  amounts: Money[];
}

export function summarize(disputes: Dispute[]): Summary {
  // Sum in cents so 0.1 + 0.2 stays exact.
  const cents = new Map<string, number>();
  for (const d of disputes) {
    const value = d.amount ? Math.round(Number(d.amount.value) * 100) : NaN;
    if (d.amount && Number.isFinite(value)) {
      cents.set(d.amount.currency_code, (cents.get(d.amount.currency_code) ?? 0) + value);
    }
  }
  return {
    total: disputes.length,
    unresolved: disputes.filter((d) => d.status !== "RESOLVED").length,
    amounts: [...cents].map(([currency_code, c]) => ({ currency_code, value: (c / 100).toFixed(2) })),
  };
}
