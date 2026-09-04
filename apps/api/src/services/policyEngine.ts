import {
  POLICY_LIMITS,
  RECOVERY_ACTIONS,
  PolicyVerdictSchema,
  type DecisionProposal,
  type InvestigationResult,
  type PolicyVerdict,
} from "@recoveros/shared";

export interface PolicyInput {
  proposal: DecisionProposal;
  investigation: InvestigationResult;
  amount: number;
  /** Count of RETRY_PAYMENT actions already recorded (any status) for this case. */
  retryAttemptsSoFar: number;
}

/**
 * The mandatory, deterministic gate between "AI proposes" and "code disposes".
 * No LLM calls happen here, ever. Every rule below is plain TypeScript so it
 * is fully auditable and testable without touching the network. actionEngine
 * must only ever be invoked when this returns allowed: true (see
 * recoveryOrchestrator.ts, the sole caller of both).
 */
export function evaluatePolicy(input: PolicyInput): PolicyVerdict {
  const reasons: string[] = [];
  let allowed = true;
  let escalate = false;

  const deny = (reason: string, opts: { escalate?: boolean } = {}) => {
    allowed = false;
    if (opts.escalate) escalate = true;
    reasons.push(reason);
  };

  // Defense in depth: the action must be one of the enumerated recovery
  // actions even though DecisionProposalSchema already enforces this at the
  // agent boundary. policyEngine must never trust an upstream guarantee.
  if (!RECOVERY_ACTIONS.includes(input.proposal.action)) {
    return PolicyVerdictSchema.parse({
      allowed: false,
      escalate: true,
      reasons: [`Unsupported action "${input.proposal.action}"`],
    });
  }

  if (
    input.proposal.action === "RETRY_PAYMENT" &&
    input.retryAttemptsSoFar >= POLICY_LIMITS.MAX_RETRIES_PER_CASE
  ) {
    deny(
      `Max retries per case (${POLICY_LIMITS.MAX_RETRIES_PER_CASE}) already reached (${input.retryAttemptsSoFar} so far)`,
      { escalate: true }
    );
  }

  if (
    input.proposal.action === "RETRY_PAYMENT" &&
    (input.proposal.delay_minutes < POLICY_LIMITS.MIN_RETRY_DELAY_MINUTES ||
      input.proposal.delay_minutes > POLICY_LIMITS.MAX_RETRY_DELAY_MINUTES)
  ) {
    deny(
      `delay_minutes ${input.proposal.delay_minutes} outside allowed range [${POLICY_LIMITS.MIN_RETRY_DELAY_MINUTES}, ${POLICY_LIMITS.MAX_RETRY_DELAY_MINUTES}]`,
      { escalate: true }
    );
  }

  if (input.amount >= POLICY_LIMITS.HIGH_VALUE_THRESHOLD && input.proposal.action !== "ESCALATE_HUMAN") {
    deny(
      `Amount ${input.amount} meets/exceeds high-value threshold ${POLICY_LIMITS.HIGH_VALUE_THRESHOLD}; requires human approval`,
      { escalate: true }
    );
  }

  if (input.proposal.confidence < POLICY_LIMITS.MIN_DECISION_CONFIDENCE) {
    deny(
      `Decision confidence ${input.proposal.confidence} below minimum ${POLICY_LIMITS.MIN_DECISION_CONFIDENCE}`,
      { escalate: true }
    );
  }

  if (input.investigation.confidence < POLICY_LIMITS.MIN_INVESTIGATION_CONFIDENCE) {
    deny(
      `Investigation confidence ${input.investigation.confidence} below minimum ${POLICY_LIMITS.MIN_INVESTIGATION_CONFIDENCE}`,
      { escalate: true }
    );
  }

  if (allowed) {
    reasons.push("All policy checks passed");
  }

  return PolicyVerdictSchema.parse({ allowed, reasons, escalate });
}
