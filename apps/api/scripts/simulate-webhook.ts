import "dotenv/config";

/**
 * Fires the MVP demo scenario's payment.failed event at a running local API
 * instance: Priya Sharma's ₹5,000 UPI payment fails with a bank timeout.
 * Run with the api dev server already up: `npm run demo:webhook --workspace apps/api`.
 * Run it twice in a row to see webhook idempotency (CHANGE 2) in action —
 * the second call returns duplicate: true with the same caseId.
 */
async function main() {
  const port = process.env.API_PORT ?? 4000;
  const baseUrl = `http://localhost:${port}`;

  const providerEventId = process.argv[2] ?? `evt_demo_${Date.now()}`;

  const payload = {
    event_type: "payment.failed",
    provider_event_id: providerEventId,
    payment_id: "pay_123",
    customer_id: "cus_456",
    amount: 5000,
    currency: "INR",
    method: "upi",
    failure_reason: "bank_timeout",
  };

  console.log(`POST ${baseUrl}/webhooks/payment`, payload);

  const res = await fetch(`${baseUrl}/webhooks/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  console.log(`-> ${res.status}`, body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
