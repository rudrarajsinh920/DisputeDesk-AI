import type { Analysis, ChecklistItem, ChecklistStatus, Dispute, EvidenceChecklist, EvidenceKey, RequirementTier } from "../../shared/types.ts";
import { NOT_PROOF } from "./evidence.ts";
import { buildProvenance } from "./provenance.ts";

// Evidence checklist per dispute reason. Read-only over the evidence engine's analysis and its provenance, which stay
// the source of truth: an item that mirrors an engine finding takes its status from it, never from its own rules.
// No item is "official": that tier needs a PayPal source the user has verified, with its URL and the date checked.
// All text is guidance phrased as suggestions. DisputeDesk does not open documents or reach outside systems.

interface Guide {
  label: string;
  tier: RequirementTier;
  why: string;
  where: string[];
  check_before_adding: string[];
  limits: string;
}

const ENGINE_KEYS: EvidenceKey[] = ["order_confirmation", "shipping_tracking", "proof_of_delivery", "customer_communication"];

// Items the evidence engine assesses from the record's evidence flags.
const ENGINE_GUIDES: Record<EvidenceKey, Guide> = {
  order_confirmation: {
    label: "Order confirmation",
    tier: "general",
    why: "Shows what the buyer ordered and agreed to pay for.",
    where: ["Your store admin or order system, for this order", "The order confirmation email sent to the buyer", "The transaction details for this payment in your PayPal account"],
    check_before_adding: [
      "The order ID and amount match this dispute.",
      "The item and quantity match what the buyer bought.",
      "The buyer's name or email matches the PayPal transaction.",
    ],
    limits: "DisputeDesk sees only whether the records mark an order confirmation as available. It does not open the confirmation.",
  },
  shipping_tracking: {
    label: "Shipping tracking",
    tier: "general",
    why: "A carrier tracking record can show that the order was sent and how it moved.",
    where: ["Your shipping software or carrier account", "The carrier's tracking page for this order's tracking number", "Tracking you already added to this transaction in PayPal"],
    check_before_adding: [
      "The tracking number belongs to this order.",
      "The carrier shows the parcel was accepted, not only that a label was created.",
      "The destination matches the order's shipping address.",
    ],
    limits: "DisputeDesk cannot contact carriers. It reads only the tracking flag and tracking number in the records.",
  },
  proof_of_delivery: {
    label: "Proof of delivery",
    tier: "general",
    why: "A carrier delivery confirmation can show where and when the order arrived.",
    where: [
      "Your carrier account, or the carrier's tracking page for this tracking number",
      "Your shipping software",
      "Delivery confirmation you already submitted in PayPal",
    ],
    check_before_adding: [
      "The tracking number matches this order.",
      "The delivery address matches the order.",
      "The delivery date is after the ship date.",
      "The record is the carrier's own, not an edited screenshot.",
    ],
    limits: "DisputeDesk cannot open carrier systems or documents. It shows only what the records mark.",
  },
  customer_communication: {
    label: "Customer communication",
    tier: "general",
    why: "Messages with the buyer can show what was promised, reported or agreed.",
    where: ["Your email, help desk or chat history with this buyer", "The messages in this PayPal dispute"],
    check_before_adding: [
      "The messages are with this buyer and about this order.",
      "Dates and wording are exactly as sent, not retyped.",
      "Personal details that are not needed are removed.",
    ],
    limits: "DisputeDesk sees only whether the records mark communication as available. Apart from the buyer's dispute message, it does not read the messages.",
  },
};

