import {
  POLICY_LIMITS,
  RecoverabilityResultSchema,
  type RecoverabilityResult,
  type SourceType,
} from "@recoveros/shared";

// Failure reasons treated as transient (infra/bank-side hiccups) rather than
// a structural problem with the customer's ability/willingness to pay.
const TRANSIENT_FAILURE_REASONS = new Set([
  "bank_timeout",
  "network_error",
  "processor_unavailable",
  "insufficient_funds",
  "processor_declined_temporary",
]);

export interface CustomerPaymentHistory {
  totalPayments: number;
  successfulPayments: number;
  previousRecoveryAttempts: number;
}

export interface RecoverabilityInput {
  sourceType: SourceType;
  amount: number;
  failureReason: string | null;
  history: CustomerPaymentHistory;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Deterministic evaluation of whether a failed revenue event looks
 * recoverable, and how urgent it is. Pure code — no LLM involvement. Its
 * output is *evidence* handed to investigatorAgent.ts, not a final decision.
 */
export function evaluateRecoverability(input: RecoverabilityInput): RecoverabilityResult {
  const { amount, failureReason, history } = input;
  const successRate =
    history.totalPayments > 0 ? history.successfulPayments / history.totalPayments : 0.5;

  const isTransient = failureReason ? TRANSIENT_FAILURE_REASONS.has(failureReason) : false;
  const baseRecoverability = isTransient ? 0.7 : 0.4;

  const recoverabilityScore = clamp01(
    baseRecoverability + successRate * 0.3 - history.previousRecoveryAttempts * 0.15
  );

  const amountFactor = clamp01(amount / POLICY_LIMITS.HIGH_VALUE_THRESHOLD);
  const riskScore = clamp01(amountFactor * 0.6 + (1 - successRate) * 0.4);

  const isHighValue = amount >= POLICY_LIMITS.HIGH_VALUE_THRESHOLD;
  const priority = isHighValue || riskScore >= 0.7 ? "HIGH" : riskScore >= 0.4 ? "MEDIUM" : "LOW";

  const signals: string[] = [];
  if (failureReason) signals.push(failureReason);
  signals.push(
    `${history.successfulPayments} of ${history.totalPayments} previous payments succeeded`
  );
  if (isTransient) signals.push("transient_failure_reason");
  if (isHighValue) signals.push("high_value_transaction");
  if (history.previousRecoveryAttempts > 0) {
    signals.push(`${history.previousRecoveryAttempts} previous recovery attempt(s)`);
  }

  const result: RecoverabilityResult = {
    recoverabilityScore,
    riskScore,
    priority,
    signals,
  };

  // Validate our own output — cheap insurance that downstream consumers
  // (investigatorAgent, the audit log) can always trust this shape.
  return RecoverabilityResultSchema.parse(result);
}
