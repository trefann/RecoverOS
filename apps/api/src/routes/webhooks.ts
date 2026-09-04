import { Router } from "express";
import { PaymentWebhookEventSchema } from "@recoveros/shared";
import { processPaymentFailedWebhook } from "../services/recoveryOrchestrator.js";

export const webhooksRouter = Router();

/**
 * Pure HTTP concerns only: validate the payload, hand it to the
 * orchestrator, translate the result to a response. All workflow logic
 * (idempotency, detect/investigate/decide/policy/act) lives in
 * recoveryOrchestrator.ts.
 *
 * A real deployment would also verify the provider's webhook signature here
 * before parsing the body — out of scope for the MVP's simulated events.
 */
webhooksRouter.post("/payment", async (req, res) => {
  const parsed = PaymentWebhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid webhook payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await processPaymentFailedWebhook(parsed.data);
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      caseId: result.case.id,
      status: result.case.status,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[webhooks/payment] processing failed", error);
    res.status(500).json({ error: "Failed to process event" });
  }
});
