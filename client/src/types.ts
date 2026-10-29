export type Source = "demo" | "paypal_sandbox";

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

export type DraftLineKind = "notice" | "fact" | "missing" | "unverified" | "unsupported" | "input" | "conflict";

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