// Items no record field can show. They are always "needs_confirmation".
const RECORD_GUIDES: Record<string, Guide> = {
  refund_id: {
    label: "Refund ID, if a refund was issued",
    tier: "general",
    why: "PayPal's dispute reasons reference lists proof of refund (the refund ID) for this reason.",
    where: ["The activity for this transaction in your PayPal account", "Refund records in your store admin or payment processor"],
    check_before_adding: [
      "The refund is for this transaction, not another order.",
      "The refund amount and currency match what the buyer is asking about.",
      "The refund has completed, not only been started.",
    ],
    limits: "DisputeDesk's records have no refund field, so it cannot see whether a refund was issued.",
  },
  other_transaction: {
    label: "The other payment's transaction ID",
    tier: "disputedesk",
    why: "If this charge repeats another payment, the other transaction's ID lets a reviewer compare the two.",
    where: ["The activity around the payment date in your PayPal account", "This buyer's orders in your store admin"],
    check_before_adding: [
      "Both payments are from the same buyer.",
      "The amounts and dates of both payments are noted.",
      "It is clear whether each payment was for a separate order.",
    ],
    limits: "DisputeDesk's records hold one transaction per dispute, so it cannot compare payments.",
  },
  listing_record: {
    label: "Listing or item description at the time of sale",
    tier: "disputedesk",
    why: "The buyer says the item differs from its description. The description shown when they ordered records what was offered.",
    where: ["A saved copy or archive of the listing page", "Past versions of the product in your store admin", "The item description in the order confirmation"],
    check_before_adding: [
      "The copy is from on or before the order date, not the current page.",
      "It is the same item and variant the buyer ordered.",
      "Photos and wording are unedited.",
    ],
    limits: "DisputeDesk has no listing records and cannot open your store or website.",
  },
  return_tracking: {
    label: "Return tracking, if the item was sent back",
    tier: "general",
    why: "If the buyer sent the item back, return tracking can show whether and when it reached you.",
    where: ["The return label or return request you issued", "Your carrier account, or the carrier's tracking page for the return"],
    check_before_adding: [
      "The tracking number belongs to this order's return.",
      "The delivery address is yours.",
      "The date the return arrived is noted.",
    ],
    limits: "DisputeDesk's records have no return field, so it cannot see whether the item was sent back.",
  },
  shipping_address: {
    label: "Shipping address the order went to",
    tier: "disputedesk",
    why: "The buyer says they did not authorize this payment. The order's shipping address can be compared with the address on the PayPal transaction.",
    where: ["The shipping address in your order system", "The shipping address on the transaction in your PayPal account"],
    check_before_adding: [
      "The two addresses are compared as recorded, not from memory.",
      "Any change made to the address after the order is noted.",
      "No more personal data is included than needed.",
    ],
    limits: "DisputeDesk's records have no address field and no sign-in or device data, so they cannot show who made the payment.",
  },
  your_position: {
    label: "Your position and the records behind it",
    tier: "disputedesk",
    why: "DisputeDesk has no reason-specific list for this reason, so start from what happened and which of your records show it.",
    where: ["Your order, payment and message records for this transaction"],
    check_before_adding: ["Every fact you state comes from a record you can show.", "Dates and amounts match the PayPal transaction."],
    limits: "DisputeDesk has no reason-specific guidance for this reason.",
  },
};

interface ReasonEntry {
  // Engine items that apply, then checklist-only items, in display order. Engine items left out are not applicable.
  items: (EvidenceKey | keyof typeof RECORD_GUIDES)[];
  // Reason-specific "why" for an engine item, where the general one does not fit.
  why?: Partial<Record<EvidenceKey, string>>;
  // Why the engine items left out do not apply to this reason.
  not_applicable?: string;
}

