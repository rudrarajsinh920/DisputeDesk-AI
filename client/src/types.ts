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
  order?: {
    order_id: string;
    item: string;
    shipping_status: string;
    tracking_number: string | null;
  };
  evidence?: {
    proof_of_delivery: boolean;
    shipping_tracking: boolean;
    order_confirmation: boolean;
    customer_communication: boolean;
  };
}
