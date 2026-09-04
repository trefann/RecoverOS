import { InvestigationResultSchema, type InvestigationResult, type RecoverabilityResult } from "@recoveros/shared";
import { callStructured } from "../ai/structuredCall.js";
import type { InsightBucket } from "./learningInsights.js";

export interface InvestigatorInput {
  amount: number;
  currency: string;
  method: string;
  failureReason: string | null;
  customerName: string;
  totalPayments: number;
  successfulPayments: number;
  previousRecoveryAttempts: number;
  recoverability: RecoverabilityResult;
  /** LEARN: real historical outcomes for this priority tier, if any exist yet. Null on a cold start. */
  priorityHistory?: InsightBucket | null;
}

/**
 * callStructured is injected (not imported directly by callers) purely so
 * tests can stub the LLM without a real ANTHROPIC_API_KEY. This module still
 * has zero access to actionEngine or any payment provider — see CHANGE 4.
 */
export type CallStructuredFn = typeof callStructured;

const SYSTEM_PROMPT = `You are the Investigator Agent inside RecoverOS, a revenue recovery system.
Given evidence about a failed payment and the customer's history, determine the most likely
cause of the failure and how confident you are. You are an analyst, not a decision maker:
you never propose or take a recovery action, you only characterize the situation.
Be conservative — if evidence is thin or contradictory, lower your confidence and recovery_probability
rather than guessing.`;

function buildPrompt(input: InvestigatorInput): string {
  const successRate =
    input.totalPayments > 0
      ? `${input.successfulPayments}/${input.totalPayments} previous payments succeeded`
      : "no prior payment history";

  return [
    `Customer: ${input.customerName}`,
    `Failed payment: ${input.amount} ${input.currency} via ${input.method}`,
    `Failure reason reported by processor: ${input.failureReason ?? "unknown"}`,
    `Payment history: ${successRate}`,
    `Previous recovery attempts for this customer: ${input.previousRecoveryAttempts}`,
    `Deterministic recoverability signals: ${input.recoverability.signals.join(", ")}`,
    `Deterministic recoverability score: ${input.recoverability.recoverabilityScore.toFixed(2)}`,
    `Deterministic risk score: ${input.recoverability.riskScore.toFixed(2)}`,
    input.priorityHistory
      ? `Learned from history: ${input.recoverability.priority}-priority cases have actually recovered ${input.priorityHistory.successRatePct}% of the time so far (${input.priorityHistory.recovered}/${input.priorityHistory.attempts} resolved cases). Weigh this alongside the evidence, not instead of it.`
      : `No historical outcome data yet for ${input.recoverability.priority}-priority cases — this may be one of the first.`,
    ``,
    `Investigate this failure and report the cause, your confidence, the evidence you used, and the probability this revenue can be recovered.`,
  ].join("\n");
}

export async function investigate(
  input: InvestigatorInput,
  deps: { callStructured?: CallStructuredFn } = {}
): Promise<InvestigationResult> {
  const call = deps.callStructured ?? callStructured;

  return call({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    schema: InvestigationResultSchema,
    toolName: "report_investigation",
    toolDescription:
      "Report the investigated cause of a payment failure with supporting evidence.",
  });
}
