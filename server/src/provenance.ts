import type { AiAssist, Analysis, Dispute, DraftLine, EvidenceFinding, EvidenceRef, Provenance, SourceType, VerificationState } from "../../shared/types.ts";

// Evidence provenance: where each value came from and how far the records back it up. Read-only over the record and
// the evidence engine's analysis, which stays the source of truth: no status, count or draft text is changed here.
// Derived on every request and never stored, so it works the same for demo records and read-only PayPal records.

// Every field the engine reads, in a fixed order so refs come out the same way every time.
const FIELDS = [
  "dispute_id",
  "reason",
  "status",
  "amount",
  "create_time",
  "seller_response_due_date",
  "customer_message",
  "order.order_id",
  "order.item",
  "order.shipping_status",
  "order.tracking_number",
  "evidence.order_confirmation",
  "evidence.shipping_tracking",
  "evidence.proof_of_delivery",
  "evidence.customer_communication",
];

// How paypal.ts (normalizeDetails) fills each field from PayPal's dispute record. Demo values are read as supplied.
const PAYPAL_DERIVATION: Record<string, string> = {
  customer_message: "The buyer's messages in the PayPal dispute record.",
  "order.order_id": "The seller transaction ID in the PayPal dispute record.",
  "order.item": "The first item's name or description in the PayPal dispute record.",
  "order.tracking_number": "The first tracking number in evidence already submitted to PayPal.",
  "evidence.order_confirmation":
    "Set because the PayPal record has a seller transaction ID. That is a transaction record, not an order confirmation document.",
  "evidence.customer_communication": "Set because the PayPal record has at least one message, from either party.",
  "evidence.shipping_tracking": "Set because evidence already submitted to PayPal includes a tracking number.",
  "evidence.proof_of_delivery": "Set because evidence already submitted to PayPal has a proof-of-delivery type.",
};

const DELIVERY_FIELDS = new Set(["order.tracking_number", "evidence.shipping_tracking", "evidence.proof_of_delivery"]);
const TRANSACTION_FIELDS = new Set(["order.order_id", "order.item", "evidence.order_confirmation"]);

export const refId = (dispute: Pick<Dispute, "source" | "dispute_id">, path: string) => `${dispute.source}:${dispute.dispute_id}:${path}`;

function sourceType(source: Dispute["source"], path: string): SourceType {
  if (path === "customer_message") return "buyer_statement";
  if (!path.includes(".")) return "dispute_record";
  if (DELIVERY_FIELDS.has(path)) return "delivery_record";
  if (source === "paypal_sandbox" && TRANSACTION_FIELDS.has(path)) return "transaction_record";
  if (source === "paypal_sandbox" && path === "evidence.customer_communication") return "dispute_record";
  if (path.startsWith("order.")) return "order_record";
  // Demo evidence flags for order confirmation and communication are the merchant's own statement that it exists.
  return "merchant_provided";
}

function valueAt(dispute: Dispute, path: string): string | boolean | null {
  if (path === "amount") return dispute.amount ? `${dispute.amount.currency_code} ${dispute.amount.value}` : null;
  let value: unknown = dispute;
  for (const key of path.split(".")) value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  if (typeof value === "string") return value.trim() ? value : null;
  return typeof value === "boolean" ? value : null;
}

// A finding is conflicting when a contradiction names its own evidence flag. Every contradiction rule names the flag
// it concerns, so a conflict about delivery never marks tracking as conflicting just because both cite the shipping status.
function findingState(finding: EvidenceFinding, contested: Set<string>): VerificationState {
  if (contested.has(`evidence.${finding.id}`)) return "conflicting";
  if (finding.status === "missing") return "missing";
  if (finding.status === "unverified") return "unverified";
  return "verified";
}

export function buildProvenance(dispute: Dispute, analysis: Analysis): Provenance {
  const contested = new Set(analysis.contradictions.flatMap((c) => c.records.map((r) => r.path)));
  const findingStates = new Map(analysis.evidence.map((f) => [`evidence.${f.id}`, findingState(f, contested)]));
  // Fields the analysis points at are listed even when empty, so a gap has a ref to show.
  const referenced = new Set([
    ...analysis.evidence.flatMap((f) => f.records.map((r) => r.path)),
    ...contested,
    ...analysis.draft.lines.flatMap((l) => l.records),
  ]);
  const origin = dispute.source === "demo" ? "demo_fixture" : "paypal_sandbox";
  const orderId = valueAt(dispute, "order.order_id");

  const refs: EvidenceRef[] = [];
  for (const field of FIELDS) {
    const value = valueAt(dispute, field);
    if (value === null && !referenced.has(field)) continue;
    const type = sourceType(dispute.source, field);
    let verification: VerificationState;
    if (findingStates.has(field)) verification = findingStates.get(field)!;
    else if (contested.has(field)) verification = "conflicting";
    else if (value === null) verification = "missing";
    // The buyer's message is their claim. Having it on record never makes it verified.
    else verification = type === "buyer_statement" ? "unverified" : "verified";
    refs.push({
      ref: refId(dispute, field),
      source_type: type,
      origin,
      record_id: type === "dispute_record" || type === "buyer_statement" ? dispute.dispute_id : typeof orderId === "string" ? orderId : null,
      field,
      value,
      recorded_at: null,
      derivation: dispute.source === "paypal_sandbox" && value !== null ? (PAYPAL_DERIVATION[field] ?? null) : null,
      verification,
    });
  }

  return {
    refs,
    findings: analysis.evidence.map((f) => ({
      evidence_id: f.id,
      verification: findingStates.get(`evidence.${f.id}`)!,
      refs: f.records.map((r) => refId(dispute, r.path)),
      supports: f.relevance,
    })),
  };
}

// ---- Response decoration. Only adds keys; every existing field, line text and draft text stays exactly as it was. ----

const withLineRefs = (dispute: Dispute, lines: DraftLine[]) => lines.map((l) => ({ ...l, refs: l.records.map((p) => refId(dispute, p)) }));

// POST /api/analysis: the rules' analysis plus its provenance and the refs behind each draft line.
export function withProvenance(dispute: Dispute, analysis: Analysis): Analysis {
  return {
    ...analysis,
    draft: { ...analysis.draft, lines: withLineRefs(dispute, analysis.draft.lines) },
    provenance: buildProvenance(dispute, analysis),
  };
}

// AI routes: R-number cites mapped to refs on the server, after the Gemini call. Gemini only ever sees R ids.
export function assistWithRefs(dispute: Dispute, assist: AiAssist): AiAssist {
  const refOf = new Map(assist.facts.map((f) => [f.id, refId(dispute, f.path)]));
  return {
    ...assist,
    facts: assist.facts.map((f) => ({ ...f, ref: refId(dispute, f.path) })),
    explanations: assist.explanations.map((e) => ({ ...e, refs: e.cites.flatMap((c) => refOf.get(c) ?? []) })),
    draft: { ...assist.draft, lines: withLineRefs(dispute, assist.draft.lines) },
  };
}
