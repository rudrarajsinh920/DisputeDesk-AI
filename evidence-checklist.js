
const fs = require("fs");

const dispute = JSON.parse(
  fs.readFileSync("sample-dispute.json", "utf8")
);

function generateChecklist(dispute) {
  const evidence = dispute.evidence;
  const checklist = [];

  if (!evidence.order_confirmation) {
    checklist.push({
      item: "Order confirmation",
      reason: "No order confirmation is marked as available."
    });
  }

  if (!evidence.shipping_tracking || !dispute.order.tracking_number) {
    checklist.push({
      item: "Shipping tracking",
      reason: "Tracking evidence is missing or no tracking number is recorded."
    });
  }

  if (!evidence.proof_of_delivery) {
    checklist.push({
      item: "Proof of delivery",
      reason: "Proof of delivery is not marked as available."
    });
  }

  if (!evidence.customer_communication) {
    checklist.push({
      item: "Customer communication",
      reason: "Relevant customer communication is not marked as available."
    });
  }

  return checklist;
}

console.log("=== DisputeDesk AI ===");
console.log("DEMO DATA — NOT A REAL PAYPAL DISPUTE");
console.log(`Dispute: ${dispute.dispute_id}`);
console.log(`Amount: ${dispute.amount.currency_code} ${dispute.amount.value}`);
console.log(`Reason: ${dispute.reason}`);

const checklist = generateChecklist(dispute);

console.log("\nEvidence checklist:");

if (checklist.length === 0) {
  console.log("No missing evidence identified by these checks.");
} else {
  checklist.forEach((entry, index) => {
    console.log(`\n${index + 1}. ${entry.item}`);
    console.log(`   ${entry.reason}`);
  });
}
