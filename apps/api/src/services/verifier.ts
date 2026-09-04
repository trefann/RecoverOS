import { VerificationResultSchema, type RecoveryActionType, type VerificationResult } from "@recoveros/shared";
import type { ActionExecutionResult } from "./actionEngine.js";

export interface VerifyInput {
  actionType: RecoveryActionType;
  actionResult: ActionExecutionResult;
  providerPaymentId: string;
}

/**
 * Confirms what actually happened after actionEngine ran. Deterministic —
 * it interprets the provider's response, it doesn't ask the LLM to
 * self-report success.
 */
export function verify(input: VerifyInput): VerificationResult {
  if (input.actionType === "RETRY_PAYMENT") {
    return VerificationResultSchema.parse({
      status: input.actionResult.outcome === "SUCCESS" ? "RECOVERED" : "FAILED",
      amount_recovered: input.actionResult.amountRecovered,
      payment_id: input.providerPaymentId,
    });
  }

  // SEND_REMINDER, WAIT, ESCALATE_HUMAN never directly recover money by
  // themselves — the case stays at risk until a future event (e.g. the
  // customer pays and a new webhook arrives) resolves it.
  return VerificationResultSchema.parse({
    status: "STILL_AT_RISK",
    amount_recovered: 0,
    payment_id: input.providerPaymentId,
  });
}
