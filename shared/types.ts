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

// "ai" lines are model-written text that passed the server's checks; they are never facts.
export type DraftLineKind = "notice" | "fact" | "missing" | "unverified" | "unsupported" | "input" | "conflict" | "ai";

export interface DraftLine {
  kind: DraftLineKind;
  text: string;
  // Record paths a "fact" line is based on.
  records: string[];
}

export interface Analysis {
  source: Source;
  dispute_id: string;
  evidence: EvidenceFinding[];
  contradictions: Contradiction[];
  next_steps: string[];
  draft: { lines: DraftLine[]; text: string };
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
}

export interface AiExplanation {
  evidence_id: EvidenceKey;
  // Always the rules' status, whatever the model said.
  status: EvidenceStatus;
  text: string;
  cites: string[];
  // "rules" when the model's text was missing or failed the checks.
  source: "ai" | "rules";
}

export interface AiFlag {
  where: string;
  reason: string;
  // Model text that was not used, shown so the merchant can see what was dropped.
  removed_text: string | null;
}

// From /api/health: whether the server can write AI drafts, and why not.
export type AiStatus = { on: true; model: string } | { on: false; reason: string };

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
