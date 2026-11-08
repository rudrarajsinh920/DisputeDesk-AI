export type Source = "demo" | "paypal_sandbox";

export type Role = "merchant" | "buyer" | "admin";

// What the browser may know about the signed-in account. Never a password hash or session token.
export interface AccountInfo {
  id: string;
  email: string;
  role: Role;
  display_name: string;
  paypal_sandbox: boolean;
}

export interface Money {
  currency_code: string;
  value: string;
}

export interface Dispute {
  source: Source;
  dispute_id: string;
  reason: string;
  status: string;
  // null when PayPal sends no amount; never filled in.
  amount: Money | null;
  create_time?: string;
  // PayPal's deadline for the seller's response, only when the record has one.
  seller_response_due_date?: string;
  customer_message?: string;
  // Every field may be missing in incomplete records; missing means "not supplied", never "false".
  order?: {
    order_id?: string;
    item?: string;
    shipping_status?: string;
    tracking_number?: string | null;
  };
  evidence?: {
    proof_of_delivery?: boolean;
    shipping_tracking?: boolean;
    order_confirmation?: boolean;
    customer_communication?: boolean;
  };
}

// Shared with the server's evidence engine (server/src/evidence.ts).
export type EvidenceKey = "order_confirmation" | "shipping_tracking" | "proof_of_delivery" | "customer_communication";
export type EvidenceStatus = "available" | "missing" | "unverified";

// A supplied record field and its value; null means the record did not contain it.
export interface RecordRef {
  path: string;
  value: string | boolean | null;
}

export interface EvidenceFinding {
  id: EvidenceKey;
  label: string;
  status: EvidenceStatus;
  priority: "key" | "supporting";
  relevance: string;
  explanation: string;
  records: RecordRef[];
}

export interface Contradiction {
  message: string;
  records: RecordRef[];
}

// ---- Evidence provenance (server/src/provenance.ts). Derived from the record and the rules on every request; never stored. ----

// "verified" means consistent with the supplied record and not contradicted by it ("Verified against record").
// DisputeDesk does not inspect documents or contact carriers.
export type VerificationState = "verified" | "unverified" | "missing" | "conflicting";

// What kind of record a field belongs to. "refund_record" and "document" are reserved: DisputeDesk has no refund
// field and no document upload, so neither is ever produced.
export type SourceType =
  | "dispute_record"
  | "buyer_statement"
  | "order_record"
  | "transaction_record"
  | "delivery_record"
  | "merchant_provided"
  | "refund_record"
  | "document";

export interface EvidenceRef {
  // Stable: "<source>:<dispute_id>:<path>", e.g. "demo:DEMO-1001:order.tracking_number".
  ref: string;
  source_type: SourceType;
  origin: "demo_fixture" | "paypal_sandbox";
  // The order (demo) or seller transaction (sandbox) the field belongs to; the dispute ID for dispute-level fields.
  record_id: string | null;
  field: string;
  // null means not on record.
  value: string | boolean | null;
  // A real time from the record only. No evidence field has one today, so it is always null; never the import time.
  recorded_at: string | null;
  // How DisputeDesk got a value it inferred from a PayPal record; null when the value was read as is.
  derivation: string | null;
  verification: VerificationState;
}

export interface FindingProvenance {
  evidence_id: EvidenceKey;
  verification: VerificationState;
  refs: string[];
  // How this evidence can support the merchant's response (the rules' relevance text).
  supports: string;
}

export interface Provenance {
  refs: EvidenceRef[];
  findings: FindingProvenance[];
}

// "ai" lines are model-written text that passed the server's checks; they are never facts.
export type DraftLineKind = "notice" | "fact" | "missing" | "unverified" | "unsupported" | "input" | "conflict" | "ai";

export interface DraftLine {
  kind: DraftLineKind;
  text: string;
  // Record paths a "fact" line is based on.
  records: string[];
  // The same records as provenance refs (merchant and admin responses only; never sent to Gemini or buyers).
  refs?: string[];
}

export interface Analysis {
  source: Source;
  dispute_id: string;
  evidence: EvidenceFinding[];
  contradictions: Contradiction[];
  next_steps: string[];
  draft: { lines: DraftLine[]; text: string };
  // Added by POST /api/analysis; the fields above are unchanged by it.
  provenance?: Provenance;
}

