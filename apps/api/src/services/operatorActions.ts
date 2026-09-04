import { POLICY_LIMITS } from "@recoveros/shared";
import type { RecoveryCase } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { logAudit } from "./auditLog.js";
import { claimAndExecuteAction } from "./actionExecutor.js";
import { getDefaultProvider } from "../integrations/payments/defaultProvider.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

/** Case statuses that mean nothing further should happen automatically or manually. */
const TERMINAL_STATUSES = ["RECOVERED", "FAILED", "POLICY_REJECTED"] as const;

export class OperatorActionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
  }
}

/**
 * Direct human override, not an AI proposal — a case landed on a dashboard
 * operator's desk and they're closing it out themselves. Logged as actor
 * OPERATOR specifically so it's never mistaken for policyEngine's automatic
 * escalation in the audit trail.
 */
export async function escalateCase(caseId: string, reason?: string): Promise<RecoveryCase> {
  const existing = await prisma.recoveryCase.findUnique({ where: { id: caseId } });
  if (!existing) {
    throw new OperatorActionError("Case not found", 404);
  }
  if (TERMINAL_STATUSES.includes(existing.status as (typeof TERMINAL_STATUSES)[number])) {
    throw new OperatorActionError(`Case is already ${existing.status}; nothing to escalate`, 409);
  }

  const updated = await prisma.recoveryCase.update({
    where: { id: caseId },
    data: { status: "ESCALATED", reason: reason ?? "Manually escalated by operator" },
  });

  await logAudit({
    caseId,
    actor: "OPERATOR",
    summary: reason ? `Manually escalated: ${reason}` : "Manually escalated by operator",
    payload: { reason: reason ?? null },
  });

  return updated;
}

/**
 * A human directly ordering a retry, bypassing decisionAgent/policyEngine's
 * AI-specific gates (confidence thresholds, high-value auto-escalation) —
 * a human clicking this button in the dashboard IS the human approval those
 * gates exist to require. What does NOT get bypassed: the action still runs
 * through the exact same claimAndExecuteAction as every other action (no new
 * execution path), and the hard MAX_RETRIES_PER_CASE safety cap still holds,
 * since that's a real invariant, not just an AI-decision gate.
 */
export async function retryCaseNow(
  caseId: string,
  deps: { provider?: PaymentProvider } = {}
): Promise<RecoveryCase> {
  const provider = deps.provider ?? getDefaultProvider();

  const existing = await prisma.recoveryCase.findUnique({ where: { id: caseId } });
  if (!existing) {
    throw new OperatorActionError("Case not found", 404);
  }
  if (existing.status === "RECOVERED") {
    throw new OperatorActionError("Case is already recovered", 409);
  }

  const activeAction = await prisma.recoveryAction.findFirst({
    where: { caseId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (activeAction) {
    throw new OperatorActionError("An action is already in progress for this case", 409);
  }

  const retryAttemptsSoFar = await prisma.recoveryAction.count({
    where: { caseId, actionType: "RETRY_PAYMENT" },
  });
  if (retryAttemptsSoFar >= POLICY_LIMITS.MAX_RETRIES_PER_CASE) {
    throw new OperatorActionError(
      `Max retries per case (${POLICY_LIMITS.MAX_RETRIES_PER_CASE}) already reached`,
      409
    );
  }

  const action = await prisma.recoveryAction.create({
    data: {
      caseId,
      actionType: "RETRY_PAYMENT",
      reason: "Manual retry requested by operator",
      attemptNumber: retryAttemptsSoFar + 1,
      status: "PENDING",
      scheduledFor: new Date(),
    },
  });

  await prisma.recoveryCase.update({ where: { id: caseId }, data: { status: "ACTION_SCHEDULED" } });

  await logAudit({
    caseId,
    actor: "OPERATOR",
    summary: "Manual retry requested",
    payload: { actionId: action.id },
  });

  await claimAndExecuteAction(action.id, provider);

  return prisma.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
}
