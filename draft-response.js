
const fs = require("fs");

const dispute = JSON.parse(
  fs.readFileSync("sample-dispute.json", "utf8")
);

function createDraft(dispute) {
  const tracking = dispute.order.tracking_number;
  const evidence = dispute.evidence;

  return `
DISPUTE RESPONSE DRAFT
DEMO ONLY — NOT SUBMITTED TO PAYPAL

Dispute ID: ${dispute.dispute_id}
Amount: ${dispute.amount.currency_code} ${dispute.amount.value}
Reason: ${dispute.reason}

Summary:
The customer reports that the order was not received.

Available information:
- Order confirmation: ${evidence.order_confirmation ? "Available" : "Missing"}
- Customer communication: ${evidence.customer_communication ? "Available" : "Missing"}
- Shipping tracking: ${tracking || "Not provided"}
- Proof of delivery: ${evidence.proof_of_delivery ? "Available" : "Not provided"}

Recommended next steps:
1. Verify the order and fulfillment records.
2. Locate valid shipping and tracking records, if available.
3. Check whether proof of delivery exists.
4. Review the evidence before preparing a final response.

Important:
This draft does not establish that the order was delivered.
Confirm all facts and applicable evidence requirements before submission.
`;
}

console.log(createDraft(dispute));