// ---- Evidence checklist per dispute reason (server/src/checklist.ts). Derived from the Analysis; never stored. ----

// "official" needs a verified PayPal source; "general" is common practice; "disputedesk" is DisputeDesk's own guidance.
export type RequirementTier = "official" | "general" | "disputedesk";
// "needs_confirmation": no record field shows it, so the merchant confirms it from their own records.
// "not_applicable": does not bear on this reason and is never counted as a gap.
export type ChecklistStatus = "available" | "missing" | "conflicting" | "needs_confirmation" | "not_applicable";

export interface ChecklistItem {
  id: string;
  label: string;
  tier: RequirementTier;
  // Required when tier is "official"; null otherwise.
  citation: { url: string; checked_on: string } | null;
  status: ChecklistStatus;
  // The engine's priority for items it assesses; "supporting" for checklist-only items.
  priority: "key" | "supporting";
  // The evidence finding this item mirrors; null for items no record field can show.
  evidence_key: EvidenceKey | null;
  // Provenance refs behind the status.
  refs: string[];
  why: string;
  where: string[];
  check_before_adding: string[];
  limits: string;
}

export interface EvidenceChecklist {
  source: Source;
  dispute_id: string;
  reason: string;
  // false: no reason-specific list, so the generic list is shown.
  reason_known: boolean;
  items: ChecklistItem[];
  notes: string[];
}

// AI-assisted explanations and draft (server/src/assist.ts). The rule-based Analysis stays authoritative.
// A supplied record value the model may cite by id (R1, R2…).
export interface AiFact {
  id: string;
  path: string;
  label: string;
  value: string;
  // Named in a contradiction found by the rules.
  contested: boolean;
  // Provenance ref of the field, added after the Gemini call. Gemini only ever sees the id.
  ref?: string;
}

export interface AiExplanation {
  evidence_id: EvidenceKey;
  // Always the rules' status, whatever the model said.
  status: EvidenceStatus;
  text: string;
  cites: string[];
  // The cites as provenance refs.
  refs?: string[];
  // "rules" when the model's text was missing or failed the checks.
  source: "ai" | "rules";
}

export interface AiFlag {
  where: string;
  reason: string;
  // Model text that was not used, shown so the merchant can see what was dropped.
  removed_text: string | null;
}

// ---- Buyer Dispute Clarity (server/src/buyer.ts). Built only from fields the buyer may see. ----

// The usual order of a dispute. "earlier" and "later" are relative to the current status, not recorded history.
// "unknown" when the status code is not one DisputeDesk recognises.
export type BuyerStageState = "earlier" | "current" | "later" | "unknown";

export interface BuyerStage {
  id: "opened" | "responses" | "review" | "closed";
  label: string;
  state: BuyerStageState;
  // Only the opened date, and only when the record has it. No other stage has a recorded date.
  date: string | null;
}

// General guidance chosen by rules from the status and reason codes. Never a fact about the transaction.
export interface BuyerGuidance {
  status_known: boolean;
  meaning: string;
  stages: BuyerStage[];
  next_steps: string[];
  may_provide: string[];
  contact: string[];
  // Things this record does not contain. Never treated as meaning anything.
  not_on_record: string[];
  notice: string;
}

// What a buyer receives: no order, evidence, customer message or merchant drafts.
export interface BuyerDispute {
  source: Source;
  dispute_id: string;
  reason: string;
  status: string;
  amount: Money | null;
  create_time?: string;
  guidance: BuyerGuidance;
}

export interface BuyerExplanation {
  source: Source;
  dispute_id: string;
  // "ai" only when every paragraph passed the server's checks; otherwise the rules' standard explanation.
  origin: "ai" | "rules";
  model: string | null;
  paragraphs: string[];
  // Why the standard explanation is shown instead of AI wording; null when origin is "ai".
  fallback_reason: string | null;
  // Which checks the AI wording failed. The failed text itself is never shown to the buyer.
  flags: string[];
}

// ---- Dispute Prevention & Resolution Intelligence (server/src/intelligence.ts). Rule-based, counts only. ----

// A count and the IDs behind it. Percentages are never sent; the browser shows one only when the total is large enough
// (formatShare in shared/disputes.ts).
export interface CountRow {
  key: string;
  label: string;
  count: number;
  dispute_ids: string[];
}

