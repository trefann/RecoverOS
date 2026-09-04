import {
  DecisionProposalSchema,
  POLICY_LIMITS,
  RECOVERY_ACTIONS,
  type DecisionProposal,
  type InvestigationResult,
} from "@recoveros/shared";
import { callStructured } from "../ai/structuredCall.js";
import type { CallStructuredFn } from "./investigatorAgent.js";
import type { InsightBucket } from "./learningInsights.js";

export interface DecisionInput {
  amount: number;
  currency: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  investigation: InvestigationResult;
  attemptsSoFar: number;
  /** LEARN: real historical outcomes for this diagnosed cause, if any exist yet. Null on a cold start. */
  causeHistory?: InsightBucket | null;
}

const SYSTEM_PROMPT = `You are the Decision Agent inside RecoverOS, a revenue recovery system.
You PROPOSE a single recovery action based on the Investigator's findings. You do not execute
anything — a separate deterministic policy engine will validate or reject your proposal before
any action is ever taken, so be honest about your confidence rather than optimizing to "look decisive".

Allowed actions, exactly as named: ${RECOVERY_ACTIONS.join(", ")}.
- RETRY_PAYMENT: only when the failure looks temporary and there is a real chance a retry succeeds.
- SEND_REMINDER: for abandoned checkouts or overdue invoices where a nudge might work.
- WAIT: when it's too early to act (e.g. a subscription retry window hasn't opened).
- ESCALATE_HUMAN: when confidence is low, the amount is large, or the situation looks unusual.

Hard limits you must respect: at most ${POLICY_LIMITS.MAX_RETRIES_PER_CASE} total retries per case,
and this case has already had ${"{{attemptsSoFar}}"} attempt(s). Never propose delay_minutes of 0 for
RETRY_PAYMENT unless the failure reason is clearly instantaneous.`;

function buildPrompt(input: DecisionInput): string {
  return [
    `Case amount at risk: ${input.amount} ${input.currency}`,
    `Case priority: ${input.priority}`,
    `Retry attempts already made on this case: ${input.attemptsSoFar} (limit ${POLICY_LIMITS.MAX_RETRIES_PER_CASE})`,
    `Investigator's cause: ${input.investigation.cause} (confidence ${input.investigation.confidence.toFixed(2)})`,
    `Investigator's evidence: ${input.investigation.evidence.join("; ")}`,
    `Investigator's recovery_probability: ${input.investigation.recovery_probability.toFixed(2)}`,
    input.causeHistory
      ? `Learned from history: cases diagnosed with cause "${input.investigation.cause}" have actually recovered ${input.causeHistory.successRatePct}% of the time so far (${input.causeHistory.recovered}/${input.causeHistory.attempts} resolved cases). Weigh this alongside the investigator's confidence, not instead of it.`
      : `No historical outcome data yet for cause "${input.investigation.cause}" — this may be one of the first.`,
    ``,
    `Propose the single best recovery action for this case.`,
  ].join("\n");
}

export async function decide(
  input: DecisionInput,
  deps: { callStructured?: CallStructuredFn } = {}
): Promise<DecisionProposal> {
  const call = deps.callStructured ?? callStructured;

  return call({
    system: SYSTEM_PROMPT.replace("{{attemptsSoFar}}", String(input.attemptsSoFar)),
    prompt: buildPrompt(input),
    schema: DecisionProposalSchema,
    toolName: "propose_recovery_action",
    toolDescription: "Propose exactly one recovery action for this case, to be validated by the policy engine.",
  });
}