const REASONS: Record<string, ReasonEntry> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    items: ["shipping_tracking", "proof_of_delivery", "order_confirmation", "customer_communication"],
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    items: ["order_confirmation", "customer_communication", "listing_record", "return_tracking", "shipping_tracking", "proof_of_delivery"],
    why: {
      shipping_tracking: "Shows the item was sent. The buyer disputes what arrived, not whether it arrived.",
      proof_of_delivery: "Shows the item arrived. The buyer disputes what arrived, not whether it arrived.",
    },
  },
  UNAUTHORISED: {
    items: ["order_confirmation", "customer_communication", "shipping_address", "shipping_tracking", "proof_of_delivery"],
    why: {
      shipping_tracking: "Can show where the order was sent, for comparison with the address on the PayPal transaction.",
      proof_of_delivery: "Can show where the order was delivered, for comparison with the address on the PayPal transaction.",
    },
  },
  DUPLICATE_TRANSACTION: {
    items: ["refund_id", "other_transaction", "order_confirmation", "customer_communication"],
    why: { order_confirmation: "Shows which order this payment was for, so it can be compared with the other payment." },
    not_applicable: "A duplicate charge is about the payment, not the delivery.",
  },
  CREDIT_NOT_PROCESSED: {
    items: ["refund_id", "return_tracking", "customer_communication", "order_confirmation"],
    why: { customer_communication: "Messages can show what was agreed about a refund or a return." },
    not_applicable: "This reason is about a refund, not the original delivery.",
  },
};

const DEFAULT: ReasonEntry = { items: [...ENGINE_KEYS, "your_position"] };

export const CHECKLIST_NOTES = [
  "Missing from the records does not show that it did not happen.",
  "DisputeDesk does not open your documents or other systems. It shows what the supplied records mark.",
  "This checklist is guidance, not PayPal's requirements. Check PayPal's own instructions for this dispute.",
];

const isEngineKey = (id: string): id is EvidenceKey => (ENGINE_KEYS as string[]).includes(id);

export function buildChecklist(dispute: Dispute, analysis: Analysis): EvidenceChecklist {
  const entry = REASONS[dispute.reason];
  const reason = entry ?? DEFAULT;
  const provenance = buildProvenance(dispute, analysis);
  const findings = new Map(analysis.evidence.map((f) => [f.id, f]));
  const states = new Map(provenance.findings.map((f) => [f.evidence_id, f]));

  const item = (id: string, status: ChecklistStatus, guide: Guide, extra: Partial<ChecklistItem>): ChecklistItem => ({
    id,
    label: guide.label,
    tier: guide.tier,
    citation: null,
    status,
    priority: "supporting",
    evidence_key: null,
    refs: [],
    why: guide.why,
    where: guide.where,
    check_before_adding: guide.check_before_adding,
    limits: status === "missing" ? `${guide.limits} ${NOT_PROOF}` : guide.limits,
    ...extra,
  });

  const engineItem = (key: EvidenceKey): ChecklistItem => {
    const finding = findings.get(key)!;
    const state = states.get(key)!;
    // Same order as provenance: a contradiction naming the flag wins, then the engine's own status.
    const status: ChecklistStatus =
      state.verification === "conflicting"
        ? "conflicting"
        : finding.status === "available"
          ? "available"
          : finding.status === "missing"
            ? "missing"
            : "needs_confirmation";
    return item(key, status, ENGINE_GUIDES[key], {
      priority: finding.priority,
      evidence_key: key,
      refs: state.refs,
      why: reason.why?.[key] ?? ENGINE_GUIDES[key].why,
    });
  };

  const listed = reason.items.map((id) => (isEngineKey(id) ? engineItem(id) : item(id, "needs_confirmation", RECORD_GUIDES[id], {})));
  const notApplicable = ENGINE_KEYS.filter((k) => !reason.items.includes(k)).map((k) =>
    item(k, "not_applicable", ENGINE_GUIDES[k], {
      priority: findings.get(k)!.priority,
      evidence_key: k,
      why: `${ENGINE_GUIDES[k].why} ${reason.not_applicable ?? ""}`.trim(),
    }),
  );

  return {
    source: dispute.source,
    dispute_id: dispute.dispute_id,
    reason: dispute.reason,
    reason_known: entry !== undefined,
    // Key items first; not-applicable items last.
    items: [...listed.filter((i) => i.priority === "key"), ...listed.filter((i) => i.priority !== "key"), ...notApplicable],
    notes: CHECKLIST_NOTES,
  };
}
