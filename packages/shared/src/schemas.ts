import { z } from "zod";
import { RECOVERY_ACTIONS, CASE_PRIORITIES, POLICY_LIMITS } from "./constants.js";

/** Inbound payment webhook event (mirrors what a real Razorpay-style webhook would send). */
export const PaymentWebhookEventSchema = z.object({
  event_type: z.literal("payment.failed"),
  provider_event_id: z.string().min(1),
  payment_id: z.string().min(1),
  customer_id: z.string().min(1),
  // Optional: most real gateway webhooks only carry a customer id. When
  // present (e.g. from a merchant backend that enriches the event before
  // forwarding it), it's used to create the customer record on first sight.
  customer_name: z.string().min(1).optional(),
  customer_email: z.string().email().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  method: z.string().min(1),
  failure_reason: z.string().min(1),
});
export type PaymentWebhookEvent = z.infer<typeof PaymentWebhookEventSchema>;

/** Deterministic output of recoverabilityEngine.ts — evidence handed to the Investigator. */
export const RecoverabilityResultSchema = z.object({
  recoverabilityScore: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  priority: z.enum(CASE_PRIORITIES),
  signals: z.array(z.string()),
});
export type RecoverabilityResult = z.infer<typeof RecoverabilityResultSchema>;

/** Validated structured output of investigatorAgent.ts (LLM call #1). No side effects. */
export const InvestigationResultSchema = z.object({
  cause: z.enum([
    "temporary_payment_failure",
    "insufficient_funds",
    "expired_card",
    "customer_abandoned",
    "invoice_overdue",
    "suspected_fraud",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).min(1),
  recovery_probability: z.number().min(0).max(1),
});
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

/** Validated structured output of decisionAgent.ts (LLM call #2). A *proposal*, not an executed action. */
export const DecisionProposalSchema = z.object({
  action: z.enum(RECOVERY_ACTIONS),
  delay_minutes: z
    .number()
    .int()
    .min(0)
    .max(POLICY_LIMITS.MAX_RETRY_DELAY_MINUTES),
  max_attempts: z.number().int().min(0).max(POLICY_LIMITS.MAX_RETRIES_PER_CASE),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;

/** Output of policyEngine.ts — the only thing that may authorize actionEngine to run. */
export const PolicyVerdictSchema = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  /** If allowed=false, the case should move to this status (e.g. ESCALATED). */
  escalate: z.boolean(),
});
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;

/** Output of verifier.ts after actionEngine executes an action. */
export const VerificationResultSchema = z.object({
  status: z.enum(["RECOVERED", "STILL_AT_RISK", "FAILED"]),
  amount_recovered: z.number().min(0),
  payment_id: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