// One evidence type across the merchant's disputes, using the evidence engine's statuses.
export interface EvidenceTally {
  id: EvidenceKey;
  label: string;
  available: number;
  missing: number;
  unverified: number;
  missing_ids: string[];
  unverified_ids: string[];
}

export interface MonthRow {
  // "2026-07", from the opened date (UTC).
  month: string;
  disputes: number;
  evidence_available: number;
  // Four evidence types per dispute.
  evidence_total: number;
}

export type Trend =
  | { shown: true; months: MonthRow[]; dated: number; undated: number }
  | { shown: false; reason: string; dated: number; undated: number };

export type PatternId =
  | "delivery_proof_gap"
  | "tracking_gap"
  | "communication_gap"
  | "order_record_gap"
  | "credit_disputes"
  | "conflicting_records"
  | "awaiting_seller"
  | "open_over_30_days";

// Something the rules found. "of" is how many disputes it was checked against.
export interface Pattern {
  id: PatternId;
  title: string;
  count: number;
  of: number;
  dispute_ids: string[];
  // Record fields the finding comes from, like "evidence.proof_of_delivery".
  records: string[];
  // Seen in at least the recurring minimum of disputes.
  recurring: boolean;
}

export interface Recommendation {
  id: "delivery_confirmation" | "tracking_records" | "customer_communication" | "transaction_records" | "conflicting_records" | "unresolved_review";
  title: string;
  detected: string;
  supporting: { pattern_ids: PatternId[]; dispute_ids: string[]; records: string[] };
  why: string;
  action: string;
  // Never "high": the data is a handful of synthetic records and evidence flags.
  confidence: "limited" | "moderate";
  limitation: string;
}

export interface Intelligence {
  source: "demo";
  // "account" for a merchant's own disputes; "all" for the read-only admin view.
  scope: "account" | "all";
  // The day ages are measured to (UTC, YYYY-MM-DD).
  as_of: string;
  total: number;
  // Plain-language limits of this data set, always shown.
  notes: string[];
  status: CountRow[];
  reasons: CountRow[];
  resolution: { resolved: number; unresolved: number };
  evidence: EvidenceTally[];
  patterns: Pattern[];
  trend: Trend;
  recommendations: Recommendation[];
  thresholds: { percent_min: number; recurring_min: number; trend_min_dated: number; trend_min_months: number; open_days: number };
}

export interface IntelligenceExplanation {
  origin: "ai" | "rules";
  model: string | null;
  paragraphs: string[];
  fallback_reason: string | null;
  flags: string[];
}

// From /api/health: whether the server can write AI drafts, and why not.
export type AiStatus = { on: true; model: string } | { on: false; reason: string };

// From /api/analysis/check: the merchant's edited draft run through the same checks as AI text. Advisory only:
// the merchant may hold records DisputeDesk does not, so nothing is removed or stored.
export interface DraftCheck {
  source: Source;
  dispute_id: string;
  // Paragraphs with merchant-written text (lines DisputeDesk wrote, quoted buyer lines and markers are skipped).
  checked: number;
  flagged: { paragraph: number; excerpt: string; reasons: string[] }[];
  markers_left: number;
  // One entry per checked paragraph, numbered like "flagged".
  claims: ParagraphClaim[];
}

// How far DisputeDesk's records back a merchant-written paragraph. Advisory: the merchant may hold records DisputeDesk
// does not. "supported" means a relevant, uncontested record backs every claim found; never that a document was checked.
export type ClaimSupport = "supported" | "unsupported" | "flagged" | "not_a_claim";

export interface ParagraphClaim {
  paragraph: number;
  excerpt: string;
  support: ClaimSupport;
  // Provenance refs of the records that back the paragraph's claims; empty when nothing backs it or it is flagged.
  refs: string[];
  // Why it is flagged or unsupported; empty otherwise.
  reasons: string[];
}

export interface AiAssist {
  source: Source;
  dispute_id: string;
  model: string;
  status: "ok" | "flagged";
  facts: AiFact[];
  explanations: AiExplanation[];
  flags: AiFlag[];
  draft: { lines: DraftLine[]; text: string };
}
