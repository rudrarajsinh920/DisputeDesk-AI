import type { Dispute, Source } from "../../shared/types.ts";

export type Validation = { ok: true; dispute: Dispute } | { ok: false; errors: string[] };
export type Lookup = { source: Source; dispute_id: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const DISPUTE_ID = /^[A-Za-z0-9-]{1,100}$/;

// An analysis request names a record; it never carries one. Any other field is ignored.
export function validateLookup(input: unknown): { ok: true; lookup: Lookup } | { ok: false; errors: string[] } {
  if (!isObject(input)) return { ok: false, errors: ["The body must be an object with source and dispute_id."] };
  const errors: string[] = [];
  const { source, dispute_id } = input;
  if (source !== "demo" && source !== "paypal_sandbox") errors.push('source must be "demo" or "paypal_sandbox".');
  if (typeof dispute_id !== "string" || !DISPUTE_ID.test(dispute_id)) errors.push("dispute_id must be 1 to 100 letters, digits or hyphens.");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, lookup: { source: source as Source, dispute_id: dispute_id as string } };
}

// Checks every field the engine reads and copies only those, so unknown fields never pass through.
export function validateDispute(input: unknown): Validation {
  if (!isObject(input)) return { ok: false, errors: ["The body must be a dispute object."] };
  const errors: string[] = [];

  const text = (path: string, value: unknown, max: number, required = false): string | undefined => {
    if (value === undefined) {
      if (required) errors.push(`${path} is required.`);
      return undefined;
    }
    if (typeof value !== "string" || value.trim() === "" || value.length > max) {
      errors.push(`${path} must be a non-empty string of at most ${max} characters.`);
      return undefined;
    }
    return value;
  };
  const flag = (path: string, value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") errors.push(`${path} must be true or false.`);
    return typeof value === "boolean" ? value : undefined;
  };

  const source = input.source;
  if (source !== "demo" && source !== "paypal_sandbox") errors.push('source must be "demo" or "paypal_sandbox".');
  const dispute_id = text("dispute_id", input.dispute_id, 100, true);
  const reason = text("reason", input.reason, 100, true);
  const status = text("status", input.status, 100, true);
  const customer_message = text("customer_message", input.customer_message, 5000);

  let amount: Dispute["amount"] = null;
  if (input.amount !== undefined && input.amount !== null) {
    const a = input.amount;
    if (
      isObject(a) &&
      typeof a.currency_code === "string" &&
      /^[A-Z]{3}$/.test(a.currency_code) &&
      typeof a.value === "string" &&
      // Up to 3 decimals: ISO 4217 currencies use 0, 2 or 3 minor digits (e.g. KWD).
      /^\d{1,12}(\.\d{1,3})?$/.test(a.value)
    ) {
      amount = { currency_code: a.currency_code, value: a.value };
    } else {
      errors.push('amount must be null or { currency_code: three capital letters, value: a decimal string like "49.99" }.');
    }
  }

  let order: Dispute["order"];
  if (input.order !== undefined) {
    if (!isObject(input.order)) {
      errors.push("order must be an object.");
    } else {
      const o = input.order;
      const tracking = o.tracking_number;
      if (tracking !== undefined && tracking !== null && (typeof tracking !== "string" || tracking.length > 100)) {
        errors.push("order.tracking_number must be a string of at most 100 characters, or null.");
      }
      order = {
        order_id: text("order.order_id", o.order_id, 100),
        item: text("order.item", o.item, 500),
        // Canonical form (e.g. "delivered" -> "DELIVERED") so status rules don't depend on case.
        shipping_status: text("order.shipping_status", o.shipping_status, 100)?.trim().toUpperCase().replace(/[\s-]+/g, "_"),
        // An empty tracking number means "not recorded", never a value.
        tracking_number: typeof tracking === "string" && tracking.trim() ? tracking : tracking === undefined ? undefined : null,
      };
    }
  }

  let evidence: Dispute["evidence"];
  if (input.evidence !== undefined) {
    if (!isObject(input.evidence)) {
      errors.push("evidence must be an object.");
    } else {
      const e = input.evidence;
      evidence = {
        order_confirmation: flag("evidence.order_confirmation", e.order_confirmation),
        shipping_tracking: flag("evidence.shipping_tracking", e.shipping_tracking),
        proof_of_delivery: flag("evidence.proof_of_delivery", e.proof_of_delivery),
        customer_communication: flag("evidence.customer_communication", e.customer_communication),
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    dispute: {
      source: source as Dispute["source"],
      dispute_id: dispute_id!,
      reason: reason!,
      status: status!,
      amount,
      customer_message,
      order,
      evidence,
    },
  };
}
